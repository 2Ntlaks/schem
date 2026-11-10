// Edit transactions (SPEC 11.3, 9.5): operations applied in order, laid out incrementally,
// checked by verification layers 1-2, and saved only if the result is valid (D4).

import { cmpStr, xformDir, xformPt, type Orient, type Pt, type Rot } from "../geom/geom.js";
import { canonical as canonicalEp, CircuitError, netKind, type Circuit, type Net, type PinDefs } from "../core/model.js";
import { applyOps, type CircuitOp } from "../core/ops.js";
import { resolveEndpoint } from "../core/validate.js";
import { hintParts, type Hint, type HintPriority, type Intent, type LayoutState, type Side } from "../core/intent.js";
import { drawnAsPorts } from "../layout/ports.js";
import { layout, pinDefsOf, type LayoutResult, type Project, type Status } from "../layout/layout.js";
import { checkDrawing, type DrawingCheck } from "../quality/index.js";
import { BUILTIN, ORIENTS, type SymPin } from "../symbols/library.js";
import { changeReport, stabilityBreaks, type ChangeReport } from "./report.js";
import { sha256 } from "../core/sha256.js";

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
  /**
   * Refuse, instead of saving with its change report, an edit whose layout moves untouched parts past
   * SPEC 15 gate 4. The whole-sheet layout is then not tried either, unless the operations ask for it
   * (`relayout canonical`, `setSpacing`).
   */
  strict?: boolean;
}

export type EditMode = "incremental" | "incremental-reroute" | "canonical";

export interface EditResult {
  saved: boolean;
  status: Status | "conflict" | "unstable";
  /** The edited project if saved, else the unchanged input. */
  project: Project;
  layout?: LayoutResult;
  check?: DrawingCheck;
  report?: ChangeReport;
  mode?: EditMode;
  /** Parts and nets the edit involved (SPEC 9.5 table, computed from the before/after difference). */
  affected: { parts: string[]; nets: string[] };
  /** Hints removed with a removed part (SPEC 11.3, rev C.3); explicit removeHint ids are not listed. */
  removedHints?: string[];
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
  // removePart takes the part's lock, label side and hints with it (SPEC 11.3, rev C.3).
  const unpruned = intent;
  intent = pruned(intent, circuit);
  const removedHints = (unpruned.hints ?? []).map((h) => h.id).filter((id) => !(intent.hints ?? []).some((h) => h.id === id));
  const project: Project = { ...before, circuit, intent };
  const affected = affectedBy(before.circuit, circuit, before.intent ?? {}, unpruned, req.ops, previous);

  // 2. Lay out: keep routes, then reroute, then the whole sheet (SPEC 9.5 widening, 0b version).
  // An incremental result that moves untouched parts past gate 4 is kept only if no later
  // incremental attempt is stable: first new parts below the drawing, then every net rerouted.
  const attempts: Array<{ mode: EditMode; run: () => LayoutResult }> = [];
  if (previous && !canonical) {
    attempts.push({ mode: "incremental", run: () => layout(project, { previous, affected: affected.parts }) });
    if (circuit.parts.some((p) => !previous.parts[p.id])) {
      attempts.push({ mode: "incremental", run: () => layout(project, { previous, affected: affected.parts, newPartsBelow: true }) });
    }
    attempts.push({ mode: "incremental-reroute", run: () => layout(project, { previous, affected: affected.parts, reuseRoutes: false }) });
  }
  if (!(req.strict && previous && !canonical)) attempts.push({ mode: "canonical", run: () => layout(project) });
  const issues: string[] = [];
  let last: LayoutResult | undefined;
  let unstable: EditResult | undefined;
  for (const a of attempts) {
    if (unstable && a.mode === "canonical") return unstable;
    const r = a.run();
    last = r;
    if (!r.render || !r.status.startsWith("valid")) { issues.push(`${a.mode}: ${r.status}${r.issues.length ? ` (${r.issues[0]})` : ""}`); if (r.status === "infeasible" || r.status === "invalid_input") break; continue; }
    const q = checkDrawing(circuit, r.pinDefs, r.render);
    if (!q.valid) { issues.push(`${a.mode}: drawing failed checks (${[...q.connections.errors, ...q.overlaps].map((i) => i.code).join(", ")})`); continue; }
    const locked = new Set((intent.locks ?? []).map((l) => l.part));
    const report = previous ? changeReport(previous, r.state!, new Set(affected.parts), new Set(affected.nets), locked) : undefined;
    const result: EditResult = {
      saved: true, status: r.status, project, layout: r, check: q, mode: a.mode, affected, removedHints, issues: [...issues],
      ...(report ? { report } : {}),
      revision: revision(project), layoutToken: layoutToken(project, r.state!),
    };
    const breaks = report && a.mode !== "canonical" ? stabilityBreaks(report) : [];
    if (!breaks.length) return result;
    unstable ??= result;
    issues.push(`${a.mode}: moves untouched parts (${breaks.join("; ")})`);
  }
  if (unstable && req.strict) {
    return { ...unchanged("unstable", [`edit refused (strict): every layout that keeps the drawing moves untouched parts too far. ${issues.join("; ")}`]), affected, removedHints, report: unstable.report! };
  }
  if (unstable) return unstable;
  if (req.strict && previous && !canonical) issues.push("strict: the whole-sheet layout was not tried");
  const status = last?.status && !last.status.startsWith("valid") ? last.status : "budget_exhausted";
  return { ...unchanged(status, [`edit rejected: no valid layout (D4). ${issues.join("; ")}`]), affected, removedHints };
}

