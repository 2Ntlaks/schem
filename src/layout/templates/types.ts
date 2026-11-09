// Pattern templates as data (SPEC 9.4): a matcher (slots with part types, pin roles, interface
// roles and pin-to-net predicates) and constraints (difference constraints in the region's local
// frame, orientations, pin sides, ranks and pre-routed runs). The engine in ./engine.ts reads
// only these structures, so adding a template means adding data to ./library.ts.

import type { Dir, Orient } from "../../geom/geom.js";
import type { NetKind, Role } from "../../core/model.js";
import type { Side } from "../../core/intent.js";

/**
 * A pin of a slot's part: a symbol pin name or number (aliases allowed), the pin carrying an
 * interface role, the pins with a pin role (ICs), or the pin the match bound to a net variable;
 * in a slot's own pins, `{ on: v }` is the part's pin on the net already bound to variable `v`.
 */
export type PinSel = string | { iface: string } | { role: Role } | { net: string } | { on: string };

/** What a net must be. Every field that is set must hold. */
export interface NetPred {
  kind?: NetKind[];
  /** Some endpoint carries this interface role, and no endpoint carries another role of the same family. */
  iface?: string;
  /** Drawn with supply or ground symbols (true) or as wires (false). */
  port?: boolean;
  /** Number of drawn endpoints on the net. */
  endpoints?: number;
  minEndpoints?: number;
}

export interface SlotPin {
  pin: PinSel;
  /** A net variable of the template, or "*": any net not bound to a variable (each member its own). */
  net: string;
  /** Extra condition for "*" nets. */
  pred?: NetPred;
  /** The match does not need this pin to be connected (a relay's contacts). */
  optional?: boolean;
}

export interface Slot {
  name: string;
  /** Part types; "ic" also accepts "module:*". */
  types: string[];
  pins: SlotPin[];
  /** Two-pin parts whose pins may be swapped (resistors): the pins listed may map either way. */
  symmetric?: boolean;
  /** `member`: inside the region (one block). `link`: stays its own block; the template only constrains it. */
  role: "member" | "link";
  /** Collect every remaining matching part, in canonical order; at least `min`. Many-slots come last. */
  many?: { min: number };
  /**
   * With `many`: one member per member of `slot`, in its order: the only other part on that
   * member's "*" net (its pin there is `{ net: "*" }`). Empty unless every member has one.
   */
  follow?: { slot: string };
  /** Candidates with this property come first (the I2C controller). */
  prefer?: { prop: string; value: string };
  /** Fixed orientation, or the orientation that makes the pin on net variable `net` face `dir`. */
  orient?: Orient | { net: string; dir: Dir };
  /** Preferred label side (an intent override still wins). */
  label?: "above" | "below" | "left" | "right";
  /** Pin sides for generated IC boxes; pins not listed keep the default sides. */
  sides?: Partial<Record<Side, PinSel[]>>;
  /** Rank relative to the rank the first ranked slot would get on its own; `step` adds the member index. */
  rank?: { offset: number; step?: number };
}

/**
 * A point coordinate on one axis: a slot's pin anchor, an edge of its keep-out (`box`), of its
 * envelope with labels, port symbols and decoupling child slots (`env`), or of that envelope
 * without the child slots (`own`), or a guide (a free variable of the region frame,
 * such as the summing-node column). For a many-slot, `agg` picks the extreme member (trunks only).
 */
export type Ref =
  | { pin: [string, PinSel]; agg?: "min" | "max" }
  | { box: [string, "left" | "right" | "top" | "bottom"]; agg?: "min" | "max" }
  | { env: [string, "left" | "right" | "top" | "bottom"]; agg?: "min" | "max" }
  | { own: [string, "left" | "right" | "top" | "bottom"]; agg?: "min" | "max" }
  | { guide: string };

/**
 * A difference constraint `a - b op c` on one axis. When a ref names a many-slot, `each` says
 * which members: all of them (default), the first or last, or consecutive pairs (`chain`: `a` is
 * member i + 1, `b` member i). `when` applies the constraint only for some member counts.
 */
export interface Rel {
  axis: "x" | "y";
  a: Ref;
  op: ">=" | "<=" | "=";
  b: Ref;
  c: number;
  each?: "all" | "first" | "last" | "chain";
  when?: { slot: string; min?: number; max?: number };
  /** The constraint keeps the two parts apart sideways, so they need not be stacked in their column. */
  apart?: boolean;
  why: string;
}

/** A pre-routed run of one net (SPEC 9.2 step 7): an axis-aligned polyline of points. */
export interface Trunk {
  net: string;
  points: Array<{ x: Ref | Ref[]; y: Ref | Ref[]; dx?: number; dy?: number; agg?: "min" | "max" }>;
  /** Draw the trunk only if these pins face these ways (an edit may have moved them). */
  require?: Array<{ pin: [string, PinSel]; dir: Dir }>;
  why: string;
}

export interface Template {
  id: string;
  version: number;
  /** Lower first (SPEC 9.4 table order). */
  priority: number;
  /** `stub`: data written ahead of the symbols it needs; never matched. */
  status?: "stub";
  summary: string;
  nets: Record<string, NetPred>;
  slots: Slot[];
  /** Region interior (step 5): members and guides only. */
  interior?: Rel[];
  /** Constraints linking the region to its link slots, added to the global solve (step 6). */
  link?: Rel[];
  /**
   * The member pins outside wires should attach to (Appendix A.1 "boundary terminals"). Only these
   * take part in the straight-wire pass with parts outside the region; other member pins are wired
   * by the template's runs. Default: every member pin.
   */
  boundary?: Array<[string, PinSel]>;
  trunks?: Trunk[];
  /**
   * Guides (columns) the region's envelope reaches out to. A run that turns on a column outside
   * every member (the column where the output line turns up to a feedback part) needs it: the
   * next part on that line then starts clear of the column instead of on it.
   */
  reserve?: string[];
}
