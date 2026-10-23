// Intent: hints, locks and overrides (SPEC 6.4), and the layout a project file keeps (SPEC 6.5).

import type { Orient, Pt, Rot } from "../geom/geom.js";

export type HintPriority = "strict" | "high" | "normal";
export type Side = "left" | "right" | "top" | "bottom";

export type Hint =
  | { id: string; type: "relative"; part: string; rel: "right-of" | "left-of" | "above" | "below"; of: string; priority: HintPriority }
  | { id: string; type: "align"; axis: "row" | "column"; parts: string[]; priority: HintPriority }
  | { id: string; type: "orient"; part: string; rot: Rot; flip: boolean; priority: HintPriority }
  /** Pin numbers per side, in order (top to bottom, left to right). */
  | { id: string; type: "pinSides"; part: string; sides: Partial<Record<Side, string[]>>; priority: HintPriority };

/** A locked part never moves: its origin and orientation are fixed. */
export interface Lock { part: string; x: number; y: number; rot: Rot; flip: boolean }

export interface Intent {
  hints?: Hint[];
  locks?: Lock[];
  overrides?: { labelSide?: Record<string, "above" | "below" | "left" | "right"> };
  /** Sheet spacing factor (absolute, 1 = default). */
  spacing?: number;
}

/** What a layout keeps for the next incremental layout (SPEC 6.5 `layout.parts`, `layout.routes`). */
export interface LayoutState {
  parts: Record<string, { at: Pt; orient: Orient; sides?: Partial<Record<Side, string[]>> }>;
  /**
   * Per net id: a signature of its drawn terminals and the conductor runs drawn for it.
   * `ports` marks a net drawn only with supply or ground symbols (its runs are their stubs).
   */
  routes: Record<string, { terminals: string; runs: Pt[][]; ports?: true }>;
}
