// Grid router (SPEC 9.2 step 7). A* over (point, arrival direction) states.

import { cmpStr, DIRS, step, type Box, type Dir, type Pt } from "../geom/geom.js";
import { edgeForbidden, pointBlocked, type Obstacle } from "../geom/forbidden.js";

export interface Terminal { id: string; at: Pt; dir: Dir }
export interface NetRequest {
  net: string;
  terminals: Terminal[];
  prewired?: Array<[Pt, Pt]>;
  noRoute?: boolean;
  /** Prewired points that hold a supply symbol. The search must not join them (a symbol has exactly one wire). */
  seal?: Pt[];
}
export interface RoutedNet { net: string; edges: Array<[Pt, Pt]>; failed: string[] }

// hug: a unit step alongside another net's wire on the adjacent track (a squeezed run);
// jog: a bend within JOG steps of the path's previous bend (a short step), on top of the bend.
const COST = { step: 1, bend: 3, cross: 12, hug: 2, jog: 9 };
const JOG = 2; // as JOG_MAX in src/quality/metrics.ts
const EXPANSION_CAP = 60_000;

interface Occ { net: string; dirs: number } // directions used there, bit i for DIRS[i]

const RIP_UP_PASSES = 3;

// Grid points and unit edges as numbers: the string keys of geom.ts cost most of the search time.
// Coordinates within +-4096 G keep every key (point, edge, search state) a small integer.
const OFF = 1 << 12, SPAN = 1 << 13;
const pxy = (px: number, py: number): number => {
  const x = px + OFF, y = py + OFF;
  if (x < 0 || y < 0 || x >= SPAN || y >= SPAN) throw new Error(`router: grid point ${px},${py} is outside +-${OFF} G`);
  return x * SPAN + y;
};
const pid = (p: Pt): number => pxy(p[0], p[1]);
const unpid = (k: number): Pt => [Math.floor(k / SPAN) - OFF, (k % SPAN) - OFF];
const eid = (a: Pt, b: Pt): number => pid(a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a : b) * 2 + (a[1] === b[1] ? 0 : 1);
const DIR_INDEX: Record<Dir, number> = Object.fromEntries(DIRS.map((d, i) => [d, i])) as Record<Dir, number>;

/**
 * The forbidden geometry of `src/geom/forbidden.ts`, rasterised once per route call on a half grid
 * (grid points and unit-edge midpoints). Same closed-box test; points off the raster fall back to it.
 */
class Forbidden {
  private readonly x0: number; private readonly y0: number; private readonly w: number; private readonly h: number;
  private readonly cells: Uint8Array;
  constructor(private readonly obstacles: Obstacle[], bounds: Box) {
    this.x0 = Math.floor(2 * bounds.x); this.y0 = Math.floor(2 * bounds.y);
    this.w = Math.ceil(2 * (bounds.x + bounds.w)) - this.x0 + 1; this.h = Math.ceil(2 * (bounds.y + bounds.h)) - this.y0 + 1;
    this.cells = new Uint8Array(this.w * this.h);
    for (const o of obstacles) {
      const ua = Math.max(this.x0, Math.ceil(2 * o.x)), ub = Math.min(this.x0 + this.w - 1, Math.floor(2 * (o.x + o.w)));
      const va = Math.max(this.y0, Math.ceil(2 * o.y)), vb = Math.min(this.y0 + this.h - 1, Math.floor(2 * (o.y + o.h)));
      for (let v = va; v <= vb; v++) this.cells.fill(1, (v - this.y0) * this.w + ua - this.x0, (v - this.y0) * this.w + ub - this.x0 + 1);
    }
  }
  private at(x2: number, y2: number): boolean | undefined {
    const u = x2 - this.x0, v = y2 - this.y0;
    return u < 0 || v < 0 || u >= this.w || v >= this.h ? undefined : this.cells[v * this.w + u] === 1;
  }
  /** A grid point (x2, y2 both even) or a unit-edge midpoint (one odd), in half-grid units. */
  half(x2: number, y2: number): boolean {
    const r = this.at(x2, y2);
    if (r !== undefined) return r;
    const p: Pt = [x2 / 2, y2 / 2];
    return x2 % 2 === 0 && y2 % 2 === 0 ? pointBlocked(p, this.obstacles) : edgeForbidden(p, p, this.obstacles) !== undefined;
  }
  edge(a: Pt, b: Pt): boolean { return this.half(a[0] + b[0], a[1] + b[1]); }
}

