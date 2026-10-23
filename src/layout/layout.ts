// Phase 0a layout pipeline (SPEC 9.2, scope as in SPEC 15 Phase 0a).

import {
  cmpNatural, cmpStr, edgeKey, gridBox, isHorizontal, key, step, unionBox, unitEdges, xformBox, xformDir, xformPt,
  boxesOverlap, type Box, type Dir, type Orient, type Pt,
} from "../geom/geom.js";
import { obstacleFromLabel, type Obstacle } from "../geom/forbidden.js";
import { canonical, netKind, type Circuit, type Net, type PinDef, type PinDefs } from "../core/model.js";
import { groupRepresentative, validate, type ValidCircuit } from "../core/validate.js";
import { parseQuantity, quantityOf } from "../core/quantity.js";
import { BUILTIN, checkSymbol, icSymbol, keepOut, type SymbolDef } from "../symbols/library.js";
import { measure } from "../text/font.js";
import { eq, solveWithDrops, X0, type Constraint } from "./solver.js";
import { route, type NetRequest } from "./router.js";
import { checkDrawing } from "../quality/index.js";
import type { Art, DrawnPin, DrawnPort, Electrical, RenderModel } from "../render/model.js";
import type { Intent, LayoutState, Side } from "../core/intent.js";

export interface Project { meta?: { title?: string }; circuit: Circuit; intent?: Intent }

export type Status = "valid" | "valid_low_confidence" | "infeasible" | "budget_exhausted" | "invalid_input";

/**
 * Fixed placement for every part (test hook, and the shape of a 0b template's output):
 * the part's origin, optional orientation, and optional pin sides for generated IC boxes.
 * Positions become lock constraints, so the normal solve, routing and rendering still run.
 */
export type { Side };
export type Placement = Record<string, { at: Pt; orient?: Orient; sides?: Partial<Record<Side, string[]>> }>;

export interface LayoutResult {
  status: Status;
  render?: RenderModel;
  pinDefs: PinDefs;
  issues: string[];
  notes: string[];
  /** Positions, orientations, pin sides and routes, for the next incremental layout. */
  state?: LayoutState;
}

export interface LayoutOptions {
  spacing?: number;
  place?: Placement;
  prewire?: Prewire;
  /** Incremental mode (SPEC 9.5): the previous layout, and the parts the edit affects. */
  previous?: LayoutState;
  affected?: readonly string[];
  /** Keep the previous routes of nets whose drawn terminals did not change (default true). */
  reuseRoutes?: boolean;
}

const LABEL_SIZE = 12;   // SVG units (1.2 G)
const PIN_SIZE = 10;
const LINE = 1.5;        // G per label line
const MARGIN = 3;        // G, SPEC 12.1

// ---------------------------------------------------------------------------

export function pinDefsOf(circuit: Circuit): PinDefs {
  const defs: PinDefs = {};
  for (const p of circuit.parts) {
    const sym = BUILTIN[p.type];
    if (sym) defs[p.id] = sym.pins.map(({ at: _a, dir: _d, ...rest }) => rest);
    else if (p.type === "ic" || p.type.startsWith("module:")) defs[p.id] = (p.pins ?? []).map(defaultRole);
  }
  return defs;
}

function defaultRole(p: PinDef): PinDef {
  if (p.role) return p;
  const role = /^(GND|VSS|AGND|DGND)$/i.test(p.name) ? "ground" : /^(VCC|VDD|VIN|3V3|5V|V\+|VBAT)$/i.test(p.name) ? "power_in" : "bidir";
  return { ...p, role };
}

interface Placed {
  id: string;
  sym: SymbolDef;
  orient: Orient;
  col: number;
  rank: number;
  /** Local (oriented) geometry relative to the part origin. */
  ko: Box;
  labels: Array<{ box: Box; lines: string[]; align: "start" | "middle" | "end" }>;
  ports: Array<{ pin: string; net: Net; anchor: Pt; stub: Pt[]; box: Box; kind: "ground" | "power" }>;
  env: Box;
  pins: Array<{ number: string; at: Pt; dir: Dir }>;
}

/** Fixed conductor runs of a net (by net id), handed to the router as part of its tree (SPEC 9.2 step 7). */
export type Prewire = Record<string, Pt[][]>;

