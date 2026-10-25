// Grid router (SPEC 9.2 step 7). A* over (point, arrival direction) states.

import { cmpStr, DIRS, edgeKey, key, manhattan, opposite, step, type Box, type Dir, type Pt } from "../geom/geom.js";
import { edgeForbidden, pointBlocked, type Obstacle } from "../geom/forbidden.js";

export interface Terminal { id: string; at: Pt; dir: Dir }
export interface NetRequest { net: string; terminals: Terminal[]; prewired?: Array<[Pt, Pt]>; noRoute?: boolean }
export interface RoutedNet { net: string; edges: Array<[Pt, Pt]>; failed: string[] }

const COST = { step: 1, bend: 3, cross: 8 };
const EXPANSION_CAP = 60_000;

interface Occ { net: string; dirs: Set<Dir> }

export function route(requests: NetRequest[], obstacles: Obstacle[], bounds: Box): RoutedNet[] {
  const occ = new Map<string, Occ>();          // point -> owning net + directions used there
  const usedEdges = new Map<string, string>(); // unit edge -> net
  const pinPoint = new Map<string, string>();  // pin anchor -> net
  const approach = new Map<string, string>();  // approach point of a pin -> net
  for (const r of requests) for (const t of r.terminals) {
    pinPoint.set(key(t.at), r.net);
    approach.set(key(step(t.at, t.dir)), r.net);
  }
  const markEdge = (net: string, a: Pt, b: Pt) => {
    usedEdges.set(edgeKey(a, b), net);
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const k = key(p);
      const o = occ.get(k) ?? { net, dirs: new Set<Dir>() };
      o.dirs.add(dirOf(p, q));
      occ.set(k, o);
    }
  };
  for (const r of requests) for (const [a, b] of r.prewired ?? []) markEdge(r.net, a, b);

  const out: RoutedNet[] = [];
  for (const r of requests) {
    const edges: Array<[Pt, Pt]> = [...(r.prewired ?? [])];
    const failed: string[] = [];
    const tree = new Set<string>(); // points that may be joined
    const treeDeg = new Map<string, number>();
    const addTreeEdge = (a: Pt, b: Pt) => {
      markEdge(r.net, a, b);
      edges.push([a, b]);
      for (const p of [a, b]) { const k = key(p); treeDeg.set(k, (treeDeg.get(k) ?? 0) + 1); }
      for (const p of [a, b]) { const k = key(p); if (!pinPoint.has(k) && (treeDeg.get(k) ?? 0) < 3) tree.add(k); else tree.delete(k); }
    };
    for (const [a, b] of r.prewired ?? []) for (const p of [a, b]) { const k = key(p); treeDeg.set(k, (treeDeg.get(k) ?? 0) + 1); if (!pinPoint.has(k)) tree.add(k); }

    const terms = [...r.terminals];
    if (r.noRoute) { out.push({ net: r.net, edges, failed }); continue; }
    if (terms.length < 2 && !(r.prewired?.length)) { out.push({ net: r.net, edges, failed }); continue; }
    // Start terminal: the first given (callers pass the most upstream first); then nearest-to-tree.
    const first = terms.shift()!;
    if (!tree.size) addTreeEdge(first.at, step(first.at, first.dir));
    else terms.unshift(first);
    while (terms.length) {
      terms.sort((s, t) => distToTree(s, tree) - distToTree(t, tree) || cmpStr(s.id, t.id));
      const t = terms.shift()!;
      // First avoid joining 1 G from a bend or junction of the tree (a step or two dots side by side).
      const path = search(t, r.net, tree, occ, usedEdges, pinPoint, approach, obstacles, bounds, true)
        ?? search(t, r.net, tree, occ, usedEdges, pinPoint, approach, obstacles, bounds, false);
      if (!path) { failed.push(t.id); continue; }
      for (let i = 0; i + 1 < path.length; i++) addTreeEdge(path[i]!, path[i + 1]!);
    }
    out.push({ net: r.net, edges, failed });
  }
  return out;
}

function distToTree(t: Terminal, tree: Set<string>): number {
  let best = Infinity;
  for (const k of tree) { const [x, y] = k.split(",").map(Number); best = Math.min(best, Math.abs(x! - t.at[0]) + Math.abs(y! - t.at[1])); }
  return best;
}

