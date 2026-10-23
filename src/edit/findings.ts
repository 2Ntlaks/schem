// Findings harness (SPEC 10.2, Phase 0b minimal version): every convention break and readability
// breach of a drawing becomes a finding, and each gets a checked fix when one exists. A fix is
// found by dry-running at most 5 candidate edits; it is offered only if the result is valid and
// lexicographically better (or with a stated trade-off), and it is tied to the layout it was
// checked on by `expectedLayout`.

import { cmpStr, type Pt } from "../geom/geom.js";
import { circuitEquals } from "../core/equals.js";
import type { LayoutState } from "../core/intent.js";
import { pinDefsOf, type Project } from "../layout/layout.js";
import { checkDrawing, type DrawingCheck } from "../quality/index.js";
import type { RenderModel } from "../render/model.js";
import { edit, layoutToken, type EditOp, type EditResult } from "./edit.js";

export interface CheckedFix {
  ops: EditOp[];
  expectedLayout: string;
  changesCircuit: boolean;
  /** Change in each measured count if the fix is applied (negative = fewer). */
  expect: Record<string, number>;
  tradeoff: string | null;
}

export interface ReviewFinding {
  id: string;
  severity: "error" | "warn" | "info";
  message: string;
  fix: CheckedFix | null;
}

export const MAX_CANDIDATES = 5;

/** Score of a drawing, compared lexicographically (SPEC 9.1 groups, 10.1). */
interface Score { invalid: number; conventions: number; breaches: number; crossings: number; bends: number; wireLength: number }
const ORDER: Array<keyof Score> = ["invalid", "conventions", "breaches", "crossings", "bends", "wireLength"];
const GROUP: Record<keyof Score, string> = { invalid: "validity", conventions: "conventions", breaches: "readability", crossings: "crossings", bends: "bends", wireLength: "wire length" };

function score(q: DrawingCheck): Score {
  return { invalid: q.valid ? 0 : 1, conventions: q.conventions.length, breaches: q.breaches.length, crossings: q.metrics.crossings, bends: q.metrics.bends, wireLength: q.metrics.wireLength };
}
function compare(a: Score, b: Score): number {
  for (const k of ORDER) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
}

/**
 * All findings for the project as last laid out (`state` and `render`), most severe first.
 * `limit` caps how many findings get a fix search (the rest keep `fix: null` and say so).
 */
export function review(project: Project, state: LayoutState, render: RenderModel, limit = 10): ReviewFinding[] {
  const defs = pinDefsOf(project.circuit);
  const now = checkDrawing(project.circuit, defs, render);
  const base = score(now);
  const token = layoutToken(project, state);
  const problems: Array<{ id: string; severity: ReviewFinding["severity"]; message: string; candidates: EditOp[][]; gone: (q: DrawingCheck) => boolean }> = [];

  for (const e of [...now.connections.errors, ...now.overlaps]) problems.push({ id: `E-${e.code}`, severity: "error", message: e.message, candidates: [], gone: () => false });
  for (const f of now.conventions) problems.push({ id: f.id, severity: "warn", message: f.message, candidates: conventionCandidates(f.id, f.parts, state), gone: (q) => !q.conventions.some((g) => g.id === f.id) });
  for (const b of now.breaches) {
    const near = partsNear(render, b.at);
    problems.push({ id: `L-${b.metric}`, severity: "info", message: `Readability: ${b.message}.`, candidates: breachCandidates(b.metric, near, state), gone: (q) => !q.breaches.some((x) => x.metric === b.metric) });
  }

  return problems.map((p, i): ReviewFinding => {
    if (i >= limit) return { id: p.id, severity: p.severity, message: `${p.message} (no fix searched: past the first ${limit} findings)`, fix: null };
    let best: { ops: EditOp[]; r: EditResult; s: Score } | undefined;
    for (const ops of p.candidates.slice(0, MAX_CANDIDATES)) {
      const r = edit({ project, previous: state, ops, expectedLayout: token });
      if (!r.saved || !r.check || !p.gone(r.check)) continue;
      const s = score(r.check);
      if (!best || compare(s, best.s) < 0) best = { ops, r, s };
    }
    if (!best) return { id: p.id, severity: p.severity, message: `${p.message} No checked fix found${p.candidates.length ? ` among ${Math.min(p.candidates.length, MAX_CANDIDATES)} candidates` : ""}.`, fix: null };
    const better = compare(best.s, base) < 0;
    const worse = ORDER.filter((k) => best!.s[k] > base[k]);
    const firstChange = ORDER.find((k) => best!.s[k] !== base[k]);
    const tradeoff = better ? null : `fixes this but makes ${worse.map((k) => GROUP[k]).join(", ")} worse`;
    if (!better && firstChange && GROUP[firstChange] === "validity") return { id: p.id, severity: p.severity, message: `${p.message} No checked fix found.`, fix: null };
    const expect: Record<string, number> = {};
    for (const k of ORDER) if (best.s[k] !== base[k]) expect[k] = best.s[k] - base[k];
    return {
      id: p.id, severity: p.severity, message: p.message,
      fix: { ops: best.ops, expectedLayout: token, changesCircuit: !circuitEquals(project.circuit, defs, best.r.project.circuit), expect, tradeoff },
    };
  });
}