export function layout(project: Project, opts: LayoutOptions = {}): LayoutResult {
  const notes: string[] = [];
  const intent = project.intent ?? {};
  const locks = new Map((intent.locks ?? []).map((l) => [l.part, l]));
  const hints = intent.hints ?? [];
  const orientHint = new Map(hints.flatMap((h) => (h.type === "orient" ? [[h.part, h] as const] : [])));
  const sidesHint = new Map(hints.flatMap((h) => (h.type === "pinSides" ? [[h.part, h.sides] as const] : [])));
  const affected = new Set(opts.affected ?? []);
  /** Previous geometry of a part the edit did not touch (orientation and pin sides are kept). */
  const prevOf = (id: string) => (opts.previous && !affected.has(id) ? opts.previous.parts[id] : undefined);
  /** Previous position of any part that existed before (positions and order are kept where possible). */
  const prevPos = (id: string) => opts.previous?.parts[id];
  const circuit = project.circuit;
  const defs = pinDefsOf(circuit);
  if (!circuit.parts.length) return { status: "invalid_input", pinDefs: defs, issues: ["the circuit has no parts, so there is nothing to draw."], notes };
  for (const p of circuit.parts) if (!defs[p.id]) return { status: "invalid_input", pinDefs: defs, issues: [`E201 unknown part type "${p.type}" (${p.id}).`], notes };
  for (const s of Object.values(BUILTIN)) checkSymbol(s);
  const v = validate(circuit, defs);
  if (!v.valid) return { status: "invalid_input", pinDefs: defs, issues: v.issues.map((i) => `${i.code} ${i.message}`), notes };
  const vc = v.valid;
  const ncSet = new Set(vc.nc.map(canonical));

  // Which terminals are drawn, and for which net (SPEC 6.2 "as written", group representative).
  const drawnNet = new Map<string, string>(); // "R1[1]" -> net id
  for (const [netId, eps] of vc.endpoints) for (const ep of eps) {
    const num = ep.kind === "terminal" ? ep.number : groupRepresentative(ep.part, ep.group, defs, ncSet)!;
    drawnNet.set(`${ep.part}[${num}]`, netId);
  }
  const netById = new Map(circuit.nets.map((n) => [n.id, n]));

  // Step 3 (0a): power/ground nets with 3+ endpoints become ports; everything else is wired.
  const portNet = new Set<string>();
  for (const n of circuit.nets) {
    const k = netKind(n);
    if ((k === "power" || k === "ground") && n.name !== undefined && new Set(vc.endpoints.get(n.id)!.map(canonical)).size >= 3) portNet.add(n.id);
  }
  const wired = circuit.nets.filter((n) => !portNet.has(n.id));

  // Adjacency over wired nets.
  const partsOfNet = new Map<string, string[]>();
  for (const n of circuit.nets) partsOfNet.set(n.id, [...new Set(vc.endpoints.get(n.id)!.map((e) => e.part))].sort(cmpStr));
  const neighbours = new Map<string, Set<string>>(circuit.parts.map((p) => [p.id, new Set<string>()]));
  for (const n of wired) for (const a of partsOfNet.get(n.id)!) for (const b of partsOfNet.get(n.id)!) if (a !== b) neighbours.get(a)!.add(b);
  // Flow ignores ground nets (SPEC 9.2 step 2.1); wired supply nets still carry flow from a source.
  const flowNeighbours = new Map<string, Set<string>>(circuit.parts.map((p) => [p.id, new Set<string>()]));
  for (const n of wired) if (netKind(n) !== "ground") for (const a of partsOfNet.get(n.id)!) for (const b of partsOfNet.get(n.id)!) if (a !== b) flowNeighbours.get(a)!.add(b);

  // Step 2: ranks by breadth-first distance from sources.
  const ids = circuit.parts.map((p) => p.id).sort(cmpStr);
  const partOf = new Map(circuit.parts.map((p) => [p.id, p]));
  const isSource = (id: string) => BUILTIN[partOf.get(id)!.type]?.kind === "source" || partOf.get(id)!.props?.controller === "true" || partOf.get(id)!.props?.flow === "input";
  const rank = new Map<string, number>();
  const bfs = (starts: string[], base: number) => {
    const q = [...starts];
    for (const s of starts) rank.set(s, base);
    while (q.length) {
      const u = q.shift()!;
      for (const w of [...flowNeighbours.get(u)!].sort(cmpStr)) if (!rank.has(w)) { rank.set(w, rank.get(u)! + 1); q.push(w); }
    }
  };
  const sources = ids.filter(isSource);
  bfs(sources.length ? sources : ids.slice(0, 1), 0);
  for (const id of ids) if (!rank.has(id)) { notes.push(`${id} is not reached from any source; ranked separately (low confidence).`); bfs([id], Math.max(...rank.values(), -1) + 1); }

  // Taps (a two-pin part with one wired pin and one port) sit half a column upstream.
  const pinsOn = (id: string) => [...drawnNet.entries()].filter(([t]) => t.startsWith(`${id}[`)).map(([t, n]) => ({ number: t.slice(id.length + 1, -1), net: n }));
  const colValue = new Map<string, number>();
  for (const id of ids) {
    const sym = BUILTIN[partOf.get(id)!.type];
    const on = pinsOn(id);
    const tap = sym?.kind === "two-pin" && on.filter((p) => portNet.has(p.net)).length === 1 && on.filter((p) => !portNet.has(p.net)).length === 1;
    colValue.set(id, rank.get(id)! - (tap && rank.get(id)! > 0 ? 0.5 : 0));
  }
  const colVals = [...new Set(colValue.values())].sort((a, b) => a - b);
  const colOf = new Map(ids.map((id) => [id, colVals.indexOf(colValue.get(id)!)]));

  // Average column of the other parts on a net (for pin sides and left/right choice).
  const netCol = (netId: string, self: string) => {
    const others = partsOfNet.get(netId)!.filter((p) => p !== self);
    return others.length ? others.reduce((s, p) => s + colOf.get(p)!, 0) / others.length : undefined;
  };

  // Steps 3b and 4: orientation, measurement, labels, ports.
  const placed = new Map<string, Placed>();
  for (const id of ids) {
    const part = partOf.get(id)!;
    const col = colOf.get(id)!;
    let sym: SymbolDef;
    let orient: Orient = { rot: 0, flip: false };
    if (BUILTIN[part.type]) {
      sym = BUILTIN[part.type]!;
      if (sym.kind === "source") orient = { rot: 90, flip: false }; // "+" (left pin) up
      else if (sym.kind === "two-pin") orient = twoPinOrient(sym, id, drawnNet, netById, portNet, netCol);
    } else {
      sym = icFor(id, defs[id]!, drawnNet, netById, ncSet, col, netCol, opts.place?.[id]?.sides ?? sidesHint.get(id) ?? prevOf(id)?.sides);
    }
    // Orientation precedence: fixed placement, lock, orient hint, previous layout, default.
    const lockOf = locks.get(id), oh = orientHint.get(id), prev = prevOf(id);
    if (opts.place?.[id]?.orient) orient = opts.place[id]!.orient!;
    else if (lockOf) orient = { rot: lockOf.rot, flip: lockOf.flip };
    else if (oh) orient = { rot: oh.rot, flip: oh.flip };
    else if (prev) orient = prev.orient;
    const ko = xformBox(keepOut(sym), [0, 0], orient);
    const pins = sym.pins
      .filter((p) => drawnNet.has(`${id}[${p.number}]`) || ncSet.has(`${id}[${p.number}]`) || sym.kind !== "ic")
      .map((p) => ({ number: p.number, at: xformPt(p.at, [0, 0], orient), dir: xformDir(p.dir, orient) }));
    const ports: Placed["ports"] = [];
    for (const p of pins) {
      const netId = drawnNet.get(`${id}[${p.number}]`);
      if (!netId || !portNet.has(netId)) continue;
      const net = netById.get(netId)!;
      const kind = netKind(net) === "ground" ? "ground" : "power";
      const want: Dir = kind === "ground" ? "down" : "up";
      // A side pin's stub runs out far enough that the symbol and its text clear the part.
      const half = Math.max(1, (portText(kind, net) ? measure(portText(kind, net)!, LABEL_SIZE).width / 10 : 0) / 2);
      const out = isHorizontal(p.dir) ? Math.max(1, Math.ceil(half)) : 1;
      let stub: Pt[];
      if (p.dir === want) stub = [];
      else if (isHorizontal(p.dir)) stub = [p.at, step(p.at, p.dir, out), step(step(p.at, p.dir, out), want)];
      else {
        // The pin faces away from where the symbol must point (a flipped pull-up): leave the pin,
        // step sideways clear of the part, and enter the symbol from the correct side.
        const a = step(p.at, p.dir, 2), b = step(a, "right", Math.ceil(half) + 2);
        stub = [p.at, a, b, step(b, want)];
      }
      const anchor = stub.length ? stub[stub.length - 1]! : p.at;
      ports.push({ pin: p.number, net, anchor, stub, kind, box: portBox(kind, net, anchor) });
    }
    // Labels must keep clear of port symbols and of every pin's approach point.
    const approachBoxes = pins.map((p): Box => { const a = step(p.at, p.dir); return { x: a[0] - 0.5, y: a[1] - 0.5, w: 1, h: 1 }; });
    const labels = labelFor(part, sym, orient, ko, [...ports.map((q) => q.box), ...approachBoxes], intent.overrides?.labelSide?.[id]);
    let env = ko;
    for (const l of labels) env = unionBox(env, gridBox(l.box));
    for (const q of ports) env = unionBox(env, q.box);
    placed.set(id, { id, sym, orient, col, rank: rank.get(id)!, ko, labels, ports, env, pins });
  }

  // Ordering candidate B: barycentre sweeps (fixed count) within each column.
  const columns: string[][] = colVals.map((_, c) => ids.filter((id) => colOf.get(id) === c));
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? columns.map((_, i) => i) : columns.map((_, i) => columns.length - 1 - i);
    for (const c of order) {
      const ref = forward ? c - 1 : c + 1;
      if (ref < 0 || ref >= columns.length) continue;
      const pos = new Map(columns[ref]!.map((id, i) => [id, i]));
      const cur = new Map(columns[c]!.map((id, i) => [id, i]));
      // Position of a neighbour = its index plus where the shared net's pin sits on it,
      // so pins that are higher on a neighbour pull their part higher (fewer crossings).
      const pinFrac = (n: string, self: string) => {
        const P = placed.get(n)!;
        const shared = P.pins.filter((p) => { const net = drawnNet.get(`${n}[${p.number}]`); return net !== undefined && partsOfNet.get(net)!.includes(self); });
        if (!shared.length || P.env.h === 0) return 0.5;
        return shared.reduce((s, p) => s + (p.at[1] - P.env.y) / P.env.h, 0) / shared.length;
      };
      const bary = (id: string) => {
        const ns = [...neighbours.get(id)!].filter((n) => pos.has(n));
        return ns.length ? ns.reduce((s, n) => s + pos.get(n)! + pinFrac(n, id), 0) / ns.length : cur.get(id)! + 0.5;
      };
      columns[c] = [...columns[c]!].sort((a, b) => bary(a) - bary(b) || cur.get(a)! - cur.get(b)! || cmpStr(a, b));
    }
  }
  // Incremental mode: parts from the previous layout keep their previous top-to-bottom order;
  // new or affected parts keep the slots the sweeps gave them (SPEC 9.5 ordering cost).
  if (opts.previous) for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!;
    const kept = col.filter((id) => prevPos(id)).sort((a, b) => prevPos(a)!.at[1] - prevPos(b)!.at[1] || cmpStr(a, b));
    let k = 0;
    columns[c] = col.map((id) => (prevPos(id) ? kept[k++]! : id));
  }

  // Step 6: difference constraints in x and y.
  // setSpacing factor f adds round((f - 1) * 4) G to every gap.
  const spacing = (opts.spacing ?? 0) + Math.max(0, Math.round(((intent.spacing ?? 1) - 1) * 4));
  const spans = (i: number) => wired.filter((n) => {
    const cs = partsOfNet.get(n.id)!.map((p) => colOf.get(p)!);
    return Math.min(...cs) <= i && Math.max(...cs) >= i + 1;
  }).length;
  const internal = (c: number) => wired.filter((n) => { const ps = partsOfNet.get(n.id)!; return ps.length >= 2 && ps.every((p) => colOf.get(p) === c); }).length;
  const through = (c: number) => wired.filter((n) => { const cs = partsOfNet.get(n.id)!.map((p) => colOf.get(p)!); return Math.min(...cs) < c && Math.max(...cs) > c; }).length;
  const cons: Constraint[] = [];
  const vx = (id: string) => `x:${id}`, vy = (id: string) => `y:${id}`;
  for (const id of ids) {
    const e = placed.get(id)!.env;
    cons.push({ a: vx(id), b: X0, c: MARGIN - e.x, priority: "structural", why: `margin ${id}` });
    cons.push({ a: vy(id), b: X0, c: MARGIN - e.y, priority: "structural", why: `margin ${id}` });
  }
  for (let c = 0; c + 1 < columns.length; c++) {
    const gap = 2 + spans(c) + internal(c) + internal(c + 1) + spacing;
    for (const a of columns[c]!) for (const b of columns[c + 1]!) {
      const ea = placed.get(a)!.env, eb = placed.get(b)!.env;
      // Incremental mode: two parts that existed before and were not side by side (their rows
      // did not overlap, with 1 G to spare) need no horizontal separation (SPEC 9.5 stability).
      const pa = prevPos(a), pb = prevPos(b);
      if (pa && pb && (pa.at[1] + ea.y + ea.h + 1 <= pb.at[1] + eb.y || pb.at[1] + eb.y + eb.h + 1 <= pa.at[1] + ea.y)) continue;
      cons.push({ a: vx(b), b: vx(a), c: gap + ea.x + ea.w - eb.x, priority: "structural", why: `column ${c} before ${c + 1}` });
    }
  }
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!;
    const gapY = 2 + through(c) + spacing;
    for (let i = 0; i + 1 < col.length; i++) {
      const ea = placed.get(col[i]!)!.env, eb = placed.get(col[i + 1]!)!.env;
      cons.push({ a: vy(col[i + 1]!), b: vy(col[i]!), c: gapY + ea.y + ea.h - eb.y, priority: "structural", why: `order in column ${c}` });
    }
  }
  const vars = ids.flatMap((id) => [vx(id), vy(id)]);
  const known = new Set(ids);
  for (const l of locks.values()) if (known.has(l.part)) cons.push(...eq(vx(l.part), X0, l.x, "lock", `lock ${l.part}`), ...eq(vy(l.part), X0, l.y, "lock", `lock ${l.part}`));
  for (const h of hints) {
    if (h.type === "relative" && known.has(h.part) && known.has(h.of)) {
      const ep = placed.get(h.part)!.env, eo = placed.get(h.of)!.env;
      const why = `hint ${h.id}: ${h.part} ${h.rel} ${h.of}`;
      if (h.rel === "right-of") cons.push({ a: vx(h.part), b: vx(h.of), c: eo.x + eo.w + 2 - ep.x, priority: h.priority, why });
      if (h.rel === "left-of") cons.push({ a: vx(h.of), b: vx(h.part), c: ep.x + ep.w + 2 - eo.x, priority: h.priority, why });
      if (h.rel === "below") cons.push({ a: vy(h.part), b: vy(h.of), c: eo.y + eo.h + 2 - ep.y, priority: h.priority, why });
      if (h.rel === "above") cons.push({ a: vy(h.of), b: vy(h.part), c: ep.y + ep.h + 2 - eo.y, priority: h.priority, why });
    }
    if (h.type === "align") {
      const ps = h.parts.filter((x) => known.has(x));
      const al = (id: string) => { const P = placed.get(id)!; return xformPt(P.sym.align, [0, 0], P.orient); };
      for (let i = 1; i < ps.length; i++) {
        const [a, b] = [ps[i - 1]!, ps[i]!];
        if (h.axis === "row") cons.push(...eq(vy(b), vy(a), al(a)[1] - al(b)[1], h.priority, `hint ${h.id}: row ${ps.join(" ")}`));
        else cons.push(...eq(vx(b), vx(a), al(a)[0] - al(b)[0], h.priority, `hint ${h.id}: column ${ps.join(" ")}`));
      }
    }
  }
  // Incremental mode: untouched parts stay put. Lower bounds (never leftward or upward) keep the
  // solve feasible; upper bounds are dropped first when something must make room (SPEC 9.5).
  for (const id of ids) {
    const prev = prevPos(id);
    if (!prev || locks.has(id)) continue;
    const priority = affected.has(id) ? "prevAffected" : "prev";
    for (const [v, c] of [[vx(id), prev.at[0]], [vy(id), prev.at[1]]] as const) {
      cons.push({ a: v, b: X0, c, priority, why: `previous ${id}` });
      cons.push({ a: X0, b: v, c: -c, priority, why: `previous ${id}` });
    }
  }
  const place = opts.place;
  if (place) {
    const missing = ids.filter((id) => !place[id]);
    if (missing.length) return { status: "invalid_input", pinDefs: defs, issues: [`placement must cover every part; missing ${missing.join(", ")}`], notes };
    cons.length = 0;
    for (const id of ids) cons.push(...eq(vx(id), X0, place[id]!.at[0], "lock", `lock ${id}`), ...eq(vy(id), X0, place[id]!.at[1], "lock", `lock ${id}`));
  }
  let sol = solveWithDrops(vars, cons, 50 + 2 * ids.length);
  if (!sol.ok) return { status: sol.reason, pinDefs: defs, issues: [`placement constraints conflict: ${sol.cycle.map((k) => k.why).join("; ")}`], notes };
  for (const why of [...new Set(sol.dropped.filter((k) => k.why.startsWith("hint ")).map((k) => k.why))]) notes.push(`dropped ${why} (it conflicts with stronger constraints; use priority high to keep it)`);
  const dropped = new Set(sol.dropped);
  const active = cons.filter((k) => !dropped.has(k));

  // Straight-wire pass: try to line up horizontal pins of the same net, one equality at a time.
  const candidates: Array<{ k: Constraint[]; order: [number, string] }> = [];
  for (const n of [...wired].sort((a, b) => cmpStr(netKey(a, vc), netKey(b, vc)))) {
    const ps = [...drawnNet.entries()].filter(([, nn]) => nn === n.id).map(([t]) => t).sort(cmpStr);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const [pa, pb] = [pinInfo(ps[i]!, placed), pinInfo(ps[j]!, placed)];
      if (pa.part === pb.part) continue;
      const ca = colOf.get(pa.part)!, cb = colOf.get(pb.part)!;
      if (ca === cb) continue;
      const tag = `${netKey(n, vc)}|${ps[i]}|${ps[j]}`;
      if (isHorizontal(pa.dir) && isHorizontal(pb.dir)) {
        candidates.push({ k: eq(vy(pb.part), vy(pa.part), pa.at[1] - pb.at[1], "align", `straight ${ps[i]}-${ps[j]}`), order: [Math.abs(ca - cb), tag] });
      } else if (isHorizontal(pa.dir) !== isHorizontal(pb.dir)) {
        // One bend: the sideways pin's row sits 2 G beyond the up/down pin, on the side it faces.
        const [h, vv] = isHorizontal(pa.dir) ? [pa, pb] : [pb, pa];
        const off = vv.dir === "up" ? -2 : 2;
        candidates.push({ k: eq(vy(h.part), vy(vv.part), vv.at[1] + off - h.at[1], "align", `corner ${ps[i]}-${ps[j]}`), order: [Math.abs(ca - cb) + 0.5, tag] });
      }
    }
  }
  candidates.sort((a, b) => a.order[0] - b.order[0] || cmpStr(a.order[1], b.order[1]));
  const kept: Constraint[] = [];
  for (const cand of candidates) {
    const trial = solveWithDrops(vars, [...active, ...kept, ...cand.k], 0);
    if (trial.ok) { kept.push(...cand.k); sol = trial; }
  }
  const pos = sol.value;

  // Absolute geometry.
  const at = (id: string): Pt => [pos.get(vx(id))!, pos.get(vy(id))!];
  const obstacles: Obstacle[] = [];
  const el: Electrical = { pins: [], keepouts: [], wires: [], dots: [], ports: [], ncMarks: [] };
  const art: Art[] = [];
  for (const id of ids) {
    const P = placed.get(id)!;
    const o = at(id);
    const ko = shift(P.ko, o);
    obstacles.push({ ...ko, owner: id });
    el.keepouts!.push({ ...ko, part: id });
    for (const p of P.pins) {
      const drawnPin: DrawnPin = { part: id, number: p.number, at: [o[0] + p.at[0], o[1] + p.at[1]], dir: p.dir };
      el.pins.push(drawnPin);
      if (ncSet.has(`${id}[${p.number}]`)) el.ncMarks.push({ part: id, number: p.number });
    }
    for (const l of P.labels) {
      const b = shift(l.box, o);
      const ob = obstacleFromLabel(b, `label:${id}`);
      obstacles.push(ob);
      el.keepouts!.push({ ...ob, part: ob.owner });
    }
    for (const q of P.ports) {
      const b = shift(q.box, o);
      obstacles.push({ ...b, owner: `port:${id}[${q.pin}]` });
      el.keepouts!.push({ ...b, part: `port:${id}[${q.pin}]` });
      const port: DrawnPort = { at: [o[0] + q.anchor[0], o[1] + q.anchor[1]], text: q.net.name!, domain: q.net.domain ?? null, kind: q.kind };
      el.ports.push(port);
    }
  }

  // Step 7: route wired nets; port stubs are pre-wired.
  const requests: NetRequest[] = [];
  for (const n of circuit.nets) {
    const terms = [...drawnNet.entries()].filter(([, nn]) => nn === n.id).map(([t]) => {
      const p = el.pins.find((q) => `${q.part}[${q.number}]` === t)!;
      return { id: t, at: p.at, dir: p.dir };
    });
    terms.sort((a, b) => colOf.get(partOfTerm(a.id))! - colOf.get(partOfTerm(b.id))! || cmpStr(a.id, b.id));
    if (portNet.has(n.id)) {
      const prewired: Array<[Pt, Pt]> = [];
      for (const id of ids) for (const q of placed.get(id)!.ports) if (q.net.id === n.id && q.stub.length) {
        const o = at(id);
        const s = q.stub.map((p): Pt => [o[0] + p[0], o[1] + p[1]]);
        for (let i = 0; i + 1 < s.length; i++) prewired.push([s[i]!, s[i + 1]!]);
      }
      requests.push({ net: n.id, terminals: terms, prewired, noRoute: true });
    } else if (opts.previous && opts.reuseRoutes !== false && opts.previous.routes[n.id]?.terminals === signature(terms)) {
      // Incremental mode: a net whose drawn terminals did not move keeps its route.
      requests.push({ net: n.id, terminals: terms, prewired: opts.previous.routes[n.id]!.runs.flatMap((w) => unitEdges(w)), noRoute: true });
    } else requests.push({ net: n.id, terminals: terms, ...(opts.prewire?.[n.id] ? { prewired: opts.prewire[n.id]!.flatMap((w) => unitEdges(w)) } : {}) });
  }
  requests.sort((a, b) => Number(!a.noRoute) - Number(!b.noRoute) || a.terminals.length - b.terminals.length || cmpStr(netKey(netById.get(a.net)!, vc), netKey(netById.get(b.net)!, vc)));
  // Sheet bounds start from the first part, not from the origin (an origin start left a blank band).
  let bounds: Box = shift(placed.get(ids[0]!)!.env, at(ids[0]!));
  for (const id of ids) bounds = unionBox(bounds, shift(placed.get(id)!.env, at(id)));
  const routeBounds = { x: bounds.x - 4, y: bounds.y - 4, w: bounds.w + 8, h: bounds.h + 8 };
  const routed = route(requests, obstacles, routeBounds);
  const failed = routed.flatMap((r) => r.failed.map((f) => `${f} (net ${r.net})`));
  if (failed.length && spacing < 6 && !place) {
    notes.push(`routing failed for ${failed.join(", ")}; retrying with spacing +2 G`);
    const again = layout(project, { ...opts, spacing: (opts.spacing ?? 0) + 2 });
    again.notes.unshift(...notes);
    return again;
  }

  for (const r of routed) {
    el.wires.push(...mergeRuns(r.edges));
    const deg = new Map<string, number>();
    for (const [a, b] of r.edges) for (const p of [a, b]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
    for (const [k, d] of [...deg].sort((x, y) => cmpStr(x[0], y[0]))) if (d >= 3) el.dots.push(k.split(",").map(Number) as unknown as Pt);
    for (const [a, b] of r.edges) bounds = unionBox(bounds, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
  }

  // Artwork.
  for (const id of ids) {
    const P = placed.get(id)!;
    const o = at(id);
    for (const g of P.sym.graphics) art.push({ t: "path", d: xformPath(g.d, o, P.orient), fill: g.fill ?? "none" });
    if (P.sym.kind === "ic") {
      for (const p of P.pins) {
        const name = defs[id]!.find((d) => d.number === p.number)!.name;
        const a: Pt = [o[0] + p.at[0], o[1] + p.at[1]];
        const inset = 1.5;
        if (p.dir === "left") art.push({ t: "text", x: a[0] + inset, y: a[1], text: name, size: PIN_SIZE, anchor: "start", baseline: "middle", owner: `pin:${id}[${p.number}]` });
        else if (p.dir === "right") art.push({ t: "text", x: a[0] - inset, y: a[1], text: name, size: PIN_SIZE, anchor: "end", baseline: "middle", owner: `pin:${id}[${p.number}]` });
        else if (p.dir === "up") art.push({ t: "text", x: a[0], y: a[1] + inset, text: name, size: PIN_SIZE, anchor: "middle", baseline: "top", owner: `pin:${id}[${p.number}]` });
        else art.push({ t: "text", x: a[0], y: a[1] - inset, text: name, size: PIN_SIZE, anchor: "middle", baseline: "bottom", owner: `pin:${id}[${p.number}]` });
      }
    }
    for (const l of P.labels) {
      const b = shift(l.box, o);
      l.lines.forEach((line, i) => {
        const x = l.align === "start" ? b.x : l.align === "end" ? b.x + b.w : b.x + b.w / 2;
        art.push({ t: "text", x, y: b.y + i * LINE, text: line, size: LABEL_SIZE, anchor: l.align, baseline: "top", owner: `label:${id}` });
      });
    }
    for (const q of P.ports) {
      const a: Pt = [o[0] + q.anchor[0], o[1] + q.anchor[1]];
      const sym = BUILTIN[q.kind === "ground" ? "ground" : "supply"]!;
      for (const g of sym.graphics) art.push({ t: "path", d: xformPath(g.d, a, { rot: 0, flip: false }), fill: "none" });
      const text = portText(q.kind, q.net);
      if (text) {
        if (q.kind === "power") art.push({ t: "text", x: a[0], y: a[1] - 1.3, text, size: LABEL_SIZE, anchor: "middle", baseline: "bottom", owner: `port:${id}[${q.pin}]` });
        else art.push({ t: "text", x: a[0] + 1.4, y: a[1] + 1.4, text, size: LABEL_SIZE, anchor: "start", baseline: "middle", owner: `port:${id}[${q.pin}]` });
      }
    }
    for (const p of P.pins) if (ncSet.has(`${id}[${p.number}]`)) {
      const [x, y] = [o[0] + p.at[0], o[1] + p.at[1]];
      art.push({ t: "path", d: `M${(x - 0.4) * 10} ${(y - 0.4) * 10} L${(x + 0.4) * 10} ${(y + 0.4) * 10} M${(x - 0.4) * 10} ${(y + 0.4) * 10} L${(x + 0.4) * 10} ${(y - 0.4) * 10}` });
    }
  }
  for (const r of routed) for (const w of mergeRuns(r.edges)) art.push({ t: "path", d: w.map((p, i) => `${i ? "L" : "M"}${p[0] * 10} ${p[1] * 10}`).join(" ") });
  for (const d of el.dots) art.push({ t: "path", d: circle(d[0] * 10, d[1] * 10, 3.5), fill: "stroke" });

  const sheet = { x: bounds.x - MARGIN, y: bounds.y - MARGIN, w: bounds.w + 2 * MARGIN, h: bounds.h + 2 * MARGIN };
  const render: RenderModel = { electrical: el, art, bounds: sheet, meta: project.meta?.title ? { title: project.meta.title } : {} };
  const lowConfidence = notes.some((n) => n.includes("low confidence"));
  // Step 8: a drawing is valid only if verification layers 1 and 2 pass on the render model.
  if (!failed.length) {
    const q = checkDrawing(circuit, defs, render);
    if (!q.valid) {
      const why = [...q.connections.errors.map((e) => e.message), ...q.overlaps.map((o) => o.message)];
      return { status: "budget_exhausted", render, pinDefs: defs, issues: why.map((w) => `check: ${w}`), notes, state: stateOf() };
    }
  }
  return { status: failed.length ? "budget_exhausted" : lowConfidence ? "valid_low_confidence" : "valid", render, pinDefs: defs, issues: failed.map((f) => `could not route ${f}`), notes, state: stateOf() };

  function stateOf(): LayoutState {
  const state: LayoutState = { parts: {}, routes: {} };
  for (const id of ids) {
    const P = placed.get(id)!;
    const entry: LayoutState["parts"][string] = { at: at(id), orient: P.orient };
    if (P.sym.kind === "ic") {
      const side = (d: Dir): Side => (d === "left" ? "left" : d === "right" ? "right" : d === "up" ? "top" : "bottom");
      const sides: Partial<Record<Side, string[]>> = {};
      for (const p of [...P.sym.pins].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0])) (sides[side(p.dir)] ??= []).push(p.number);
      entry.sides = sides;
    }
    state.parts[id] = entry;
  }
  for (const r of routed) {
    const req = requests.find((q) => q.net === r.net)!;
    state.routes[r.net] = { terminals: signature(req.terminals), runs: mergeRuns(r.edges), ...(portNet.has(r.net) ? { ports: true as const } : {}) };
  }
  return state;
  }
}

