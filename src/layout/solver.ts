// Difference-constraint solver (SPEC 9.2 step 6).
// A constraint `a - b >= c` is an edge b -> a with weight c. Longest paths from the
// origin x0 (= 0, zero-weight edge to every variable) give the most compact integer
// solution; a positive cycle means the constraints cannot all hold.

/**
 * Incremental mode: `prev` keeps an untouched part where it was, `prevAffected` keeps a part the
 * edit touched near where it was. They give way first, affected parts before untouched ones, and
 * each part's upper bound (`prevUp`, `prevAffectedUp`) before its lower bound, so a part that must
 * make room moves right or down, never back to the origin.
 * `templateSoft`: a template's linking constraints in incremental mode; they give way to untouched
 * parts staying put, but move the parts the edit touched.
 */
export type Priority = "structural" | "lock" | "strict" | "high" | "template" | "normal" | "align" | "prev" | "prevUp" | "templateSoft" | "prevAffected" | "prevAffectedUp";
const RANK: Record<Priority, number> = {
  structural: 9, lock: 8, strict: 7, high: 6, template: 5, normal: 4, align: 3, prev: 2, prevUp: 1.5, templateSoft: 1, prevAffected: 0, prevAffectedUp: -0.5,
};

export interface Constraint { a: string; b: string; c: number; priority: Priority; why: string }

export const X0 = "x0";

export type Solve = { ok: true; value: Map<string, number> } | { ok: false; cycle: Constraint[] };

export function solve(vars: string[], cons: Constraint[]): Solve {
  const ids = [X0, ...vars];
  const dist = new Map<string, number>(ids.map((v) => [v, v === X0 ? 0 : -Infinity]));
  const pred = new Map<string, Constraint>();
  const all: Constraint[] = [...vars.map((v): Constraint => ({ a: v, b: X0, c: 0, priority: "structural", why: "origin" })), ...cons];
  let changed: string | undefined;
  for (let i = 0; i < ids.length; i++) {
    changed = undefined;
    for (const k of all) {
      const db = dist.get(k.b)!;
      if (db === -Infinity) continue;
      if (db + k.c > dist.get(k.a)!) { dist.set(k.a, db + k.c); pred.set(k.a, k); changed = k.a; }
    }
    if (changed === undefined) break;
  }
  if (changed === undefined) {
    dist.delete(X0);
    return { ok: true, value: dist as Map<string, number> };
  }
  // Walk predecessors |V| times to land inside the cycle, then collect it.
  let v = changed;
  for (let i = 0; i < ids.length; i++) v = pred.get(v)!.b;
  const cycle: Constraint[] = [];
  let u = v;
  do { const k = pred.get(u)!; cycle.push(k); u = k.b; } while (u !== v && cycle.length <= ids.length);
  return { ok: false, cycle: cycle.reverse() };
}

/**
 * Solve, dropping the lowest-priority non-structural constraint on each positive cycle
 * (at most `maxDrops` times). Cycles made only of structural, lock, strict or high
 * constraints are infeasible.
 */
export function solveWithDrops(vars: string[], cons: Constraint[], maxDrops = 50):
  | { ok: true; value: Map<string, number>; dropped: Constraint[] }
  | { ok: false; reason: "infeasible" | "budget_exhausted"; cycle: Constraint[]; dropped: Constraint[] } {
  let active = [...cons];
  const dropped: Constraint[] = [];
  for (let i = 0; i <= maxDrops; i++) {
    const r = solve(vars, active);
    if (r.ok) return { ok: true, value: r.value, dropped };
    const droppable = r.cycle.filter((k) => RANK[k.priority] < RANK.high);
    if (!droppable.length) return { ok: false, reason: "infeasible", cycle: r.cycle, dropped };
    const lowest = droppable.reduce((m, k) => (RANK[k.priority] < RANK[m.priority] ? k : m));
    active = active.filter((k) => k !== lowest);
    dropped.push(lowest);
  }
  return { ok: false, reason: "budget_exhausted", cycle: [], dropped };
}

export function eq(a: string, b: string, c: number, priority: Priority, why: string): Constraint[] {
  return [{ a, b, c, priority, why }, { a: b, b: a, c: -c, priority, why }];
}
