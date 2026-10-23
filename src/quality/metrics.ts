// Verification layer 4: readability metrics with limits (SPEC 10.1, 9.1 groups 3-4).
// Limits are provisional: set on the Phase 0a drawings the owner commented on, to be
// calibrated against the owner's blind ratings (docs/verification-stack.html).

import { key, unkey, type Box, type Pt } from "../geom/geom.js";
import type { RenderModel } from "../render/model.js";
import { boxDistance, conductors, isCorner, isCrossing, textBlocks } from "./drawing.js";

export interface Metrics {
  crossings: number;
  bends: number;
  wireLength: number;
  dots: number;
  /** Smallest distance between two junction dots (G); Infinity with fewer than two. */
  minDotSpacing: number;
  /** Smallest distance from a crossing to a junction dot (G). */
  minCrossingToDot: number;
  /** Short steps: a segment of at most JOG_MAX G between two corners. */
  jogs: number;
  /** Runs of different nets on adjacent tracks (1 G apart) at least SQUEEZE_RUN G long. */
  squeezedRuns: number;
  /** Part labels further than FAR_LABEL G from their part. */
  farLabels: number;
  sheet: [number, number];
  /** Where each limited metric's worst cases are, for the findings harness. */
  where: Partial<Record<keyof typeof LIMITS, Pt[]>>;
  /** |log(width / height) - log(4 / 3)|. */
  aspectError: number;
  /** Largest difference between opposite margins around the drawing's content (G). */
  marginImbalance: number;
}

export const JOG_MAX = 2;
export const SQUEEZE_RUN = 3;
export const FAR_LABEL = 1.5;

/** Provisional limits; a breach is a readability problem worth fixing before review. */
export const LIMITS = {
  minDotSpacing: 2,        // dots one step apart (case 3) read as one blob
  minCrossingToDot: 2,     // a crossing beside a dot reads as a connection (case 5)
  jogs: 0,                 // a small step in a wire (case 3, V3)
  squeezedRuns: 0,
  farLabels: 0,
  marginImbalance: 2,      // the empty band above case 1 (3.6 G)
  aspectError: Math.log(3), // flags only very tall or very wide sheets
} as const;

export interface LimitBreach { metric: keyof typeof LIMITS; value: number; limit: number; message: string; at: Pt[] }