// ---------------------------------------------------------------------------

/** Drawn terminals of a net with positions and directions; equal signatures mean the same pins in the same places. */
function signature(terms: readonly { id: string; at: Pt; dir: Dir }[]): string {
  return terms.map((t) => `${t.id}@${t.at[0]},${t.at[1]},${t.dir}`).sort(cmpStr).join(";");
}

function partOfTerm(t: string): string { return t.slice(0, t.indexOf("[")); }

/** Canonical key of a net: its smallest canonical endpoint (SPEC 9.6). Never the storage id. */
function netKey(n: Net, vc: ValidCircuit): string {
  return vc.endpoints.get(n.id)!.map(canonical).sort(cmpStr)[0] ?? "";
}

function pinInfo(t: string, placed: Map<string, Placed>) {
  const part = partOfTerm(t), num = t.slice(part.length + 1, -1);
  const p = placed.get(part)!.pins.find((q) => q.number === num)!;
  return { part, at: p.at, dir: p.dir };
}

function shift(b: Box, o: Pt): Box { return { x: b.x + o[0], y: b.y + o[1], w: b.w, h: b.h }; }

/** SPEC 9.2 step 3b for two-pin parts. */
function twoPinOrient(
  sym: SymbolDef, id: string, drawnNet: Map<string, string>, netById: Map<string, Net>, portNet: Set<string>,
  netCol: (net: string, self: string) => number | undefined,
): Orient {
  const [p1, p2] = sym.pins as [SymbolDef["pins"][0], SymbolDef["pins"][0]];
  const n1 = drawnNet.get(`${id}[${p1.number}]`), n2 = drawnNet.get(`${id}[${p2.number}]`);
  const kind = (n?: string) => (n ? netKind(netById.get(n)!) : undefined);
  // Pin 1 is at the local left (dir left), pin 2 at the right. rot 90: pin1 up; rot 270: pin1 down.
  if (kind(n2) === "ground") return { rot: 90, flip: false };
  if (kind(n1) === "ground") return { rot: 270, flip: false };
  if (n1 && portNet.has(n1) && kind(n1) === "power") return { rot: 90, flip: false };
  if (n2 && portNet.has(n2) && kind(n2) === "power") return { rot: 270, flip: false };
  const c1 = n1 ? netCol(n1, id) : undefined, c2 = n2 ? netCol(n2, id) : undefined;
  if (c1 !== undefined && c2 !== undefined && c2 < c1) return { rot: 180, flip: false };
  return { rot: 0, flip: false };
}

