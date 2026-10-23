// Shared reading of a finished drawing for the quality checks (verification layers 2-4).
// Like the verifier, it reads only the render model: never router tags or layout internals.

import { cmpStr, DELTA, DIRS, key, unitEdges, type Box, type Dir, type Pt } from "../geom/geom.js";
import { measure } from "../text/font.js";
import type { Art, RenderModel } from "../render/model.js";

export interface TextBox extends Box { text: string; owner: string }

/** Ink box of one text primitive in grid units, matching how the SVG writer places it. */
export function textBox(a: Extract<Art, { t: "text" }>): TextBox {
  const m = measure(a.text, a.size);
  const w = m.width / 10, cap = (m.ascent * 0.8) / 10, desc = m.descent / 10;
  const x = a.x - (a.anchor === "middle" ? w / 2 : a.anchor === "end" ? w : 0);
  const top = a.baseline === "top" ? a.y : a.baseline === "middle" ? a.y - cap / 2 : a.y - cap;
  return { x, y: top, w, h: cap + desc, text: a.text, owner: a.owner ?? `text:${a.text}` };
}

/** One box per owner (the lines of a part label belong together). */
export function textBlocks(m: RenderModel): TextBox[] {
  const by = new Map<string, TextBox>();
  for (const a of m.art) {
    if (a.t !== "text") continue;
    const b = textBox(a);
    const prev = by.get(b.owner);
    if (!prev) { by.set(b.owner, b); continue; }
    const x = Math.min(prev.x, b.x), y = Math.min(prev.y, b.y);
    by.set(b.owner, { x, y, w: Math.max(prev.x + prev.w, b.x + b.w) - x, h: Math.max(prev.y + prev.h, b.y + b.h) - y, text: `${prev.text} / ${b.text}`, owner: b.owner });
  }
  return [...by.values()].sort((p, q) => cmpStr(p.owner, q.owner));
}

/** Area shared by box `a` and box `b` shrunk by `inset` on every side (touching counts 0). */
export function overlapArea(a: Box, b: Box, inset = 0): number {
  const s: Box = { x: b.x + inset, y: b.y + inset, w: b.w - 2 * inset, h: b.h - 2 * inset };
  const w = Math.min(a.x + a.w, s.x + s.w) - Math.max(a.x, s.x);
  const h = Math.min(a.y + a.h, s.y + s.h) - Math.max(a.y, s.y);
  return s.w > 0 && s.h > 0 && w > 1e-9 && h > 1e-9 ? w * h : 0;
}

export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Conductor structure: unit edges, directions at each grid point, and drawn nets. */
export interface Conductors {
  edges: Array<[Pt, Pt]>;
  dirs: Map<string, Set<Dir>>;
  dots: Set<string>;
  pinAt: Set<string>;
  /** Component id of each unit edge (crossings without a dot do not join). */
  netOfEdge: string[];
}

export function conductors(m: RenderModel): Conductors {
  const el = m.electrical;
  const seen = new Set<string>();
  const edges: Array<[Pt, Pt]> = [];
  for (const w of el.wires) for (const [a, b] of unitEdges(w)) {
    const k = `${key(a)}|${key(b)}`, r = `${key(b)}|${key(a)}`;
    if (seen.has(k) || seen.has(r)) continue;
    seen.add(k);
    edges.push([a, b]);
  }
  const dirs = new Map<string, Set<Dir>>();
  const add = (p: Pt, d: Dir) => { const s = dirs.get(key(p)) ?? new Set<Dir>(); s.add(d); dirs.set(key(p), s); };
  for (const [a, b] of edges) {
    const d = DIRS.find((x) => a[0] + DELTA[x][0] === b[0] && a[1] + DELTA[x][1] === b[1])!;
    add(a, d);
    add(b, DIRS[(DIRS.indexOf(d) + 2) % 4]!);
  }
  const dots = new Set(el.dots.map(key));
  const pinAt = new Set(el.pins.map((p) => key(p.at)));
  // Union-find over edges: edges meeting at a point join, except straight through a dotless crossing.
  const parent = edges.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const join = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const atPoint = new Map<string, Array<{ i: number; horizontal: boolean }>>();
  edges.forEach(([a, b], i) => {
    const horizontal = a[1] === b[1];
    for (const p of [a, b]) { const l = atPoint.get(key(p)) ?? []; l.push({ i, horizontal }); atPoint.set(key(p), l); }
  });
  for (const [k, l] of atPoint) {
    const crossing = dirs.get(k)!.size === 4 && !dots.has(k);
    for (let x = 1; x < l.length; x++) for (let y = 0; y < x; y++) {
      if (crossing && l[x]!.horizontal !== l[y]!.horizontal) continue;
      join(l[x]!.i, l[y]!.i);
    }
  }
  return { edges, dirs, dots, pinAt, netOfEdge: edges.map((_, i) => String(find(i))) };
}

export function isCrossing(c: Conductors, k: string): boolean {
  return c.dirs.get(k)?.size === 4 && !c.dots.has(k);
}

export function isCorner(c: Conductors, k: string): boolean {
  const s = c.dirs.get(k);
  if (!s || s.size !== 2 || c.pinAt.has(k)) return false;
  const [d1, d2] = [...s] as [Dir, Dir];
  return (d1 === "left" || d1 === "right") !== (d2 === "left" || d2 === "right");
}