export function route(requests: NetRequest[], obstacles: Obstacle[], bounds: Box): RoutedNet[] {
  const forbidden = new Forbidden(obstacles, bounds);
  let occ = new Map<number, Occ>();          // point -> owning net + directions used there
  let usedEdges = new Map<number, string>(); // unit edge -> net
  const pinPoint = new Map<number, string>();  // pin anchor -> net
  const approach = new Map<number, string>();  // approach point of a pin -> net
  for (const r of requests) for (const t of r.terminals) {
    pinPoint.set(pid(t.at), r.net);
    approach.set(pid(step(t.at, t.dir)), r.net);
  }
  const markEdge = (net: string, a: Pt, b: Pt) => {
    usedEdges.set(eid(a, b), net);
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const k = pid(p);
      const o = occ.get(k) ?? { net, dirs: 0 };
      o.dirs |= 1 << DIR_INDEX[dirOf(p, q)];
      occ.set(k, o);
    }
  };
  for (const r of requests) for (const [a, b] of r.prewired ?? []) markEdge(r.net, a, b);

  const routeNet = (r: NetRequest): RoutedNet => {
    const edges: Array<[Pt, Pt]> = [...(r.prewired ?? [])];
    const failed: string[] = [];
    const tree = new Set<number>(); // points that may be joined
    const treeDeg = new Map<number, number>();
    const sealed = new Set((r.seal ?? []).map(pid));
    const joinable = (k: number) => !pinPoint.has(k) && !sealed.has(k);
    const addTreeEdge = (a: Pt, b: Pt) => {
      markEdge(r.net, a, b);
      edges.push([a, b]);
      for (const p of [a, b]) { const k = pid(p); treeDeg.set(k, (treeDeg.get(k) ?? 0) + 1); }
      for (const p of [a, b]) { const k = pid(p); if (joinable(k) && (treeDeg.get(k) ?? 0) < 3) tree.add(k); else tree.delete(k); }
    };
    for (const [a, b] of r.prewired ?? []) for (const p of [a, b]) { const k = pid(p); treeDeg.set(k, (treeDeg.get(k) ?? 0) + 1); if (joinable(k)) tree.add(k); }

    const terms = [...r.terminals];
    if (r.noRoute) return { net: r.net, edges, failed };
    if (terms.length < 2 && !(r.prewired?.length)) return { net: r.net, edges, failed };
    // Start terminal: the first given (callers pass the most upstream first); then nearest-to-tree.
    const first = terms.shift()!;
    if (!tree.size) addTreeEdge(first.at, step(first.at, first.dir));
    else terms.unshift(first);
    while (terms.length) {
      terms.sort((s, t) => distToTree(s, tree) - distToTree(t, tree) || cmpStr(s.id, t.id));
      const t = terms.shift()!;
      // First avoid joining 1 G from a bend or junction of the tree (a step or two dots side by side).
      const path = search(t, r.net, tree, occ, usedEdges, pinPoint, approach, forbidden, bounds, true)
        ?? search(t, r.net, tree, occ, usedEdges, pinPoint, approach, forbidden, bounds, false);
      if (!path) { failed.push(t.id); continue; }
      for (let i = 0; i + 1 < path.length; i++) addTreeEdge(path[i]!, path[i + 1]!);
    }
    return { net: r.net, edges, failed };
  };

  const out = requests.map(routeNet);

  // Rip-up and reroute (SPEC 9.2 step 7): at most RIP_UP_PASSES passes. Each pass takes every
  // routed net with conflicts (crossings, and wire alongside another net's, at the search's costs),
  // most conflicts first, reroutes it with every other wire in place, and keeps the new route only
  // if the drawing then has fewer conflicts and nothing fails. A pass that improves nothing ends it.
  const rebuild = (skip: number) => {
    occ = new Map(); usedEdges = new Map();
    out.forEach((o, j) => { if (j !== skip) for (const [a, b] of o.edges) markEdge(o.net, a, b); });
  };
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  for (let pass = 0; pass < RIP_UP_PASSES; pass++) {
    const per = conflictsPerNet(out);
    let total = sum(per), improved = false;
    const order = out.map((_, j) => j)
      .filter((j) => !requests[j]!.noRoute && !out[j]!.failed.length && (per.get(out[j]!.net) ?? 0) > 0)
      .sort((a, b) => per.get(out[b]!.net)! - per.get(out[a]!.net)! || a - b);
    for (const i of order) {
      rebuild(i);
      const before = out[i]!;
      out[i] = routeNet(requests[i]!);
      const after = sum(conflictsPerNet(out));
      if (out[i]!.failed.length || after >= total) { out[i] = before; rebuild(-1); } else { total = after; improved = true; }
    }
    if (!improved) break;
  }
  return out;
}

/**
 * Each net's conflicts at the search's costs: crossings (grid points shared with another net's
 * wire) and unit edges running alongside another net's wire on an adjacent track.
 */
