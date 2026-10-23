// Edit transactions (SPEC 11.3, 9.5): operations applied in order, laid out incrementally,
// checked by verification layers 1-2, and saved only if the result is valid (D4).

import { createHash } from "node:crypto";
import { cmpStr, type Pt, type Rot } from "../geom/geom.js";
import { CircuitError, type Circuit } from "../core/model.js";
import { applyOps, type CircuitOp } from "../core/ops.js";
import { resolveEndpoint } from "../core/validate.js";
import type { Hint, HintPriority, Intent, LayoutState, Side } from "../core/intent.js";
import { layout, pinDefsOf, type LayoutResult, type Project, type Status } from "../layout/layout.js";
import { checkDrawing, type DrawingCheck } from "../quality/index.js";
import { changeReport, stabilityBreaks, type ChangeReport } from "./report.js";

export type VisualOp =
  | { op: "lock"; part: string; at?: Pt; rot?: Rot; flip?: boolean }
  | { op: "unlock"; part: string }
  | { op: "setOrientation"; part: string; rot: Rot; flip?: boolean }
  | { op: "setPinSides"; part: string; left?: string[]; right?: string[]; top?: string[]; bottom?: string[] }
  | { op: "setLabelSide"; part: string; side: "above" | "below" | "left" | "right" }
  | { op: "setSpacing"; factor: number }
  | { op: "place"; part: string; rel: "right-of" | "left-of" | "above" | "below"; of: string; priority?: HintPriority }
  | { op: "align"; axis: "row" | "column"; parts: string[]; priority?: HintPriority }
  | { op: "removeHint"; id: string }
  | { op: "relayout"; mode: "incremental" | "canonical" };

export type EditOp = CircuitOp | VisualOp;

export interface EditRequest {
  project: Project;
  /** The layout the project was last saved with; without it the edit lays out canonically. */
  previous?: LayoutState;
  ops: EditOp[];
  expectedRevision?: string;
  expectedLayout?: string;
}

export type EditMode = "incremental" | "incremental-reroute" | "canonical";

export interface EditResult {
  saved: boolean;
  status: Status | "conflict";
  /** The edited project if saved, else the unchanged input. */
  project: Project;
  layout?: LayoutResult;
  check?: DrawingCheck;
  report?: ChangeReport;
  mode?: EditMode;
  /** Parts and nets the edit involved (SPEC 9.5 table, computed from the before/after difference). */
  affected: { parts: string[]; nets: string[] };
  issues: string[];
  revision: string;
  layoutToken?: string;
}

const CIRCUIT_OPS = new Set(["connect", "disconnect", "mergeNets", "renameNet", "setNoConnect", "renamePart", "removePart", "addPart", "setProp"]);