/** Generated IC box with pin sides from roles and flow (SPEC 7.3); only drawn pins appear. */
function icFor(
  id: string, pins: PinDef[], drawnNet: Map<string, string>, netById: Map<string, Net>, ncSet: Set<string>, col: number,
  netCol: (net: string, self: string) => number | undefined,
  forced?: Partial<Record<Side, string[]>>,
): SymbolDef {
  const visible = pins.filter((p) => drawnNet.has(`${id}[${p.number}]`) || ncSet.has(`${id}[${p.number}]`));
  const sides = { left: [] as PinDef[], right: [] as PinDef[], top: [] as PinDef[], bottom: [] as PinDef[] };
  for (const p of visible) {
    const netId = drawnNet.get(`${id}[${p.number}]`);
    const kind = netId ? netKind(netById.get(netId)!) : undefined;
    if (Object.values(forced ?? {}).some((ns) => ns.includes(p.number))) continue;
    if (p.role === "ground" || kind === "ground") sides.bottom.push(p);
    else if (p.role === "power_in" || kind === "power") sides.top.push(p);
    else {
      const c = netId ? netCol(netId, id) : undefined;
      (c !== undefined && c < col ? sides.left : sides.right).push(p);
    }
  }
  const sortKey = (p: PinDef) => { const n = drawnNet.get(`${id}[${p.number}]`); const net = n ? netById.get(n) : undefined; return net?.name ?? `~${p.number}`; };
  for (const s of Object.values(sides)) s.sort((a, b) => cmpStr(sortKey(a), sortKey(b)) || cmpNatural(a.number, b.number));
  // Forced sides (SPEC 11.3 setPinSides): listed pins first, in the given order.
  for (const [side, ns] of Object.entries(forced ?? {}) as Array<[Side, string[]]>) {
    sides[side].unshift(...ns.map((n) => visible.find((p) => p.number === n)).filter((p): p is PinDef => p !== undefined));
  }
  const textW = (ps: PinDef[]) => Math.max(0, ...ps.map((p) => measure(p.name, PIN_SIZE).width / 10));
  const inner = Math.ceil(textW(sides.left) + textW(sides.right) + 3);
  const pitch = Math.max(2, Math.ceil(textW([...sides.top, ...sides.bottom]) + 1));
  return icSymbol(sides, inner, pitch);
}