function conflictsPerNet(nets: RoutedNet[]): Map<string, number> {
  const owners = new Map<number, Set<string>>();
  const edgeNet = new Map<number, string>();
  for (const n of nets) for (const [a, b] of n.edges) {
    edgeNet.set(eid(a, b), n.net);
    for (const p of [a, b]) {
      const k = pid(p);
      const s = owners.get(k) ?? new Set<string>();
      s.add(n.net);
      owners.set(k, s);
    }
  }
  const per = new Map<string, number>();
  const add = (n: string, c: number) => per.set(n, (per.get(n) ?? 0) + c);
  for (const s of owners.values()) if (s.size > 1) for (const n of s) add(n, COST.cross);
  for (const n of nets) for (const [a, b] of n.edges) if (hugs(a, b, n.net, edgeNet)) add(n.net, COST.hug);
  return per;
}

function distToTree(t: Terminal, tree: Set<number>): number {
  let best = Infinity;
  for (const k of tree) { const [x, y] = unpid(k); best = Math.min(best, Math.abs(x - t.at[0]) + Math.abs(y - t.at[1])); }
  return best;
}

// Search state: a point (x, y), the arrival direction as an index into DIRS, and `run`.
type S = { x: number; y: number; di: number; g: number; f: number; hh: number; run: number; prev?: S; join?: boolean };

function search(
  t: Terminal, net: string, tree: Set<number>, occ: Map<number, Occ>, usedEdges: Map<number, string>,
  pinPoint: Map<number, string>, approach: Map<number, string>, forbidden: Forbidden, bounds: Box, strict: boolean,
): Pt[] | undefined {
  const targets = [...tree].map(unpid);
  const hMemo = new Map<number, number>();
  const h = (x: number, y: number, k: number) => {
    let b = hMemo.get(k);
    if (b === undefined) { b = Infinity; for (const q of targets) b = Math.min(b, Math.abs(x - q[0]) + Math.abs(y - q[1])); hMemo.set(k, b); }
    return b;
  };
  const start = step(t.at, t.dir);
  const startK = pid(start);
  if (tree.has(startK) && !usedEdges.has(eid(t.at, start))) return [t.at, start];
  if (!freeFor(start[0], start[1], startK, net, occ, pinPoint, approach, forbidden)) return undefined;
  if (forbidden.edge(t.at, start) || usedEdges.has(eid(t.at, start))) return undefined;

  // run: steps since the path's last bend, capped at JOG + 1, which also stands for "no bend yet"
  // (a turn is then no jog either way); part of the state, so the jog cost stays exact.
  const open = new Heap<S>(better);
  const h0 = h(start[0], start[1], startK);
  open.push({ x: start[0], y: start[1], di: DIR_INDEX[t.dir], g: COST.step, hh: h0, f: COST.step + h0, run: JOG + 1 });
  // Best cost per state (point, arrival direction, run) and per join (point, direction).
  const best = new Map<number, number>();
  const bestJoin = new Map<number, number>();
  const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.w, y1 = bounds.y + bounds.h;
  let expansions = 0;
  while (open.size) {
    // Deterministic pop: lowest f, then h, then direction order, then x, then y.
    const s = open.pop()!;
    if (s.join) {
      // The cheapest way onto the tree, final step and turn included (goal test on pop).
      const path: Pt[] = [];
      for (let u: S | undefined = s; u; u = u.prev) path.push([u.x, u.y]);
      path.push(t.at);
      return path.reverse();
    }
    const spk = pxy(s.x, s.y);
    if ((best.get((spk * 4 + s.di) * 4 + s.run) ?? Infinity) < s.g) continue;
    if (++expansions > EXPANSION_CAP) return undefined;
    const here = occ.get(spk);
    const crossingHere = here !== undefined && here.net !== net;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((s.di + 2) & 3)) continue;
      if (crossingHere && nd !== s.di) continue; // straight through a crossing, never turn on it
      const qx = s.x + DX[nd]!, qy = s.y + DY[nd]!;
      if (qx < x0 || qy < y0 || qx > x1 || qy > y1) continue;
      if (usedEdges.has(eStep(s.x, s.y, nd))) continue;
      if (forbidden.half(s.x + qx, s.y + qy)) continue;
      const qk = pxy(qx, qy);
      const turn = nd !== s.di ? COST.bend + (s.run <= JOG ? COST.jog : 0) : 0;
      const run = nd !== s.di ? 1 : Math.min(s.run + 1, JOG + 1);
      if (tree.has(qk)) {
        // Joining: the point must not become a four-way junction.
        const deg = bitCount(occ.get(qk)?.dirs ?? 0);
        if (deg >= 3) continue;
        if (strict && nearBend(qx, qy, qk, net, occ)) continue;
        const g = s.g + COST.step + turn;
        const jk = qk * 4 + nd;
        if ((bestJoin.get(jk) ?? Infinity) <= g) continue;
        bestJoin.set(jk, g);
        open.push({ x: qx, y: qy, di: nd, g, hh: 0, f: g, run, prev: s, join: true });
        continue;
      }
      if (!freeFor(qx, qy, qk, net, occ, pinPoint, approach, forbidden)) continue;
      const o = occ.get(qk);
      let cross = 0;
      if (o && o.net !== net) {
        // May only cross another net's straight wire, perpendicular to it.
        if (!(o.dirs === H_BITS ? (nd & 1) === 1 : o.dirs === V_BITS ? (nd & 1) === 0 : false)) continue;
        cross = COST.cross;
      }
      if (o && o.net === net) continue; // own wire but not joinable (pin or junction)
      const g = s.g + COST.step + turn + cross + (hugsXY(s.x, s.y, nd, net, usedEdges) ? COST.hug : 0);
      const nk = (qk * 4 + nd) * 4 + run;
      if ((best.get(nk) ?? Infinity) <= g) continue;
      best.set(nk, g);
      const hh = h(qx, qy, qk);
      open.push({ x: qx, y: qy, di: nd, g, hh, f: g + hh, run, prev: s });
    }
  }
  return undefined;
}

