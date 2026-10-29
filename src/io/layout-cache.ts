// The drawing a project was last saved with (SPEC 6.5 `layout`), so that `schem draw` and the next
// `schem edit` keep it. `schem edit` writes it; a file without one is drawn from scratch.
//
// On disk:
//   { "mode": "incremental", "basis": "<revision>",
//     "parts": { "R1": { "x", "y", "rot", "flip", "column"?, "sides"? }, ... },
//     "routes": [ { "net", "terminals", "runs": [[[x, y], ...], ...], "ports"? }, ... ],
//     "templates"?: [...] }
// This is the engine's LayoutState in the SPEC 6.5 spelling (x, y, rot, flip per part; routes as a
// list), plus what an incremental layout needs to continue from it (columns, pin sides, the
// terminals each route was drawn for). Routes are runs of grid points, not the single `points`
// line of the SPEC 6.5 example, because a net with branches has several.
//
// `basis` is the project's revision (circuit + intent) when the layout was made. A file changed by
// hand since then no longer matches, and its layout is ignored rather than trusted.

import type { Rot } from "../geom/geom.js";
import type { LayoutState, Side } from "../core/intent.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isPt = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];

/** The `layout` object to save for a layout state. */
export function toLayoutCache(state: LayoutState, basis: string, mode: string): Obj {
  const parts: Obj = {};
  for (const [id, p] of Object.entries(state.parts)) {
    parts[id] = {
      x: p.at[0], y: p.at[1], rot: p.orient.rot, flip: p.orient.flip,
      ...(p.column !== undefined ? { column: p.column } : {}),
      ...(p.sides !== undefined ? { sides: p.sides } : {}),
    };
  }
  const routes = Object.entries(state.routes).map(([net, r]) => ({ net, terminals: r.terminals, runs: r.runs, ...(r.ports ? { ports: true } : {}) }));
  return { mode, basis, parts, routes, ...(state.templates !== undefined ? { templates: state.templates } : {}) };
}

/**
 * The layout state saved in a file, if it is readable and was made for this revision. `note` says
 * why a saved layout is not used; a file that has none gets neither.
 */
export function fromLayoutCache(cache: unknown, basis: string): { state?: LayoutState; note?: string } {
  if (cache === undefined) return {};
  const bad = { note: "the saved layout in this file cannot be read, so it is drawn afresh." };
  if (!isObj(cache) || !isObj(cache.parts) || !Array.isArray(cache.routes)) return bad;
  if (cache.basis !== basis) return { note: "the circuit or hints changed since this file's layout was saved, so it is drawn afresh." };
  const state: LayoutState = { parts: {}, routes: {} };
  for (const [id, p] of Object.entries(cache.parts)) {
    if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || ![0, 90, 180, 270].includes(p.rot as number) || typeof p.flip !== "boolean") return bad;
    if (p.column !== undefined && !isNum(p.column)) return bad;
    if (p.sides !== undefined && (!isObj(p.sides) || !Object.entries(p.sides).every(([s, v]) => SIDES.includes(s as Side) && isStrArray(v)))) return bad;
    state.parts[id] = {
      at: [p.x, p.y], orient: { rot: p.rot as Rot, flip: p.flip },
      ...(p.sides !== undefined ? { sides: structuredClone(p.sides) as Partial<Record<Side, string[]>> } : {}),
      ...(p.column !== undefined ? { column: p.column } : {}),
    };
  }
  for (const r of cache.routes) {
    if (!isObj(r) || typeof r.net !== "string" || typeof r.terminals !== "string" || state.routes[r.net]) return bad;
    if (!Array.isArray(r.runs) || !r.runs.every((run) => Array.isArray(run) && run.every(isPt))) return bad;
    if (r.ports !== undefined && r.ports !== true) return bad;
    state.routes[r.net] = { terminals: r.terminals, runs: structuredClone(r.runs) as LayoutState["routes"][string]["runs"], ...(r.ports ? { ports: true as const } : {}) };
  }
  if (cache.templates !== undefined) {
    if (!isStrArray(cache.templates)) return bad;
    state.templates = [...cache.templates];
  }
  return { state };
}
