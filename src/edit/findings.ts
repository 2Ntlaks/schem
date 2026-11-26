// Findings harness (SPEC 10.2, Phase 0b minimal version): every convention break and readability
// breach of a drawing becomes a finding, and each gets a checked fix when one exists. A fix is
// found by dry-running at most 5 candidate edits; it is offered only if the result is valid and
// lexicographically better (or with a stated trade-off), and it is tied to the layout it was
// checked on by `expectedLayout`.

import { cmpStr, gridBox, isHorizontal, step, unionBox, xformDir, xformPt, type Box, type Dir, type Orient, type Pt } from "../geom/geom.js";
import { edgeForbidden, type Obstacle } from "../geom/forbidden.js";
import { circuitEquals } from "../core/equals.js";
import { canonical, netKind, railLevel, type Net, type Part, type PinDefs } from "../core/model.js";
import { groupRepresentative, validate } from "../core/validate.js";
import type { LayoutState } from "../core/intent.js";
import { pinDefsOf, type Project } from "../layout/layout.js";
import { BUILTIN } from "../symbols/library.js";
import { measure } from "../text/font.js";
import { DECOUPLING_REACH } from "../quality/conventions.js";
import { textBlocks } from "../quality/drawing.js";
import { checkDrawing, type DrawingCheck } from "../quality/index.js";
import type { DrawnPin, RenderModel } from "../render/model.js";
import { edit, layoutToken, type EditOp, type EditResult } from "./edit.js";

export interface CheckedFix {
  ops: EditOp[];
  expectedLayout: string;
  changesCircuit: boolean;
  /** Change in each measured count if the fix is applied (negative = fewer). */
  expect: Record<string, number>;
  tradeoff: string | null;
}

export interface ReviewFinding {
  id: string;
  severity: "error" | "warn" | "info";
  message: string;
  fix: CheckedFix | null;
}

export const MAX_CANDIDATES = 5;

/** Score of a drawing, compared lexicographically (SPEC 9.1 groups, 10.1). */
interface Score { invalid: number; conventions: number; breaches: number; crossings: number; bends: number; wireLength: number }
const ORDER: Array<keyof Score> = ["invalid", "conventions", "breaches", "crossings", "bends", "wireLength"];
const GROUP: Record<keyof Score, string> = { invalid: "validity", conventions: "conventions", breaches: "readability", crossings: "crossings", bends: "bends", wireLength: "wire length" };

function score(q: DrawingCheck): Score {
  return { invalid: q.valid ? 0 : 1, conventions: q.conventions.length, breaches: q.breaches.length, crossings: q.metrics.crossings, bends: q.metrics.bends, wireLength: q.metrics.wireLength };
}
function compare(a: Score, b: Score): number {
  for (const k of ORDER) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
}

const CIRCUIT_OPS = new Set(["connect", "disconnect", "mergeNets", "renameNet", "setNoConnect", "renamePart", "removePart", "addPart", "setProp"]);
const LABEL_SIZE = 12;

interface Problem {
  id: string;
  severity: ReviewFinding["severity"];
  message: string;
  parts: string[];
  candidates: EditOp[][];
  gone: (q: DrawingCheck) => boolean;
}

/**
 * All findings for the project as last laid out (`state` and `render`), most severe first.
 * `limit` caps how many findings get a fix search (the rest keep `fix: null` and say so).
 */
