// Intent: hints, locks and overrides (SPEC 6.4), and the layout a project file keeps (SPEC 6.5).

import type { Orient, Pt, Rot } from "../geom/geom.js";
import { canonical, type Circuit, type Issue, type PinDefs } from "./model.js";
import { classOf, resolveEndpoint } from "./validate.js";

export type HintPriority = "strict" | "high" | "normal";
export type Side = "left" | "right" | "top" | "bottom";

export type Hint =
  | { id: string; type: "relative"; part: string; rel: "right-of" | "left-of" | "above" | "below"; of: string; priority: HintPriority }
  | { id: string; type: "align"; axis: "row" | "column"; parts: string[]; priority: HintPriority }
  | { id: string; type: "orient"; part: string; rot: Rot; flip: boolean; priority: HintPriority }
  /** Pin numbers per side, in order (top to bottom, left to right). */
  | { id: string; type: "pinSides"; part: string; sides: Partial<Record<Side, string[]>>; priority: HintPriority }
  /**
   * The capacitor `part` decouples `pin` (SPEC 6.4; JSON shape from phase0 case 7). `pin` is an
   * endpoint of another part, written canonically (`U1[7]`) or by name (`U1.VCC`).
   */
  | { id: string; type: "decouples"; part: string; pin: string; priority: HintPriority };

export type HintType = Hint["type"];
export const HINT_TYPES: readonly HintType[] = ["relative", "align", "orient", "pinSides", "decouples"];

/** A locked part never moves: its origin and orientation are fixed. */
export interface Lock { part: string; x: number; y: number; rot: Rot; flip: boolean }

/** Net presentation override (SPEC 6.4). Kept and saved; the 0b layout does not read it yet. */
export interface NetStyle { net: string; endpoint?: string; style: "wire" | "port" | "label" }

export interface Intent {
  hints?: Hint[];
  locks?: Lock[];
  overrides?: { labelSide?: Record<string, "above" | "below" | "left" | "right">; netStyle?: NetStyle[] };
  /** Sheet style (SPEC 6.5 `intent.style`), e.g. `{ theme: "clean", symbols: "ieee" }`. */
  style?: { theme?: string; symbols?: string };
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
  /** Template regions used, as `id@version:parts` (SPEC 9.4: templates are part of `layout.basis`). */
  templates?: string[];
}

/** Part types a `decouples` hint may name (both spellings of the polarised capacitor, as src/core/quantity.ts). */
export const CAPACITOR_TYPES: ReadonlySet<string> = new Set(["capacitor", "polarised-capacitor", "polarized-capacitor"]);

/** Parts a hint names (for pruning, renames and the affected-parts rule). */
export function hintParts(h: Hint): string[] {
  switch (h.type) {
    case "align": return [...h.parts];
    case "relative": return [h.part, h.of];
    case "decouples": { const m = /^([A-Za-z][A-Za-z0-9_]*)[[{.]/.exec(h.pin); return m ? [h.part, m[1]!] : [h.part]; }
    default: return [h.part];
  }
}

/**
 * Check that every hint refers to things that exist (load and edit time).
 * `decouples`: `part` is a capacitor, and `pin` resolves to a terminal or group of another part
 * (E261, E262). Problems that do not stop a layout come back as warnings (W263): the capacitor
 * is not on the pin's net, or has no pin on a ground net.
 */
export function checkHints(hints: readonly Hint[], circuit: Circuit, pinDefs: PinDefs): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const parts = new Map(circuit.parts.map((p) => [p.id, p]));
  const ids = new Set<string>();
  const need = (h: Hint, id: string) => { if (!parts.has(id)) errors.push({ code: "E251", message: `hint ${h.id}: unknown part "${id}".`, at: h.id }); };
  for (const h of hints) {
    if (ids.has(h.id)) errors.push({ code: "E260", message: `hint id "${h.id}" is used twice.`, at: h.id });
    ids.add(h.id);
    if (h.type !== "decouples") { for (const p of hintParts(h)) need(h, p); continue; }
    const cap = parts.get(h.part);
    if (!cap) { need(h, h.part); continue; }
    if (!CAPACITOR_TYPES.has(cap.type)) errors.push({ code: "E261", message: `hint ${h.id}: ${h.part} is a ${cap.type}; a decouples hint names a capacitor.`, at: h.id });
    const r = resolveEndpoint(h.pin, pinDefs);
    if (!r.ok) { errors.push({ code: "E262", message: `hint ${h.id}: ${r.issue.message}`, at: h.id }); continue; }
    if (r.ep.part === h.part) { errors.push({ code: "E262", message: `hint ${h.id}: ${h.part} cannot decouple its own pin ${h.pin}.`, at: h.id }); continue; }
    // Warnings: the capacitor should sit between the pin's net and a ground net.
    const target = canonical(r.ep), cls = classOf(r.ep, pinDefs);
    const netOf = (n: Circuit["nets"][0]) => n.endpoints.some((e) => { const q = resolveEndpoint(e, pinDefs); return q.ok && classOf(q.ep, pinDefs) === cls; });
    const pinNet = circuit.nets.find(netOf);
    const capNets = circuit.nets.filter((n) => n.endpoints.some((e) => { const q = resolveEndpoint(e, pinDefs); return q.ok && q.ep.part === h.part; }));
    if (!pinNet || !capNets.includes(pinNet)) warnings.push({ code: "W263", message: `hint ${h.id}: ${h.part} is not on the net of ${target}.`, at: h.id });
    else if (!capNets.some((n) => n !== pinNet)) warnings.push({ code: "W263", message: `hint ${h.id}: ${h.part} has no pin on another net (a ground) besides ${target}'s.`, at: h.id });
  }
  return { errors, warnings };
}