function conventionCandidates(id: string, parts: string[], state: LayoutState): EditOp[][] {
  const [first, second] = parts;
  if (!first) return [];
  if (id.startsWith("C10-") || id.startsWith("C9.4-") || id.startsWith("C7-source-")) return [90, 270].map((rot) => [{ op: "setOrientation", part: first, rot: rot as 90 | 270 }]);
  if (id.startsWith("C11-") && second) return [[{ op: "align", axis: "row", parts: [first, second] }]];
  if (id.startsWith("C8-") && second) return [[{ op: "place", part: second, rel: "left-of", of: first }], [{ op: "place", part: first, rel: "right-of", of: second }]];
  if (id.startsWith("C13-") && second) {
    const rels = ["right-of", "left-of", "below", "above"] as const;
    return rels.map((rel) => [{ op: "place", part: first, rel, of: second, priority: "high" } as EditOp]).slice(0, MAX_CANDIDATES);
  }
  void state;
  return [];
}

function breachCandidates(metric: string, near: string[], state: LayoutState): EditOp[][] {
  if (metric === "marginImbalance" || metric === "aspectError") return [];
  const out: EditOp[][] = [];
  for (const id of near) {
    const p = state.parts[id];
    if (!p) continue;
    if (p.sides) {
      // Reverse the order of the pins on one side of a generated box.
      for (const side of ["left", "right", "top", "bottom"] as const) {
        const pins = p.sides[side];
        if (pins && pins.length > 1) out.push([{ op: "setPinSides", part: id, [side]: [...pins].reverse() }]);
      }
    } else {
      out.push([{ op: "setOrientation", part: id, rot: ((p.orient.rot + 180) % 360) as 0 | 90 | 180 | 270, flip: p.orient.flip }]);
    }
  }
  out.push([{ op: "setSpacing", factor: 1.5 }]);
  return out.slice(0, MAX_CANDIDATES);
}

/** Parts whose keep-out lies within 4 G of any of the points (else the two nearest), nearest first. */
function partsNear(m: RenderModel, at: Pt[]): string[] {
  const d = new Map<string, number>();
  for (const k of m.electrical.keepouts ?? []) {
    if (k.part.includes(":")) continue;
    for (const p of at) {
      const dx = Math.max(0, k.x - p[0], p[0] - (k.x + k.w)), dy = Math.max(0, k.y - p[1], p[1] - (k.y + k.h));
      const dist = Math.hypot(dx, dy);
      if (dist < (d.get(k.part) ?? Infinity)) d.set(k.part, dist);
    }
  }
  const sorted = [...d].sort((a, b) => a[1] - b[1] || cmpStr(a[0], b[0]));
  const close = sorted.filter(([, dist]) => dist <= 4);
  return (close.length ? close : sorted.slice(0, 2)).map(([id]) => id);
}