// Unit steps per direction index (DIRS order: right, down, left, up) and wire direction bit masks.
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const H_BITS = 0b0101, V_BITS = 0b1010; // a straight wire: right + left, or down + up
const bitCount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
const straight = (m: number) => m === H_BITS || m === V_BITS;

/** The unit edge leaving (x, y) in direction index `d`. */
function eStep(x: number, y: number, d: number): number {
  return d === 0 ? pxy(x, y) * 2 : d === 2 ? pxy(x - 1, y) * 2 : d === 1 ? pxy(x, y) * 2 + 1 : pxy(x, y - 1) * 2 + 1;
}

/** The unit edge leaving (x, y) in direction `d` runs alongside another net's wire on an adjacent parallel track (a squeezed run). */
function hugsXY(x: number, y: number, d: number, net: string, usedEdges: Map<number, string>): boolean {
  const ox = d & 1, oy = 1 - ox;
  for (const sgn of [1, -1]) {
    const n = usedEdges.get(eStep(x + sgn * ox, y + sgn * oy, d));
    if (n !== undefined && n !== net) return true;
  }
  return false;
}

/** The unit edge a-b runs alongside another net's wire on an adjacent parallel track (a squeezed run). */
function hugs(a: Pt, b: Pt, net: string, usedEdges: Map<number, string>): boolean {
  return hugsXY(a[0], a[1], DIR_INDEX[dirOf(a, b)], net, usedEdges);
}

/** A straight point of a net's wire whose neighbour on it is a bend or a junction. */
function nearBend(x: number, y: number, k: number, net: string, occ: Map<number, Occ>): boolean {
  const o = occ.get(k);
  if (!o || o.net !== net || !straight(o.dirs)) return false;
  for (let d = 0; d < 4; d++) {
    if (!(o.dirs & (1 << d))) continue;
    const n = occ.get(pxy(x + DX[d]!, y + DY[d]!));
    if (!n || n.net !== net) continue;
    const c = bitCount(n.dirs);
    if (c >= 3 || (c === 2 && !straight(n.dirs))) return true;
  }
  return false;
}

function better(a: S, b: S): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.hh !== b.hh) return a.hh < b.hh;
  if (a.di !== b.di) return a.di < b.di;
  if (a.x !== b.x) return a.x < b.x;
  return a.y < b.y;
}

function freeFor(x: number, y: number, k: number, net: string, occ: Map<number, Occ>, pinPoint: Map<number, string>, approach: Map<number, string>, forbidden: Forbidden): boolean {
  const pn = pinPoint.get(k);
  if (pn !== undefined) return false;              // pins are reached only as targets
  const an = approach.get(k);
  if (an !== undefined && an !== net) return false; // keep other nets' pin approaches clear
  if (forbidden.half(2 * x, 2 * y)) return false;
  const o = occ.get(k);
  if (o && o.net !== net && !straight(o.dirs)) return false; // corners, ends, junctions
  return true;
}

function dirOf(a: Pt, b: Pt): Dir {
  if (b[0] > a[0]) return "right";
  if (b[0] < a[0]) return "left";
  if (b[1] > a[1]) return "down";
  return "up";
}

/** Binary heap with a strict, total "a before b" order, so pops are deterministic. */
class Heap<T> {
  private a: T[] = [];
  constructor(private before: (x: T, y: T) => boolean) {}
  get size(): number { return this.a.length; }
  push(v: T): void {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.before(a[i]!, a[p]!)) break; [a[i], a[p]] = [a[p]!, a[i]!]; i = p; }
  }
  pop(): T | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0]!; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.before(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.before(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!]; i = m;
      }
    }
    return top;
  }
}