class EditError extends Error {}

/**
 * The first orientation (in ORIENTS order) that puts every listed pin of a fixed symbol on its side,
 * in the listed order (top to bottom on left and right, left to right on top and bottom).
 */
function orientationFor(pins: SymPin[], sides: Partial<Record<Side, string[]>>): Orient | undefined {
  const facing: Record<Side, string> = { left: "left", right: "right", top: "up", bottom: "down" };
  return ORIENTS.find((o) => (Object.entries(sides) as Array<[Side, string[]]>).every(([side, nums]) => {
    const placed = nums.map((n) => pins.find((p) => p.number === n)!).map((p) => ({ at: xformPt(p.at, [0, 0], o), dir: xformDir(p.dir, o) }));
    if (!placed.every((p) => p.dir === facing[side])) return false;
    const axis = side === "left" || side === "right" ? 1 : 0;
    return placed.every((p, i) => i === 0 || placed[i - 1]!.at[axis] < p.at[axis]);
  }));
}

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
      const part = circuit.parts.find((p) => p.id === v.part)!;
      const defs = pinDefsOf(circuit);
      const num = (ref: string) => {
        if (defs[v.part]?.some((p) => p.number === ref)) return ref;
        const r = resolveEndpoint(ref.includes(".") || ref.includes("[") ? ref : `${v.part}.${ref}`, defs);
        if (!r.ok || r.ep.kind !== "terminal" || r.ep.part !== v.part) throw new EditError(`setPinSides: "${ref}" is not a pin of ${v.part}.`);
        return r.ep.number;
      };
      const sides: Partial<Record<Side, string[]>> = {};
      for (const s of ["left", "right", "top", "bottom"] as const) if (v[s]) sides[s] = v[s]!.map(num);
      // SPEC 11.3 (rev C.3): only generated boxes (ic, header, modules) have pin sides. On a fixed
      // symbol the edit is rejected, naming the setOrientation that gives the same arrangement.
      const fixed = BUILTIN[part.type];
      if (fixed && !part.pins) {
        const o = orientationFor(fixed.pins, sides);
        throw new EditError(`E270 setPinSides: ${v.part} is the fixed "${part.type}" symbol; only generated boxes (ic, header, modules) have pin sides. ${o ? `The same arrangement is setOrientation { part: "${v.part}", rot: ${o.rot}, flip: ${o.flip} }.` : "No orientation of this symbol gives that arrangement."}`);
      }
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
    return hintParts(h).every((p) => ids.has(p)) ? [h] : [];
  });
  if (intent.overrides?.labelSide) out.overrides = { ...intent.overrides, labelSide: Object.fromEntries(Object.entries(intent.overrides.labelSide).filter(([p]) => ids.has(p))) };
  return out;
}

