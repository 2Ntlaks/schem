// Forbidden geometry (SPEC 9.1 rule 4, rev C.1). One definition, used by the router
// (to avoid) and by the verifier (to check).

import { gridBox, type Box, type Pt } from "./geom.js";

export interface Obstacle extends Box { owner: string }

/** Label envelopes are fractional; they are rounded outward before use. */
export function obstacleFromLabel(b: Box, owner: string): Obstacle { return { ...gridBox(b), owner }; }

/** A grid point is blocked if it lies inside or on the boundary of any obstacle. */
export function pointBlocked(p: Pt, obs: readonly Obstacle[]): boolean {
  for (const o of obs) if (p[0] >= o.x && p[0] <= o.x + o.w && p[1] >= o.y && p[1] <= o.y + o.h) return true;
  return false;
}

/** A unit edge is forbidden if its midpoint lies inside or on the boundary of an obstacle. */
export function edgeForbidden(a: Pt, b: Pt, obs: readonly Obstacle[]): Obstacle | undefined {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  for (const o of obs) if (mx >= o.x && mx <= o.x + o.w && my >= o.y && my <= o.y + o.h) return o;
  return undefined;
}