function portText(kind: "ground" | "power", net: Net): string | undefined {
  if (kind === "ground" && net.name === "GND" && !net.domain) return undefined; // default ground: symbol only
  return net.domain ? `${net.name} (${net.domain})` : net.name;
}

function portBox(kind: "ground" | "power", net: Net, a: Pt): Box {
  const text = portText(kind, net);
  const tw = text ? measure(text, LABEL_SIZE).width / 10 : 0;
  if (kind === "ground") {
    const b: Box = { x: a[0] - 1, y: a[1], w: 2, h: 2 };
    return text ? gridBox(unionBox(b, { x: a[0] + 1.4, y: a[1] + 0.6, w: tw, h: 1.6 })) : b;
  }
  return gridBox(unionBox({ x: a[0] - 1, y: a[1] - 1, w: 2, h: 1 }, { x: a[0] - tw / 2, y: a[1] - 2.9, w: tw, h: 1.6 }));
}

function displayValue(type: string, raw: string): string {
  const unit = quantityOf(type, "value");
  if (!unit) return raw;
  const q = parseQuantity(raw, unit);
  if (!q.ok) return raw;
  const sym = { ohm: "Ω", farad: "F", henry: "H", volt: "V", amp: "A", hertz: "Hz" }[unit];
  const pre: Array<[number, string]> = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [mult, p] = pre.find(([m]) => Math.abs(q.value) >= m * 0.999) ?? [1e-12, "p"];
  const n = Number((q.value / mult).toPrecision(3));
  return `${n} ${p}${sym}`;
}

