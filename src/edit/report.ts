// Change report for an edit (SPEC 9.5) and the Phase 0b stability gate (SPEC 15 gate 4).

import { cmpStr, key, unitEdges, type Pt } from "../geom/geom.js";
import type { LayoutState } from "../core/intent.js";

export interface ChangeReport {
  /** Whole-sheet shift removed before measuring (the most common move of untouched parts). */
  shift: Pt;
  /** Per part that exists before and after: distance moved (G, after the shift) and orientation change. */
  parts: Record<string, { moved: number; turned: boolean }>;
  untouched: { count: number; meanMove: number; maxMove: number; turned: string[] };
  lockedMoved: string[];
  /**
   * Wired nets whose drawn conductors changed, split by whether the edit involved them. Nets drawn
   * only with supply or ground symbols are listed apart: their stubs move with their parts, which
   * the displacement figures already count.
   */
  routesChanged: { affected: string[]; other: string[]; portStubs: string[] };
}

export function changeReport(
  before: LayoutState, after: LayoutState, affectedParts: ReadonlySet<string>, affectedNets: ReadonlySet<string>, locked: ReadonlySet<string>,
): ChangeReport {
  const common = Object.keys(after.parts).filter((id) => before.parts[id]).sort(cmpStr);
  const delta = (id: string): Pt => [after.parts[id]!.at[0] - before.parts[id]!.at[0], after.parts[id]!.at[1] - before.parts[id]!.at[1]];
  const untouchedIds = common.filter((id) => !affectedParts.has(id));
  const votes = new Map<string, number>();
  for (const id of untouchedIds) votes.set(key(delta(id)), (votes.get(key(delta(id))) ?? 0) + 1);
  const shiftKey = [...votes].sort((a, b) => b[1] - a[1] || norm(a[0]) - norm(b[0]) || cmpStr(a[0], b[0]))[0]?.[0] ?? "0,0";
  const shift = shiftKey.split(",").map(Number) as unknown as Pt;

  const parts: ChangeReport["parts"] = {};
  for (const id of common) {
    const d = delta(id);
    const o1 = before.parts[id]!.orient, o2 = after.parts[id]!.orient;
    parts[id] = { moved: Math.hypot(d[0] - shift[0], d[1] - shift[1]), turned: o1.rot !== o2.rot || o1.flip !== o2.flip };
  }
  const moves = untouchedIds.map((id) => parts[id]!.moved);
  const lockedMoved = common.filter((id) => locked.has(id) && (delta(id)[0] !== 0 || delta(id)[1] !== 0));

  const edgesOf = (s: LayoutState, net: string) => new Set((s.routes[net]?.runs ?? []).flatMap((w) => unitEdges(w)).map(([a, b]) => {
    const [p, q] = [key([a[0] - (s === after ? shift[0] : 0), a[1] - (s === after ? shift[1] : 0)]), key([b[0] - (s === after ? shift[0] : 0), b[1] - (s === after ? shift[1] : 0)])];
    return p < q ? `${p}|${q}` : `${q}|${p}`;
  }));
  const changed: string[] = [], stubs: string[] = [];
  for (const net of [...new Set([...Object.keys(before.routes), ...Object.keys(after.routes)])].sort(cmpStr)) {
    const e1 = edgesOf(before, net), e2 = edgesOf(after, net);
    if (e1.size === e2.size && [...e1].every((e) => e2.has(e))) continue;
    (before.routes[net]?.ports && after.routes[net]?.ports ? stubs : changed).push(net);
  }
  return {
    shift,
    parts,
    untouched: {
      count: untouchedIds.length,
      meanMove: moves.length ? round(moves.reduce((a, b) => a + b, 0) / moves.length) : 0,
      maxMove: moves.length ? round(Math.max(...moves)) : 0,
      turned: untouchedIds.filter((id) => parts[id]!.turned),
    },
    lockedMoved,
    routesChanged: { affected: changed.filter((n) => affectedNets.has(n)), other: changed.filter((n) => !affectedNets.has(n)), portStubs: stubs },
  };
}

/** SPEC 15 Phase 0b gate 4. Returns the broken conditions (empty = stable). */
export function stabilityBreaks(r: ChangeReport): string[] {
  const out: string[] = [];
  if (r.lockedMoved.length) out.push(`locked parts moved: ${r.lockedMoved.join(", ")}`);
  if (r.untouched.meanMove > 2) out.push(`untouched parts moved ${r.untouched.meanMove} G on average (at most 2)`);
  if (r.untouched.maxMove > 6) out.push(`an untouched part moved ${r.untouched.maxMove} G (at most 6)`);
  if (r.untouched.turned.length) out.push(`untouched parts changed orientation: ${r.untouched.turned.join(", ")}`);
  if (r.routesChanged.other.length > 1) out.push(`routes changed on ${r.routesChanged.other.length} nets the edit did not involve (at most 1): ${r.routesChanged.other.join(", ")}`);
  return out;
}

function norm(k: string): number { const [x, y] = k.split(",").map(Number); return Math.abs(x!) + Math.abs(y!); }
function round(n: number): number { return Math.round(n * 100) / 100; }