export function edit(req: EditRequest): EditResult {
  const before = req.project;
  const rev0 = revision(before);
  const unchanged = (status: EditResult["status"], issues: string[]): EditResult =>
    ({ saved: false, status, project: before, affected: { parts: [], nets: [] }, issues, revision: rev0, ...(req.previous ? { layoutToken: layoutToken(before, req.previous) } : {}) });
  if (req.expectedRevision !== undefined && req.expectedRevision !== rev0) return unchanged("conflict", [`the project changed (revision ${rev0.slice(0, 12)}, expected ${req.expectedRevision.slice(0, 12)}).`]);
  if (req.expectedLayout !== undefined && (!req.previous || layoutToken(before, req.previous) !== req.expectedLayout)) return unchanged("conflict", ["the layout changed since this fix was checked; ask for findings again."]);

  // 1. Apply the operations in order, as one transaction.
  let circuit: Circuit = structuredClone(before.circuit);
  let intent: Intent = structuredClone(before.intent ?? {});
  let previous = req.previous ? structuredClone(req.previous) : undefined;
  let canonical = false;
  try {
    for (const op of req.ops) {
      if (CIRCUIT_OPS.has(op.op)) {
        circuit = applyOps(circuit, pinDefsOf(circuit), [op as CircuitOp]).circuit;
        if (op.op === "renamePart") [intent, previous] = renamed(intent, previous, op.from, op.to);
      } else {
        const v = op as VisualOp;
        if (v.op === "setSpacing" || (v.op === "relayout" && v.mode === "canonical")) canonical = true;
        intent = applyVisual(intent, v, circuit, previous);
      }
    }
  } catch (e) {
    if (e instanceof CircuitError) return unchanged("invalid_input", e.issues.map((i) => `${i.code} ${i.message}`));
    if (e instanceof EditError) return unchanged("invalid_input", [e.message]);
    throw e;
  }
  intent = pruned(intent, circuit);
  const project: Project = { ...before, circuit, intent };
  const affected = affectedBy(before.circuit, circuit, before.intent ?? {}, intent, req.ops);

  // 2. Lay out: keep routes, then reroute, then the whole sheet (SPEC 9.5 widening, 0b version).
  const attempts: Array<{ mode: EditMode; run: () => LayoutResult }> = [];
  if (previous && !canonical) {
    attempts.push({ mode: "incremental", run: () => layout(project, { previous, affected: affected.parts }) });
    // Move a touched part locally before widening to a full reroute or canonical layout.
    // Untouched origins remain anchored so a repair cannot displace the rest of the sheet.
    const fixed = Object.fromEntries(Object.entries(previous.parts).filter(([id]) => !affected.parts.includes(id)).map(([id, p]) => [id, p.at]));
    const geometryTargets = new Set(req.ops.flatMap((op) =>
      op.op === "setOrientation" || op.op === "setPinSides" || op.op === "setLabelSide" || op.op === "setProp" ? [op.part] : []));
    const repairParts = affected.parts.filter((part) => previous.parts[part] && !intent.locks?.some((l) => l.part === part)
      && (!geometryTargets.size || geometryTargets.has(part)));
    let repairCount = 0;
    repair: for (const offset of [[0, -2], [0, 2], [-2, 0], [2, 0], [0, -4], [0, 4], [-4, 0], [4, 0]] as const) {
      for (const part of repairParts) {
        if (repairCount++ >= 8) break repair;
        const origin = previous.parts[part]!.at;
        const anchors = { ...fixed, [part]: [origin[0] + offset[0], origin[1] + offset[1]] as Pt };
        attempts.push({ mode: "incremental", run: () => layout(project, { previous, affected: affected.parts, anchors }) });
      }
    }
    attempts.push({ mode: "incremental-reroute", run: () => layout(project, { previous, affected: affected.parts, reuseRoutes: false }) });
  }
  attempts.push({ mode: "canonical", run: () => layout(project) });
  const issues: string[] = [];
  let last: LayoutResult | undefined;
  for (const a of attempts) {
    const r = a.run();
    last = r;
    if (!r.render || !r.status.startsWith("valid")) { issues.push(`${a.mode}: ${r.status}${r.issues.length ? ` (${r.issues[0]})` : ""}`); if (r.status === "invalid_input") break; continue; }
    const q = checkDrawing(circuit, r.pinDefs, r.render);
    if (!q.valid) { issues.push(`${a.mode}: drawing failed checks (${[...q.connections.errors, ...q.overlaps].map((i) => i.code).join(", ")})`); continue; }
    const locked = new Set((intent.locks ?? []).map((l) => l.part));
    const report = previous ? changeReport(previous, r.state!, new Set(affected.parts), new Set(affected.nets), locked) : undefined;
    // A valid drawing can still disrupt unrelated work. Apply gate 4 before accepting any
    // incremental candidate, including the canonical fallback. Explicit global relayouts opt out.
    const breaks = report && !canonical ? stabilityBreaks(report) : [];
    if (breaks.length) { issues.push(`${a.mode}: stability gate failed (${breaks.join("; ")})`); continue; }
    return {
      saved: true, status: r.status, project, layout: r, check: q, mode: a.mode, affected, issues,
      ...(report ? { report } : {}),
      revision: revision(project), layoutToken: layoutToken(project, r.state!),
    };
  }
  const status = last?.status && !last.status.startsWith("valid") ? last.status : "budget_exhausted";
  return { ...unchanged(status, [`edit rejected: no valid${previous && !canonical ? ", stable" : ""} layout (D4). ${issues.join("; ")}`]), affected };
}

class EditError extends Error {}

