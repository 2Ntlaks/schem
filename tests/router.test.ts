// Grid router (SPEC 9.2 step 7) on small hand-made problems: no parts, only pins and wires.

import { describe, expect, it } from "vitest";
import { route } from "../src/layout/router.js";
import type { Pt } from "../src/geom/geom.js";

const bounds = { x: -2, y: -2, w: 26, h: 14 };
/** Unit edges of `edges` that run alongside a unit edge of `other` on an adjacent parallel track. */
const alongside = (edges: Array<[Pt, Pt]>, other: Array<[Pt, Pt]>) => {
  const k = ([a, b]: [Pt, Pt]) => [a, b].map((p) => p.join(",")).sort().join("|");
  const set = new Set(other.map(k));
  return edges.filter(([a, b]) => {
    const off: Pt = a[1] === b[1] ? [0, 1] : [1, 0];
    return [1, -1].some((s) => set.has(k([[a[0] + s * off[0], a[1] + s * off[1]], [b[0] + s * off[0], b[1] + s * off[1]]])));
  }).length;
};

describe("router", () => {
  it("keeps a wire off the track next to another net's wire when a short detour does it (no squeezed run)", () => {
    const wall: Array<[Pt, Pt]> = Array.from({ length: 20 }, (_, i) => [[i, 5], [i + 1, 5]] as [Pt, Pt]);
    const [, b] = route([
      { net: "a", terminals: [], prewired: wall, noRoute: true },
      { net: "b", terminals: [{ id: "P[1]", at: [0, 4], dir: "right" }, { id: "Q[1]", at: [20, 4], dir: "left" }] },
    ], [], bounds);
    expect(b!.failed).toEqual([]);
    // Only the forced first and last steps out of the pins may run beside the wall.
    expect(alongside(b!.edges, wall)).toBeLessThanOrEqual(2);
  });

  it("joins two offset pins with the fewest bends (two)", () => {
    const [n] = route([
      { net: "n", terminals: [{ id: "P[1]", at: [0, 0], dir: "right" }, { id: "Q[1]", at: [10, 4], dir: "left" }] },
    ], [], bounds);
    const corners = new Set<string>();
    const dirs = new Map<string, Set<string>>();
    for (const [a, b] of n!.edges) for (const [p, h] of [[a, a[1] === b[1]], [b, a[1] === b[1]]] as const) {
      const s = dirs.get(p.join(",")) ?? new Set<string>();
      s.add(h ? "h" : "v");
      dirs.set(p.join(","), s);
    }
    for (const [p, s] of dirs) if (s.size === 2) corners.add(p);
    expect(corners.size).toBe(2);
  });

  it("is deterministic, rip-up passes included", () => {
    const reqs = () => [
      { net: "x", terminals: [{ id: "A[1]", at: [0, 2] as Pt, dir: "right" as const }, { id: "B[1]", at: [12, 6] as Pt, dir: "left" as const }] },
      { net: "y", terminals: [{ id: "C[1]", at: [0, 4] as Pt, dir: "right" as const }, { id: "D[1]", at: [12, 0] as Pt, dir: "left" as const }] },
      { net: "z", terminals: [{ id: "E[1]", at: [0, 6] as Pt, dir: "right" as const }, { id: "F[1]", at: [12, 2] as Pt, dir: "left" as const }] },
    ];
    expect(JSON.stringify(route(reqs(), [], bounds))).toBe(JSON.stringify(route(reqs(), [], bounds)));
  });
});