function labelFor(part: Circuit["parts"][0], sym: SymbolDef, o: Orient, ko: Box, avoid: Box[], side?: string): Placed["labels"] {
  if (sym.kind === "port") return [];
  const lines = [part.id];
  const value = part.props?.value ?? part.props?.label ?? part.props?.color;
  if (value) lines.push(sym.kind === "ic" ? value : displayValue(part.type, value));
  const w = Math.max(...lines.map((l) => measure(l, LABEL_SIZE).width / 10));
  const h = lines.length * LINE;
  const vertical = (sym.kind === "two-pin" || sym.kind === "source") && (o.rot === 90 || o.rot === 270);
  const prefer = sym.kind === "ic"
    ? ["above-left", "above-right", "below-left", "below-right", "above-left-out", "above-right-out", "below-left-out", "below-right-out", "left", "right"]
    : vertical ? (sym.kind === "source" ? ["left", "right"] : ["right", "left"]) : sym.labelPrefer;
  const order = side ? [side, ...prefer.filter((x) => x !== side)] : prefer; // label-side override first (SPEC 6.4)
  const gap = 0.4;
  const cands: Record<string, { box: Box; align: "start" | "middle" | "end" }> = {
    above: { box: { x: ko.x + ko.w / 2 - w / 2, y: ko.y - gap - h, w, h }, align: "middle" },
    below: { box: { x: ko.x + ko.w / 2 - w / 2, y: ko.y + ko.h + gap, w, h }, align: "middle" },
    right: { box: { x: ko.x + ko.w + gap, y: ko.y + ko.h / 2 - h / 2, w, h }, align: "start" },
    left: { box: { x: ko.x - gap - w, y: ko.y + ko.h / 2 - h / 2, w, h }, align: "end" },
    "above-left": { box: { x: ko.x + 1, y: ko.y - gap - h, w, h }, align: "start" },
    "above-right": { box: { x: ko.x + ko.w - 1 - w, y: ko.y - gap - h, w, h }, align: "end" },
    "below-left": { box: { x: ko.x + 1, y: ko.y + ko.h + gap, w, h }, align: "start" },
    "below-right": { box: { x: ko.x + ko.w - 1 - w, y: ko.y + ko.h + gap, w, h }, align: "end" },
    "above-left-out": { box: { x: ko.x + 1 - w, y: ko.y - gap - h, w, h }, align: "end" },
    "above-right-out": { box: { x: ko.x + ko.w - 1, y: ko.y - gap - h, w, h }, align: "start" },
    "below-left-out": { box: { x: ko.x + 1 - w, y: ko.y + ko.h + gap, w, h }, align: "end" },
    "below-right-out": { box: { x: ko.x + ko.w - 1, y: ko.y + ko.h + gap, w, h }, align: "start" },
  };
  for (const pick of order) {
    const c = cands[pick]!;
    if (!avoid.some((b) => boxesOverlap(gridBox(c.box), b))) return [{ box: c.box, lines, align: c.align }];
  }
  const c = cands[order[0]!]!;
  return [{ box: c.box, lines, align: c.align }];
}