export function review(project: Project, state: LayoutState, render: RenderModel, limit = 10): ReviewFinding[] {
  const defs = pinDefsOf(project.circuit);
  const now = checkDrawing(project.circuit, defs, render);
  const base = score(now);
  const problems: Problem[] = [];

  for (const e of [...now.connections.errors, ...now.overlaps]) problems.push({ id: `E-${e.code}`, severity: "error", message: e.message, parts: [], candidates: [], gone: () => false });
  for (const f of now.conventions) problems.push({ id: f.id, severity: "warn", message: f.message, parts: f.parts, candidates: conventionCandidates(f.id, f.parts, state), gone: (q) => !q.conventions.some((g) => g.id === f.id) });
  for (const b of now.breaches) {
    const near = partsNear(render, b.at);
    problems.push({ id: `L-${b.metric}`, severity: "info", message: `Readability: ${b.message}.`, parts: near, candidates: breachCandidates(b.metric, near, state), gone: (q) => !q.breaches.some((x) => x.metric === b.metric) });
  }
  if (!problems.length) return [];

  const ctx = buildReviewContext(project, defs, state, render);
  const cache = new Map<string, EditResult>();
  let token: string | undefined;
  const getToken = () => (token ??= layoutToken(project, state));

  return problems.map((p, i): ReviewFinding => {
    if (i >= limit) return { id: p.id, severity: p.severity, message: `${p.message} (no fix searched: past the first ${limit} findings)`, fix: null };
    const capped = p.candidates.slice(0, MAX_CANDIDATES);
    const seen = new Set<string>();
    let best: { ops: EditOp[]; r: EditResult; s: Score } | undefined;
    for (const ops of capped) {
      const k = JSON.stringify(ops);
      if (seen.has(k)) continue;
      seen.add(k);
      if (canSkipCandidate(p, ops, ctx, state, defs)) continue;
      let r = cache.get(k);
      if (!r) {
        // Omit expectedLayout during dry-run: project and state are fixed for this review() call.
        r = edit({ project, previous: state, ops });
        cache.set(k, r);
      }
      if (!r.saved || !r.check || !p.gone(r.check)) continue;
      const s = score(r.check);
      if (!best || compare(s, best.s) < 0) best = { ops, r, s };
    }
    if (!best) return { id: p.id, severity: p.severity, message: `${p.message} No checked fix found${p.candidates.length ? ` among ${capped.length} candidates` : ""}.`, fix: null };
    const better = compare(best.s, base) < 0;
    const worse = ORDER.filter((k) => best!.s[k] > base[k]);
    const firstChange = ORDER.find((k) => best!.s[k] !== base[k]);
    const tradeoff = better ? null : `fixes this but makes ${worse.map((k) => GROUP[k]).join(", ")} worse`;
    if (!better && firstChange && GROUP[firstChange] === "validity") return { id: p.id, severity: p.severity, message: `${p.message} No checked fix found.`, fix: null };
    const expect: Record<string, number> = {};
    for (const k of ORDER) if (best.s[k] !== base[k]) expect[k] = best.s[k] - base[k];
    const hasCircuitOp = best.ops.some((op) => CIRCUIT_OPS.has(op.op));
    return {
      id: p.id, severity: p.severity, message: p.message,
      fix: {
        ops: best.ops,
        expectedLayout: getToken(),
        changesCircuit: hasCircuitOp ? !circuitEquals(project.circuit, defs, best.r.project.circuit) : false,
        expect,
        tradeoff,
      },
    };
  });
}

interface ReviewContext {
  partById: Map<string, Part>;
  locks: Set<string>;
  relativeHintParts: Set<string>;
  pinSidesHintParts: Set<string>;
  templateParts: Set<string>;
  envelopes: Map<string, Box>;
  portKeepouts: Set<string>;
  pinNet: Map<string, Net>;
  netEndpointCount: Map<string, number>;
  drawnPins: Map<string, DrawnPin>;
  allCols: number[];
}

