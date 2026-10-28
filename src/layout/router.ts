// Grid router (SPEC 9.2 step 7). A* over (point, arrival direction) states.

import { cmpStr, DIRS, edgeKey, key, manhattan, opposite, step, type Box, type Dir, type Pt } from "../geom/geom.js";
import { edgeForbidden, pointBlocked, type Obstacle } from "../geom/forbidden.js";

export interface Terminal { id: string; at: Pt; dir: Dir }
export interface NetRequest { net: string; terminals: Terminal[]; prewired?: Array<[Pt, Pt]>; noRoute?: boolean }
export interface RoutedNet { net: string; edges: Array<[Pt, Pt]>; failed: string[] }

// hug: a unit step alongside another net's wire on the adjacent track (a squeezed run);
// jog: a bend within JOG steps of the path's previous bend (a short step), on top of the bend.
const COST = { step: 1, bend: 3, cross: 12, hug: 2, jog: 9 };
const JOG = 2; // as JOG_MAX in src/quality/metrics.ts
const EXPANSION_CAP = 60_000;

interface Occ { net: string; dirs: Set<Dir> }

const RIP_UP_PASSES = 3;

export function route(requests: NetRequest[], obstacles: Obstacle[], bounds: Box): RoutedNet[] {
  let occ = new Map<string, Occ>();          // point -> owning net + directions used there
  let usedEdges = new Map<string, string>(); // unit edge -> net
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

  const routeNet = (r: NetRequest): RoutedNet => {
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
      const path = search(t, r.net, tree, occ, usedEdges, pinPoint, approach, obstacles, bounds, true)
        ?? search(t, r.net, tree, occ, usedEdges, pinPoint, approach, obstacles, bounds, false);
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
  const owners = new Map<string, Set<string>>();
  const edgeNet = new Map<string, string>();
  for (const n of nets) for (const [a, b] of n.edges) {
    edgeNet.set(edgeKey(a, b), n.net);
    for (const p of [a, b]) {
      const k = key(p);
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
  const hMemo = new Map<string, number>();
  const h = (p: Pt) => {
    const k = key(p);
    let b = hMemo.get(k);
    if (b === undefined) { b = Infinity; for (const q of targets) b = Math.min(b, manhattan(p, q)); hMemo.set(k, b); }
    return b;
  };
  const start = step(t.at, t.dir);
  const startK = key(start);
  if (tree.has(startK) && !usedEdges.has(edgeKey(t.at, start))) return [t.at, start];
  if (!freeFor(start, net, occ, pinPoint, approach, obstacles)) return undefined;
  if (edgeForbidden(t.at, start, obstacles) || usedEdges.has(edgeKey(t.at, start))) return undefined;

  // run: steps since the path's last bend, capped at JOG + 1, which also stands for "no bend yet"
  // (a turn is then no jog either way); part of the state, so the jog cost stays exact.
  type S = { p: Pt; d: Dir; g: number; f: number; hh: number; run: number; prev?: S; join?: boolean };
  const open = new Heap<S>(better);
  open.push({ p: start, d: t.dir, g: COST.step, hh: h(start), f: COST.step + h(start), run: JOG + 1 });
  const best = new Map<string, number>();
  let expansions = 0;
  while (open.size) {
    // Deterministic pop: lowest f, then h, then direction order, then x, then y.
    const s = open.pop()!;
    if (s.join) {
      // The cheapest way onto the tree, final step and turn included (goal test on pop).
      const path: Pt[] = [];
      for (let u: S | undefined = s; u; u = u.prev) path.push(u.p);
      path.push(t.at);
      return path.reverse();
    }
    const sk = `${key(s.p)}|${s.d}|${s.run}`;
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
      const turn = nd !== s.d ? COST.bend + (s.run <= JOG ? COST.jog : 0) : 0;
      const run = nd !== s.d ? 1 : Math.min(s.run + 1, JOG + 1);
      if (tree.has(qk)) {
        // Joining: the point must not become a four-way junction.
        const deg = occ.get(qk)?.dirs.size ?? 0;
        if (deg >= 3) continue;
        if (strict && nearBend(q, net, occ)) continue;
        const g = s.g + COST.step + turn;
        const jk = `${qk}|${nd}|join`;
        if ((best.get(jk) ?? Infinity) <= g) continue;
        best.set(jk, g);
        open.push({ p: q, d: nd, g, hh: 0, f: g, run, prev: s, join: true });
        continue;
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
      const g = s.g + COST.step + turn + cross + (hugs(s.p, q, net, usedEdges) ? COST.hug : 0);
      const nk = `${qk}|${nd}|${run}`;
      if ((best.get(nk) ?? Infinity) <= g) continue;
      best.set(nk, g);
      const hh = h(q);
      open.push({ p: q, d: nd, g, hh, f: g + hh, run, prev: s });
    }
  }
  return undefined;
}

/** The unit edge a-b runs alongside another net's wire on an adjacent parallel track (a squeezed run). */
function hugs(a: Pt, b: Pt, net: string, usedEdges: Map<string, string>): boolean {
  const ox = a[1] === b[1] ? 0 : 1, oy = 1 - ox;
  for (const sgn of [1, -1]) {
    const n = usedEdges.get(edgeKey([a[0] + sgn * ox, a[1] + sgn * oy], [b[0] + sgn * ox, b[1] + sgn * oy]));
    if (n !== undefined && n !== net) return true;
  }
  return false;
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
