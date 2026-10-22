// Shared integer-grid geometry (SPEC 6.1). Used by both layout and verify,
// so it must stay small and obviously correct.

export type Pt = readonly [number, number];
export type Dir = "left" | "right" | "up" | "down";
export const DIRS: readonly Dir[] = ["right", "down", "left", "up"]; // E, S, W, N tie order (SPEC 9.2 step 7)

export interface Box { x: number; y: number; w: number; h: number }

export const DELTA: Record<Dir, Pt> = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };

export function opposite(d: Dir): Dir {
  return d === "left" ? "right" : d === "right" ? "left" : d === "up" ? "down" : "up";
}

export function add(p: Pt, q: Pt): Pt { return [p[0] + q[0], p[1] + q[1]]; }
export function step(p: Pt, d: Dir, n = 1): Pt { const v = DELTA[d]; return [p[0] + v[0] * n, p[1] + v[1] * n]; }
export function key(p: Pt): string { return `${p[0]},${p[1]}`; }
export function unkey(k: string): Pt { const [x, y] = k.split(",").map(Number); return [x!, y!]; }
export function manhattan(p: Pt, q: Pt): number { return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]); }
export function isHorizontal(d: Dir): boolean { return d === "left" || d === "right"; }

export function dirBetween(a: Pt, b: Pt): Dir {
  if (a[1] === b[1] && b[0] > a[0]) return "right";
  if (a[1] === b[1] && b[0] < a[0]) return "left";
  if (a[0] === b[0] && b[1] > a[1]) return "down";
  if (a[0] === b[0] && b[1] < a[1]) return "up";
  throw new Error(`not an axis-aligned step: ${key(a)} -> ${key(b)}`);
}

/** Unit-edge key, independent of direction: always from the smaller point. */
export function edgeKey(a: Pt, b: Pt): string {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
  return `${key(p)}|${key(q)}`;
}

/** Split an axis-aligned polyline into unit edges. Throws on diagonal or non-integer input. */
export function unitEdges(poly: readonly Pt[]): Array<[Pt, Pt]> {
  const out: Array<[Pt, Pt]> = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]!, b = poly[i + 1]!;
    if (![a[0], a[1], b[0], b[1]].every(Number.isInteger)) throw new Error(`off-grid point in ${key(a)} -> ${key(b)}`);
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const d = dirBetween(a, b);
    let p = a;
    while (p[0] !== b[0] || p[1] !== b[1]) { const q = step(p, d); out.push([p, q]); p = q; }
  }
  return out;
}

// --- symbol transforms (SPEC 6.1): mirror about local y axis, then rotate clockwise about origin ---

export type Rot = 0 | 90 | 180 | 270;
export interface Orient { rot: Rot; flip: boolean }

export function xformVec(v: Pt, o: Orient): Pt {
  let x = o.flip ? -v[0] : v[0];
  let y = v[1];
  // Clockwise on screen with y down: (x, y) -> (-y, x)
  for (let r = 0; r < o.rot; r += 90) { const nx = -y; y = x; x = nx; }
  return [x + 0, y + 0]; // +0 normalises -0
}

export function xformPt(local: Pt, at: Pt, o: Orient): Pt { return add(at, xformVec(local, o)); }

export function xformDir(d: Dir, o: Orient): Dir {
  const v = xformVec(DELTA[d], o);
  return dirBetween([0, 0], v);
}

export function xformBox(b: Box, at: Pt, o: Orient): Box {
  const a = xformPt([b.x, b.y], at, o), c = xformPt([b.x + b.w, b.y + b.h], at, o);
  const x = Math.min(a[0], c[0]), y = Math.min(a[1], c[1]);
  return { x, y, w: Math.abs(c[0] - a[0]), h: Math.abs(c[1] - a[1]) };
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Round a fractional box outward to the grid. */
export function gridBox(b: Box): Box {
  const x = Math.floor(b.x), y = Math.floor(b.y);
  return { x, y, w: Math.ceil(b.x + b.w) - x, h: Math.ceil(b.y + b.h) - y };
}

/** Closed-box test for a grid point. */
export function inClosedBox(p: Pt, b: Box): boolean {
  return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
}

/** Code-point string comparison (SPEC 9.6: never localeCompare). */
export function cmpStr(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Natural order for pin numbers and ids: "2" < "10", "A2" < "A10". */
export function cmpNatural(a: string, b: string): number {
  const ra = a.match(/(\d+|\D+)/g) ?? [], rb = b.match(/(\d+|\D+)/g) ?? [];
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const x = ra[i]!, y = rb[i]!;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const d = Number(x) - Number(y); if (d !== 0) return d; }
    else { const c = cmpStr(x, y); if (c !== 0) return c; }
  }
  return ra.length - rb.length || cmpStr(a, b);
}