function applyVisual(intent: Intent, v: VisualOp, circuit: Circuit, previous: LayoutState | undefined): Intent {
  const out: Intent = structuredClone(intent);
  const hints = out.hints ?? [];
  const exists = (id: string) => { if (!circuit.parts.some((p) => p.id === id)) throw new EditError(`E251 unknown part "${id}".`); };
  const nextId = () => `h${1 + Math.max(0, ...hints.map((h) => Number(/^h(\d+)$/.exec(h.id)?.[1] ?? 0)))}`;
  // Setters (SPEC 11.3): each replaces the hint with the same fixed target, keeping its id.
  const upsert = (same: (h: Hint) => boolean, make: (id: string) => Hint) => {
    const i = hints.findIndex(same);
    if (i >= 0) hints[i] = make(hints[i]!.id); else hints.push(make(nextId()));
  };
  switch (v.op) {
    case "lock": {
      exists(v.part);
      const prev = previous?.parts[v.part];
      const at = v.at ?? prev?.at;
      if (!at) throw new EditError(`lock ${v.part} needs "at": there is no previous layout to lock it where it is.`);
      const l = { part: v.part, x: at[0], y: at[1], rot: v.rot ?? prev?.orient.rot ?? 0, flip: v.flip ?? prev?.orient.flip ?? false };
      out.locks = [...(out.locks ?? []).filter((x) => x.part !== v.part), l];
      break;
    }
    case "unlock": out.locks = (out.locks ?? []).filter((x) => x.part !== v.part); break;
    case "setOrientation": exists(v.part); upsert((h) => h.type === "orient" && h.part === v.part, (id) => ({ id, type: "orient", part: v.part, rot: v.rot, flip: v.flip ?? false, priority: "normal" })); break;
    case "setPinSides": {
      exists(v.part);
      const defs = pinDefsOf(circuit);
      const num = (ref: string) => {
        if (defs[v.part]?.some((p) => p.number === ref)) return ref;
        const r = resolveEndpoint(ref.includes(".") || ref.includes("[") ? ref : `${v.part}.${ref}`, defs);
        if (!r.ok || r.ep.kind !== "terminal" || r.ep.part !== v.part) throw new EditError(`setPinSides: "${ref}" is not a pin of ${v.part}.`);
        return r.ep.number;
      };
      const sides: Partial<Record<Side, string[]>> = {};
      for (const s of ["left", "right", "top", "bottom"] as const) if (v[s]) sides[s] = v[s]!.map(num);
      upsert((h) => h.type === "pinSides" && h.part === v.part, (id) => ({ id, type: "pinSides", part: v.part, sides, priority: "normal" }));
      break;
    }
    case "setLabelSide": exists(v.part); out.overrides = { ...out.overrides, labelSide: { ...out.overrides?.labelSide, [v.part]: v.side } }; break;
    case "setSpacing": if (!(v.factor >= 1 && v.factor <= 4)) throw new EditError("setSpacing: factor must be between 1 and 4."); out.spacing = v.factor; break;
    case "place": exists(v.part); exists(v.of); upsert((h) => h.type === "relative" && h.part === v.part, (id) => ({ id, type: "relative", part: v.part, rel: v.rel, of: v.of, priority: v.priority ?? "normal" })); break;
    case "align": {
      v.parts.forEach(exists);
      const k = [...v.parts].sort(cmpStr).join(" ");
      upsert((h) => h.type === "align" && h.axis === v.axis && [...h.parts].sort(cmpStr).join(" ") === k, (id) => ({ id, type: "align", axis: v.axis, parts: [...v.parts], priority: v.priority ?? "normal" }));
      break;
    }
    case "removeHint": if (!hints.some((h) => h.id === v.id)) throw new EditError(`removeHint: no hint "${v.id}".`); out.hints = hints.filter((h) => h.id !== v.id); return out;
    case "relayout": break;
  }
  if (hints.length) out.hints = hints;
  return out;
}

/** Drop intent that names parts no longer in the circuit. */
function pruned(intent: Intent, circuit: Circuit): Intent {
  const ids = new Set(circuit.parts.map((p) => p.id));
  const out: Intent = { ...intent };
  if (intent.locks) out.locks = intent.locks.filter((l) => ids.has(l.part));
  if (intent.hints) out.hints = intent.hints.flatMap((h): Hint[] => {
    if (h.type === "align") { const parts = h.parts.filter((p) => ids.has(p)); return parts.length >= 2 ? [{ ...h, parts }] : []; }
    if (h.type === "relative") return ids.has(h.part) && ids.has(h.of) ? [h] : [];
    return ids.has(h.part) ? [h] : [];
  });
  if (intent.overrides?.labelSide) out.overrides = { ...intent.overrides, labelSide: Object.fromEntries(Object.entries(intent.overrides.labelSide).filter(([p]) => ids.has(p))) };
  return out;
}