/** Merge unit edges of one net into maximal straight runs (for drawing only). */
function mergeRuns(edges: Array<[Pt, Pt]>): Pt[][] {
  const set = new Set(edges.map(([a, b]) => edgeKey(a, b)));
  const done = new Set<string>();
  const runs: Pt[][] = [];
  const parse = (k: string) => k.split("|").map((s) => s.split(",").map(Number)) as unknown as [Pt, Pt];
  for (const k of [...set].sort(cmpStr)) {
    if (done.has(k)) continue;
    const [a, b] = parse(k);
    const horiz = a[1] === b[1];
    const d: Dir = horiz ? "right" : "down";
    const back: Dir = horiz ? "left" : "up";
    let s = a, e = b;
    done.add(k);
    for (;;) { const n = step(s, back); const nk = edgeKey(n, s); if (!set.has(nk) || done.has(nk)) break; done.add(nk); s = n; }
    for (;;) { const n = step(e, d); const nk = edgeKey(e, n); if (!set.has(nk) || done.has(nk)) break; done.add(nk); e = n; }
    runs.push([s, e]);
  }
  return runs;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

/** Transform symbol path data (M L H V A Z, absolute, local grid units) to sheet SVG units. */
export function xformPath(d: string, at: Pt, o: Orient): string {
  const tok = d.match(/[MLHVAZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0, cur: Pt = [0, 0];
  const num = () => Number(tok[i++]);
  const P = (p: Pt) => { const q = xformPt(p, at, o); return `${r2(q[0] * 10)} ${r2(q[1] * 10)}`; };
  const out: string[] = [];
  let cmd = "";
  while (i < tok.length) {
    if (/[MLHVAZ]/.test(tok[i]!)) cmd = tok[i++]!;
    switch (cmd) {
      case "M": case "L": cur = [num(), num()]; out.push(`${cmd}${P(cur)}`); break;
      case "H": cur = [num(), cur[1]]; out.push(`L${P(cur)}`); break;
      case "V": cur = [cur[0], num()]; out.push(`L${P(cur)}`); break;
      case "A": {
        const rx = num(), ry = num(), rotA = num(), large = num(), sweep = num();
        cur = [num(), num()];
        const [rxx, ryy] = o.rot === 90 || o.rot === 270 ? [ry, rx] : [rx, ry];
        out.push(`A${r2(rxx * 10)} ${r2(ryy * 10)} ${rotA} ${large} ${o.flip ? 1 - sweep : sweep} ${P(cur)}`);
        break;
      }
      case "Z": out.push("Z"); break;
      default: i++;
    }
  }
  return out.join(" ");
}

function r2(n: number): string { const v = Math.round(n * 100) / 100; return String(Object.is(v, -0) ? 0 : v); }