function renamed(intent: Intent, previous: LayoutState | undefined, from: string, to: string): [Intent, LayoutState | undefined] {
  const r = (p: string) => (p === from ? to : p);
  const out: Intent = structuredClone(intent);
  out.locks = out.locks?.map((l) => ({ ...l, part: r(l.part) }));
  const rp = (e: string) => (e.startsWith(from) && /^[[{.]/.test(e.slice(from.length)) ? to + e.slice(from.length) : e);
  out.hints = out.hints?.map((h) => (h.type === "align" ? { ...h, parts: h.parts.map(r) } : h.type === "relative" ? { ...h, part: r(h.part), of: r(h.of) } : h.type === "decouples" ? { ...h, part: r(h.part), pin: rp(h.pin) } : { ...h, part: r(h.part) }));
  if (out.overrides?.labelSide?.[from]) { out.overrides.labelSide[to] = out.overrides.labelSide[from]!; delete out.overrides.labelSide[from]; }
  if (!previous) return [out, previous];
  const prev = structuredClone(previous);
  if (prev.parts[from]) { prev.parts[to] = prev.parts[from]!; delete prev.parts[from]; }
  for (const route of Object.values(prev.routes)) route.terminals = route.terminals.split(";").map((t) => (t.startsWith(`${from}[`) ? to + t.slice(from.length) : t)).sort(cmpStr).join(";");
  return [out, prev];
}

/** SPEC 9.5 "which parts an operation affects", computed from the difference the operations made. */
function affectedBy(c1: Circuit, c2: Circuit, i1: Intent, i2: Intent, ops: EditOp[], previous?: LayoutState): { parts: string[]; nets: string[] } {
  const parts = new Set<string>();
  const nets = new Set<string>();
  const partOf = (e: string) => e.slice(0, e.search(/[[{.]/));
  // Port-drawn nets (SPEC 9.5, rev C.3) do not spread "affected": only parts whose own endpoints
  // changed count. Which nets are port-drawn comes from the previous layout; a net it does not have
  // uses the layout's rule (src/layout/ports.ts).
  const d1 = pinDefsOf(c1), d2 = pinDefsOf(c2);
  const canon = (e: string, d: PinDefs) => { const r = resolveEndpoint(e, d); return r.ok ? canonicalEp(r.ep) : e; };
  const portDrawn = (n: Net) => {
    const prev = previous?.routes[n.id];
    if (prev) return prev.ports === true;
    return drawnAsPorts(n, [...new Set(n.endpoints.map((e) => canon(e, d2)))], (p) => c2.parts.find((x) => x.id === p)?.type);
  };
  const net1 = new Map(c1.nets.map((n) => [n.id, [...n.endpoints].sort(cmpStr).join(" ")]));
  const net2 = new Map(c2.nets.map((n) => [n.id, [...n.endpoints].sort(cmpStr).join(" ")]));
  for (const n of [...c1.nets, ...c2.nets]) {
    const a = net1.get(n.id), b = net2.get(n.id);
    const n1 = c1.nets.find((x) => x.id === n.id), n2 = c2.nets.find((x) => x.id === n.id);
    if (a === b && n1?.name === n2?.name) continue;
    nets.add(n.id);
    if (n1 && n2 && n1.name === n2.name && portDrawn(n1)) {
      const e1 = new Set(n1.endpoints.map((e) => canon(e, d1))), e2 = new Set(n2.endpoints.map((e) => canon(e, d2)));
      for (const e of [...e1].filter((x) => !e2.has(x)).concat([...e2].filter((x) => !e1.has(x)))) parts.add(partOf(e));
    } else for (const e of [...(n1?.endpoints ?? []), ...(n2?.endpoints ?? [])]) parts.add(partOf(e));
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
    for (const p of hintParts(h)) parts.add(p);
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

function sha(s: string): string { return sha256(s); }

/** JSON with object keys sorted, so equal content always hashes the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort(cmpStr).filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
