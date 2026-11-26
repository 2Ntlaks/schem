// The render model: exactly what gets drawn (SPEC 9.7). The verifier reads only
// the `electrical` part; the SVG serialiser writes both parts.

import type { Box, Dir, Pt } from "../geom/geom.js";

export interface DrawnPin { part: string; number: string; at: Pt; dir: Dir }
export interface DrawnPort { at: Pt; text: string; domain: string | null; kind: "power" | "ground" | "label" }

export interface Electrical {
  pins: DrawnPin[];
  keepouts?: Array<Box & { part: string }>;
  wires: Pt[][];
  dots: Pt[];
  ports: DrawnPort[];
  ncMarks: Array<{ part: string; number: string }>;
}

/**
 * Artwork primitives in grid units, already transformed to sheet coordinates. A text's
 * `owner` (`label:R1`, `pin:U1`, `port:U1[2]`) lets the quality checks group lines.
 */
export type Art =
  | { t: "path"; d: string; fill?: "none" | "stroke" }
  | { t: "text"; x: number; y: number; text: string; size: number; anchor: "start" | "middle" | "end"; baseline: "top" | "middle" | "bottom"; owner?: string };

export interface RenderModel {
  electrical: Electrical;
  art: Art[];
  bounds: Box;
  meta: { title?: string; theme?: string };
}