function renamed(intent: Intent, previous: LayoutState | undefined, from: string, to: string): [Intent, LayoutState | undefined] {
  const r = (p: string) => (p === from ? to : p);
  const out: Intent = structuredClone(intent);
  out.locks = out.locks?.map((l) => ({ ...l, part: r(l.part) }));
  out.hints = out.hints?.map((h) => (h.type === "align" ? { ...h, parts: h.parts.map(r) } : h.type === "relative" ? { ...h, part: r(h.part), of: r(h.of) } : { ...h, part: r(h.part) }));
  if (out.overrides?.labelSide?.[from]) { out.overrides.labelSide[to] = out.overrides.labelSide[from]!; delete out.overrides.labelSide[from]; }
  if (!previous) return [out, previous];
  const prev = structuredClone(previous);
  if (prev.parts[from]) { prev.parts[to] = prev.parts[from]!; delete prev.parts[from]; }
  for (const route of Object.values(prev.routes)) route.terminals = route.terminals.split(";").map((t) => (t.startsWith(`${from}[`) ? to + t.slice(from.length) : t)).sort(cmpStr).join(";");
  return [out, prev];
}

/** SPEC 9.5 "which parts an operation affects", computed from the difference the operations made. */
function affectedBy(c1: Circuit, c2: Circuit, i1: Intent, i2: Intent, ops: EditOp[]): { parts: string[]; nets: string[] } {
  const parts = new Set<string>();
  const nets = new Set<string>();
  const partOf = (e: string) => e.slice(0, e.search(/[[{.]/));
  const net1 = new Map(c1.nets.map((n) => [n.id, [...n.endpoints].sort(cmpStr).join(" ")]));
  const net2 = new Map(c2.nets.map((n) => [n.id, [...n.endpoints].sort(cmpStr).join(" ")]));
  for (const n of [...c1.nets, ...c2.nets]) {
    const a = net1.get(n.id), b = net2.get(n.id);
    const n1 = c1.nets.find((x) => x.id === n.id), n2 = c2.nets.find((x) => x.id === n.id);
    if (a !== b || n1?.name !== n2?.name) { nets.add(n.id); for (const e of [...(n1?.endpoints ?? []), ...(n2?.endpoints ?? [])]) parts.add(partOf(e)); }
  }
  const p1 = new Map(c1.parts.map((p) => [p.id, JSON.stringify(p)]));
  for (const p of c2.parts) if (p1.get(p.id) !== JSON.stringify(p)) parts.add(p.id);
  for (const op of ops) {
    if ("part" in op && typeof op.part === "string") parts.add(op.part);
    if (op.op === "place") parts.add(op.of);
    if (op.op === "align") op.parts.forEach((p) => parts.add(p));
    if (op.op === "renamePart") parts.add(op.to);
  }
  // Hints removed or changed affect the parts they named.
  const h1 = new Map((i1.hints ?? []).map((h) => [h.id, JSON.stringify(h)]));
  for (const h of [...(i1.hints ?? []), ...(i2.hints ?? [])]) {
    if (h1.get(h.id) === JSON.stringify((i2.hints ?? []).find((x) => x.id === h.id))) continue;
    if (h.type === "align") h.parts.forEach((p) => parts.add(p)); else { parts.add(h.part); if (h.type === "relative") parts.add(h.of); }
  }
  const present = new Set(c2.parts.map((p) => p.id));
  for (const n of c2.nets) if (n.endpoints.some((e) => parts.has(partOf(e)))) nets.add(n.id);
  return { parts: [...parts].filter((p) => present.has(p)).sort(cmpStr), nets: [...nets].sort(cmpStr) };
}

// ---------------------------------------------------------------------------
// Tokens (SPEC 11.1)

/** Hash of circuit + intent (assets come with the asset store in Phase 1). */
export function revision(p: Project): string {
  return sha(stable({ circuit: p.circuit, intent: p.intent ?? {} }));
}

/** Hash of the revision + layout geometry. */
export function layoutToken(p: Project, s: LayoutState): string {
  return sha(revision(p) + stable(s));
}

function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }

/** JSON with object keys sorted, so equal content always hashes the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort(cmpStr).filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