export function measureDrawing(m: RenderModel): Metrics {
  const c = conductors(m);
  const points = [...c.dirs.keys()];
  const crossings = points.filter((k) => isCrossing(c, k));
  const corners = new Set(points.filter((k) => isCorner(c, k)));
  const dots = [...c.dots].map(unkey);

  const where: Metrics["where"] = { minDotSpacing: [], minCrossingToDot: [], jogs: [], squeezedRuns: [] };
  let minDotSpacing = Infinity;
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    const d = Math.hypot(dots[i]![0] - dots[j]![0], dots[i]![1] - dots[j]![1]);
    minDotSpacing = Math.min(minDotSpacing, d);
    if (d < LIMITS.minDotSpacing) where.minDotSpacing!.push(dots[i]!, dots[j]!);
  }
  let minCrossingToDot = Infinity;
  for (const k of crossings) {
    const p = unkey(k);
    for (const d of dots) {
      const dist = Math.hypot(p[0] - d[0], p[1] - d[1]);
      minCrossingToDot = Math.min(minCrossingToDot, dist);
      if (dist < LIMITS.minCrossingToDot) where.minCrossingToDot!.push(p);
    }
  }

  // Jogs: walk from each corner along each of its directions to the next point that is not a
  // plain straight-through; if that is another corner within JOG_MAX, it is a short step.
  let jogs = 0;
  for (const k of corners) for (const d of c.dirs.get(k)!) {
    let p = unkey(k);
    for (let n = 1; n <= JOG_MAX; n++) {
      p = [p[0] + (d === "right" ? 1 : d === "left" ? -1 : 0), p[1] + (d === "down" ? 1 : d === "up" ? -1 : 0)];
      const pk = key(p);
      if (corners.has(pk)) { if (pk > k) { jogs++; where.jogs!.push(unkey(k)); } break; }
      const s = c.dirs.get(pk);
      if (!s || s.size !== 2 || c.pinAt.has(pk) || c.dots.has(pk)) break;
    }
  }

  // Squeezed runs: unit edges of different nets on parallel adjacent tracks, grouped into runs.
  const edgeAt = new Map<string, string>();
  c.edges.forEach(([a, b], i) => edgeAt.set(`${key(a)}|${key(b)}`, c.netOfEdge[i]!));
  const netOf = (a: readonly [number, number], b: readonly [number, number]) => edgeAt.get(`${key(a)}|${key(b)}`) ?? edgeAt.get(`${key(b)}|${key(a)}`);
  const squeezed = new Set<string>();
  c.edges.forEach(([a, b], i) => {
    const horizontal = a[1] === b[1];
    const off: [number, number] = horizontal ? [0, 1] : [1, 0];
    const other = netOf([a[0] + off[0], a[1] + off[1]], [b[0] + off[0], b[1] + off[1]]);
    if (other !== undefined && other !== c.netOfEdge[i]) squeezed.add(`${horizontal ? "h" : "v"}|${key(a[0] < b[0] || a[1] < b[1] ? a : b)}`);
  });
  let squeezedRuns = 0;
  for (const s of squeezed) {
    const [h, k] = s.split("|") as [string, string];
    const p = unkey(k);
    const prev = h === "h" ? `h|${key([p[0] - 1, p[1]])}` : `v|${key([p[0], p[1] - 1])}`;
    if (squeezed.has(prev)) continue; // count each run once, from its start
    let len = 0, q = p;
    while (squeezed.has(`${h}|${key(q)}`)) { len++; q = h === "h" ? [q[0] + 1, q[1]] : [q[0], q[1] + 1]; }
    if (len >= SQUEEZE_RUN) { squeezedRuns++; where.squeezedRuns!.push(p); }
  }

  const parts = new Map((m.electrical.keepouts ?? []).filter((k) => !k.part.includes(":")).map((k) => [k.part, k as Box]));
  const texts = textBlocks(m);
  const farLabels = texts.filter((t) => t.owner.startsWith("label:") && parts.has(t.owner.slice(6)) && boxDistance(t, parts.get(t.owner.slice(6))!) > FAR_LABEL).length;

  // Content box: everything drawn (parts, ports, texts, wires).
  const boxes: Box[] = [...(m.electrical.keepouts ?? []).filter((k) => !k.part.startsWith("label:")), ...texts];
  for (const [a, b] of c.edges) boxes.push({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
  let marginImbalance = 0;
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const s = m.bounds;
    marginImbalance = Math.max(Math.abs((x0 - s.x) - (s.x + s.w - x1)), Math.abs((y0 - s.y) - (s.y + s.h - y1)));
  }

  return {
    crossings: crossings.length,
    bends: corners.size,
    wireLength: c.edges.length,
    dots: dots.length,
    minDotSpacing,
    minCrossingToDot,
    jogs,
    squeezedRuns,
    farLabels,
    sheet: [m.bounds.w, m.bounds.h],
    where,
    aspectError: Math.abs(Math.log(m.bounds.w / m.bounds.h) - Math.log(4 / 3)),
    marginImbalance: Math.round(marginImbalance * 100) / 100,
  };
}

export function limitBreaches(x: Metrics): LimitBreach[] {
  const out: LimitBreach[] = [];
  const atLeast = (metric: "minDotSpacing" | "minCrossingToDot", what: string) => {
    if (x[metric] < LIMITS[metric]) out.push({ metric, value: x[metric], limit: LIMITS[metric], message: `${what} ${round(x[metric])} G apart (at least ${LIMITS[metric]} G)`, at: x.where[metric] ?? [] });
  };
  const atMost = (metric: "jogs" | "squeezedRuns" | "farLabels" | "marginImbalance" | "aspectError", what: string) => {
    if (x[metric] > LIMITS[metric]) out.push({ metric, value: x[metric], limit: LIMITS[metric], message: `${what}: ${round(x[metric])} (at most ${round(LIMITS[metric])})`, at: x.where[metric] ?? [] });
  };
  atLeast("minDotSpacing", "two junction dots are");
  atLeast("minCrossingToDot", "a crossing and a junction dot are");
  atMost("jogs", "short steps in wires");
  atMost("squeezedRuns", "wires of different nets squeezed onto adjacent tracks");
  atMost("farLabels", "labels far from their part");
  atMost("marginImbalance", "uneven margins (G)");
  atMost("aspectError", "sheet shape far from 4:3");
  return out;
}

function round(n: number): number { return Math.round(n * 100) / 100; }