function search(
  t: Terminal, net: string, tree: Set<string>, occ: Map<string, Occ>, usedEdges: Map<string, string>,
  pinPoint: Map<string, string>, approach: Map<string, string>, obstacles: Obstacle[], bounds: Box, strict: boolean,
): Pt[] | undefined {
  const targets = [...tree].map((k) => k.split(",").map(Number) as unknown as Pt);
  const h = (p: Pt) => { let b = Infinity; for (const q of targets) b = Math.min(b, manhattan(p, q)); return b; };
  const start = step(t.at, t.dir);
  const startK = key(start);
  if (tree.has(startK) && !usedEdges.has(edgeKey(t.at, start))) return [t.at, start];
  if (!freeFor(start, net, occ, pinPoint, approach, obstacles)) return undefined;
  if (edgeForbidden(t.at, start, obstacles) || usedEdges.has(edgeKey(t.at, start))) return undefined;

  type S = { p: Pt; d: Dir; g: number; f: number; hh: number; prev?: S };
  const open = new Heap<S>(better);
  open.push({ p: start, d: t.dir, g: COST.step, hh: h(start), f: COST.step + h(start) });
  const best = new Map<string, number>();
  let expansions = 0;
  while (open.size) {
    // Deterministic pop: lowest f, then h, then direction order, then x, then y.
    const s = open.pop()!;
    const sk = `${key(s.p)}|${s.d}`;
    if ((best.get(sk) ?? Infinity) < s.g) continue;
    if (++expansions > EXPANSION_CAP) return undefined;
    const crossingHere = occ.has(key(s.p)) && occ.get(key(s.p))!.net !== net;
    for (const nd of DIRS) {
      if (nd === opposite(s.d)) continue;
      if (crossingHere && nd !== s.d) continue; // straight through a crossing, never turn on it
      const q = step(s.p, nd);
      if (q[0] < bounds.x || q[1] < bounds.y || q[0] > bounds.x + bounds.w || q[1] > bounds.y + bounds.h) continue;
      if (usedEdges.has(edgeKey(s.p, q))) continue;
      if (edgeForbidden(s.p, q, obstacles)) continue;
      const qk = key(q);
      const turn = nd !== s.d ? COST.bend : 0;
      if (tree.has(qk)) {
        // Joining: the point must not become a four-way junction.
        const deg = occ.get(qk)?.dirs.size ?? 0;
        if (deg >= 3) continue;
        if (strict && nearBend(q, net, occ)) continue;
        const path: Pt[] = [q];
        for (let u: S | undefined = s; u; u = u.prev) path.push(u.p);
        path.push(t.at);
        return path.reverse();
      }
      if (!freeFor(q, net, occ, pinPoint, approach, obstacles)) continue;
      const o = occ.get(qk);
      let cross = 0;
      if (o && o.net !== net) {
        // May only cross another net's straight wire, perpendicular to it.
        const ds = [...o.dirs];
        const straight = ds.length === 2 && opposite(ds[0]!) === ds[1]!;
        const perpendicular = straight && ds[0] !== nd && ds[0] !== opposite(nd);
        if (!perpendicular) continue;
        cross = COST.cross;
      }
      if (o && o.net === net) continue; // own wire but not joinable (pin or junction)
      const g = s.g + COST.step + turn + cross;
      const nk = `${qk}|${nd}`;
      if ((best.get(nk) ?? Infinity) <= g) continue;
      best.set(nk, g);
      const hh = h(q);
      open.push({ p: q, d: nd, g, hh, f: g + hh, prev: s });
    }
  }
  return undefined;
}

/** A straight point of a net's wire whose neighbour on it is a bend or a junction. */
function nearBend(q: Pt, net: string, occ: Map<string, Occ>): boolean {
  const o = occ.get(key(q));
  if (!o || o.net !== net) return false;
  const ds = [...o.dirs];
  if (!(ds.length === 2 && opposite(ds[0]!) === ds[1]!)) return false;
  return ds.some((d) => {
    const n = occ.get(key(step(q, d)));
    if (!n || n.net !== net) return false;
    const nd = [...n.dirs];
    return nd.length >= 3 || (nd.length === 2 && opposite(nd[0]!) !== nd[1]!);
  });
}

function better(a: { f: number; hh: number; d: Dir; p: Pt }, b: { f: number; hh: number; d: Dir; p: Pt }): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.hh !== b.hh) return a.hh < b.hh;
  const da = DIRS.indexOf(a.d), db = DIRS.indexOf(b.d);
  if (da !== db) return da < db;
  if (a.p[0] !== b.p[0]) return a.p[0] < b.p[0];
  return a.p[1] < b.p[1];
}

function freeFor(p: Pt, net: string, occ: Map<string, Occ>, pinPoint: Map<string, string>, approach: Map<string, string>, obstacles: Obstacle[]): boolean {
  const k = key(p);
  const pn = pinPoint.get(k);
  if (pn !== undefined) return false;              // pins are reached only as targets
  const an = approach.get(k);
  if (an !== undefined && an !== net) return false; // keep other nets' pin approaches clear
  if (pointBlocked(p, obstacles)) return false;
  const o = occ.get(k);
  if (o && o.net !== net) {
    const ds = [...o.dirs];
    if (!(ds.length === 2 && opposite(ds[0]!) === ds[1]!)) return false; // corners, ends, junctions
  }
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