function buildReviewContext(project: Project, defs: PinDefs, state: LayoutState, render: RenderModel): ReviewContext {
  const partById = new Map(project.circuit.parts.map((p) => [p.id, p]));
  const locks = new Set((project.intent?.locks ?? []).map((l) => l.part));
  const relativeHintParts = new Set<string>();
  const pinSidesHintParts = new Set<string>();
  for (const h of project.intent?.hints ?? []) {
    if (h.type === "relative") relativeHintParts.add(h.part);
    if (h.type === "pinSides") pinSidesHintParts.add(h.part);
  }
  const templateParts = new Set<string>();
  for (const t of state.templates ?? []) {
    const colon = t.indexOf(":");
    if (colon < 0) continue;
    for (const part of t.slice(colon + 1).split(",")) if (part) templateParts.add(part);
  }

  // Approximate each part's drawn envelope (body keep-out, port keep-outs, and label box).
  const envelopes = new Map<string, Box>();
  const portKeepouts = new Set<string>();
  const addEnv = (part: string, box: Box) => {
    const prev = envelopes.get(part);
    envelopes.set(part, prev ? unionBox(prev, box) : box);
  };
  for (const k of render.electrical.keepouts ?? []) {
    if (!k.part.includes(":")) addEnv(k.part, k);
    else if (k.part.startsWith("port:")) {
      portKeepouts.add(k.part);
      const owner = k.part.slice(5).replace(/\[.*$/, "");
      addEnv(owner, k);
    }
  }
  for (const tb of textBlocks(render)) {
    if (tb.owner.startsWith("label:")) addEnv(tb.owner.slice(6), gridBox(tb));
  }

  const pinNet = new Map<string, Net>();
  const netEndpointCount = new Map<string, number>();
  const v = validate(project.circuit, defs);
  if (v.valid) {
    const ncSet = new Set(v.valid.nc.map(canonical));
    const netById = new Map(project.circuit.nets.map((n) => [n.id, n]));
    for (const [netId, eps] of v.valid.endpoints) {
      const net = netById.get(netId);
      if (!net) continue;
      const ids = new Set<string>();
      for (const ep of eps) {
        const num = ep.kind === "terminal" ? ep.number : groupRepresentative(ep.part, ep.group, defs, ncSet);
        if (num === undefined) continue;
        const pid = `${ep.part}[${num}]`;
        ids.add(pid);
        pinNet.set(pid, net);
      }
      netEndpointCount.set(netId, ids.size);
    }
  }

  const drawnPins = new Map<string, DrawnPin>(render.electrical.pins.map((p) => [`${p.part}[${p.number}]`, p]));
  const allCols = [...new Set(Object.values(state.parts).map((p) => p.column).filter((c): c is number => c !== undefined))].sort((a, b) => a - b);

  return { partById, locks, relativeHintParts, pinSidesHintParts, templateParts, envelopes, portKeepouts, pinNet, netEndpointCount, drawnPins, allCols };
}

/**
 * Return true only when a single-op candidate is provably a no-op or provably unable to
 * produce a valid layout that removes the finding.
 */
function canSkipCandidate(problem: Problem, ops: EditOp[], ctx: ReviewContext, state: LayoutState, defs: PinDefs): boolean {
  if (ops.length !== 1) return false;
  const op = ops[0]!;

  if (op.op === "setOrientation") {
    const cur = state.parts[op.part];
    const flip = op.flip ?? false;
    // A locked part keeps its lock orientation regardless of an orient hint.
    if (ctx.locks.has(op.part)) return true;
    // Keeping the exact orientation that triggered an orientation convention cannot remove it.
    if (cur && cur.orient.rot === op.rot && cur.orient.flip === flip
      && (problem.id.startsWith("C10-") || problem.id.startsWith("C9.4-") || problem.id.startsWith("C7-source-"))) {
      return true;
    }
    // Check whether the candidate orientation makes one of the part's own port symbols block
    // the mandatory first unit step of one of its own wired pins.
    if (localOrientBlocked(op.part, { rot: op.rot, flip }, ctx, state)) return true;
    return false;
  }

  if (op.op === "setPinSides") {
    const curSides = state.parts[op.part]?.sides;
    if (curSides && !ctx.pinSidesHintParts.has(op.part)) {
      let same = true;
      for (const side of ["left", "right", "top", "bottom"] as const) {
        const next = op[side];
        if (!next) continue;
        const prev = curSides[side];
        if (!prev || prev.length !== next.length || prev.some((v, idx) => v !== next[idx])) { same = false; break; }
      }
      if (same) return true;
    }
    return false;
  }

  if (op.op === "place" && problem.id.startsWith("C13-")) {
    if (ctx.relativeHintParts.has(op.part) || ctx.templateParts.has(op.part) || ctx.locks.has(op.part)) return false;
    // C13 fires only on a two-pin decoupling capacitor on power and ground rails, far from its host.
    // If the relative constraint is already satisfied with >= 2 G clearance, incremental layout keeps
    // both parts in place and cannot remove C13.
    const ep = ctx.envelopes.get(op.part);
    const eo = ctx.envelopes.get(op.of);
    if (ep && eo) {
      if (op.rel === "left-of" && ep.x + ep.w + 2 <= eo.x) return true;
      if (op.rel === "right-of" && eo.x + eo.w + 2 <= ep.x) return true;
      if (op.rel === "above" && ep.y + ep.h + 2 <= eo.y) return true;
      if (op.rel === "below" && eo.y + eo.h + 2 <= ep.y) return true;
    }
    // An above/below hint constrains only Y. When the capacitor sits in a different column separated
    // horizontally by more than DECOUPLING_REACH from every served IC supply pin (with an intervening
    // column when left of the IC, or already right of it), changing only Y cannot bring it within reach.
    if (op.rel === "above" || op.rel === "below") {
      const capCol = state.parts[op.part]?.column;
      const capDefs = defs[op.part] ?? [];
      const capSupply = capDefs
        .map((d) => ctx.drawnPins.get(`${op.part}[${d.number}]`))
        .find((p) => p !== undefined && netKind(ctx.pinNet.get(`${p.part}[${p.number}]`) ?? { kind: "signal" }) === "power");
      const supplyNet = capSupply ? ctx.pinNet.get(`${capSupply.part}[${capSupply.number}]`) : undefined;
      const servedIcs = problem.parts.slice(1);
      if (capCol !== undefined && capSupply && supplyNet && servedIcs.length > 0) {
        const unreachable = servedIcs.every((ic) => {
          const icCol = state.parts[ic]?.column;
          if (icCol === undefined) return false;
          const separated = capCol > icCol || (capCol < icCol && ctx.allCols.some((c) => c > capCol && c < icCol));
          if (!separated) return false;
          const icPins = (defs[ic] ?? [])
            .filter((d) => d.role === "power_in")
            .map((d) => ctx.drawnPins.get(`${ic}[${d.number}]`))
            .filter((p): p is DrawnPin => p !== undefined && ctx.pinNet.get(`${p.part}[${p.number}]`)?.id === supplyNet.id);
          return icPins.length > 0 && icPins.every((p) => Math.abs(p.at[0] - capSupply.at[0]) > DECOUPLING_REACH);
        });
        if (unreachable) return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * True when orienting a fixed built-in symbol to `orient` places one of its own side-mounted
 * port symbols directly across the mandatory first grid step of one of its own wired pins.
 */
function localOrientBlocked(partId: string, orient: Orient, ctx: ReviewContext, state: LayoutState): boolean {
  const part = ctx.partById.get(partId);
  if (!part) return false;
  const sym = BUILTIN[part.type];
  if (!sym) return false;

  const pins = sym.pins.map((p) => ({
    number: p.number,
    at: xformPt(p.at, [0, 0], orient),
    dir: xformDir(p.dir, orient),
  }));

  const portObstacles: Obstacle[] = [];
  for (const p of pins) {
    const pid = `${partId}[${p.number}]`;
    if (!ctx.portKeepouts.has(`port:${pid}`)) continue;
    const net = ctx.pinNet.get(pid);
    if (!net) continue;
    if (!isHorizontal(p.dir)) continue;
    const kind = netKind(net) === "ground" ? "ground" : "power";
    const want: Dir = railLevel(net) === 1 ? "up" : "down";
    const text = kind === "ground" && net.name === "GND" && !net.domain
      ? undefined
      : (net.domain ? `${net.name} (${net.domain})` : net.name);
    const half = Math.max(1, (text ? measure(text, LABEL_SIZE).width / 10 : 0) / 2);
    const out = Math.max(1, Math.ceil(half));
    const anchor = step(step(p.at, p.dir, out), want);
    const core: Box = kind === "ground"
      ? { x: anchor[0] - 1, y: anchor[1], w: 2, h: 2 }
      : { x: anchor[0] - 1, y: anchor[1] + (want === "down" ? 0 : -1), w: 2, h: 1 };
    portObstacles.push({ ...core, owner: `port:${pid}` });
  }
  if (!portObstacles.length) return false;

  for (const p of pins) {
    const pid = `${partId}[${p.number}]`;
    if (ctx.portKeepouts.has(`port:${pid}`)) continue;
    const net = ctx.pinNet.get(pid);
    if (!net || state.routes[net.id]?.ports) continue;
    if ((ctx.netEndpointCount.get(net.id) ?? 0) < 2) continue;
    if (edgeForbidden(p.at, step(p.at, p.dir), portObstacles)) return true;
  }
  return false;
}

function conventionCandidates(id: string, parts: string[], state: LayoutState): EditOp[][] {
  const [first, second] = parts;
  if (!first) return [];
  if (id.startsWith("C10-") || id.startsWith("C9.4-") || id.startsWith("C7-source-")) return [90, 270].map((rot) => [{ op: "setOrientation", part: first, rot: rot as 90 | 270 }]);
  if (id.startsWith("C11-") && second) return [[{ op: "align", axis: "row", parts: [first, second] }]];
  if (id.startsWith("C8-") && second) return [[{ op: "place", part: second, rel: "left-of", of: first }], [{ op: "place", part: first, rel: "right-of", of: second }]];
  if (id.startsWith("C13-") && second) {
    const rels = ["right-of", "left-of", "below", "above"] as const;
    return rels.map((rel) => [{ op: "place", part: first, rel, of: second, priority: "high" } as EditOp]).slice(0, MAX_CANDIDATES);
  }
  void state;
  return [];
}

function breachCandidates(metric: string, near: string[], state: LayoutState): EditOp[][] {
  if (metric === "marginImbalance" || metric === "aspectError") return [];
  const out: EditOp[][] = [];
  for (const id of near) {
    const p = state.parts[id];
    if (!p) continue;
    if (p.sides) {
      // Reverse the order of the pins on one side of a generated box.
      for (const side of ["left", "right", "top", "bottom"] as const) {
        const pins = p.sides[side];
        if (pins && pins.length > 1) out.push([{ op: "setPinSides", part: id, [side]: [...pins].reverse() }]);
      }
    } else {
      out.push([{ op: "setOrientation", part: id, rot: ((p.orient.rot + 180) % 360) as 0 | 90 | 180 | 270, flip: p.orient.flip }]);
    }
  }
  out.push([{ op: "setSpacing", factor: 1.5 }]);
  return out.slice(0, MAX_CANDIDATES);
}

/** Parts whose keep-out lies within 4 G of any of the points (else the two nearest), nearest first. */
function partsNear(m: RenderModel, at: Pt[]): string[] {
  const d = new Map<string, number>();
  for (const k of m.electrical.keepouts ?? []) {
    if (k.part.includes(":")) continue;
    for (const p of at) {
      const dx = Math.max(0, k.x - p[0], p[0] - (k.x + k.w)), dy = Math.max(0, k.y - p[1], p[1] - (k.y + k.h));
      const dist = Math.hypot(dx, dy);
      if (dist < (d.get(k.part) ?? Infinity)) d.set(k.part, dist);
    }
  }
  const sorted = [...d].sort((a, b) => a[1] - b[1] || cmpStr(a[0], b[0]));
  const close = sorted.filter(([, dist]) => dist <= 4);
  return (close.length ? close : sorted.slice(0, 2)).map(([id]) => id);
}
