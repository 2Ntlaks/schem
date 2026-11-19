// The benchmark's score for one drawing (lower is better). It turns "does this look like an
// engineer drew it" into one number built from things the engine can already measure, plus two
// structural counts that the validation gates do not have: active parts drawn facing backwards,
// and receivers drawn left of their driver.
//
// The weights are judgement, not calibration: they rank a drawing with a crossing or a mirrored
// op-amp below one without. Change them only together with bench/baseline.json.

import { netKind, type Circuit, type PinDefs } from "../../src/core/model.js";
import { validate } from "../../src/core/validate.js";
import type { DrawingCheck } from "../../src/quality/index.js";
import type { RenderModel } from "../../src/render/model.js";

export const WEIGHTS = {
  notDrawn: 400,       // no drawing at all, or one the verifier rejects
  lowConfidence: 30,   // drawn and correct, but the engine guessed the flow
  crossing: 8,
  bend: 1.5,
  wire: 0.15,          // per grid step of wire
  convention: 6,       // a drafting convention broken (src/quality/conventions.ts)
  breach: 6,           // a readability limit broken (src/quality/metrics.ts)
  backwards: 15,       // an op-amp or transistor facing right to left
  upstream: 10,        // an input drawn left of the output that drives it
  area: 0.01,          // per square grid step of sheet
} as const;

export interface Score {
  total: number;
  crossings: number;
  bends: number;
  wire: number;
  conventions: number;
  breaches: number;
  backwards: number;
  upstream: number;
  area: number;
}

/** Pins that take a signal in, and the pin that drives one out, for the parts that have a direction. */
const DIRECTED: Record<string, { ins: string[]; out: string[]; faceLeft: string }> = {
  opamp: { ins: ["2", "3"], out: ["1"], faceLeft: "2" },
  npn: { ins: ["B"], out: ["C"], faceLeft: "B" },
  pnp: { ins: ["B"], out: ["C"], faceLeft: "B" },
  nmos: { ins: ["G"], out: ["D"], faceLeft: "G" },
  pmos: { ins: ["G"], out: ["D"], faceLeft: "G" },
};

export function scoreDrawing(circuit: Circuit, pinDefs: PinDefs, m: RenderModel, q: DrawingCheck): Score {
  const pinAt = new Map(m.electrical.pins.map((p) => [`${p.part}[${p.number}]`, p]));
  let backwards = 0, upstream = 0;
  for (const part of circuit.parts) {
    const d = DIRECTED[part.type];
    if (!d) continue;
    const p = pinAt.get(`${part.id}[${d.faceLeft}]`);
    if (p && p.dir === "right") backwards++;
  }
  // A receiver left of its driver, on signal nets with exactly one driving pin.
  const v = validate(circuit, pinDefs).valid;
  if (v) {
    const typeOf = new Map(circuit.parts.map((p) => [p.id, p.type]));
    const role = (part: string, num: string) => pinDefs[part]?.find((x) => x.number === num)?.role;
    for (const n of circuit.nets) {
      if (netKind(n) !== "signal") continue;
      const eps = (v.endpoints.get(n.id) ?? []).flatMap((e) => (e.kind === "terminal" ? [e] : []));
      const drives = (e: { part: string; number: string }) => DIRECTED[typeOf.get(e.part) ?? ""]?.out.includes(e.number) || role(e.part, e.number) === "output";
      const takes = (e: { part: string; number: string }) => DIRECTED[typeOf.get(e.part) ?? ""]?.ins.includes(e.number) || role(e.part, e.number) === "input";
      const drivers = eps.filter(drives);
      if (drivers.length !== 1) continue;
      const from = pinAt.get(`${drivers[0]!.part}[${drivers[0]!.number}]`);
      for (const e of eps.filter(takes)) {
        const to = pinAt.get(`${e.part}[${e.number}]`);
        if (from && to && e.part !== drivers[0]!.part && to.at[0] < from.at[0]) upstream++;
      }
    }
  }
  const x = q.metrics;
  const area = x.sheet[0] * x.sheet[1];
  const total = WEIGHTS.crossing * x.crossings + WEIGHTS.bend * x.bends + WEIGHTS.wire * x.wireLength
    + WEIGHTS.convention * q.conventions.length + WEIGHTS.breach * q.breaches.length
    + WEIGHTS.backwards * backwards + WEIGHTS.upstream * upstream + WEIGHTS.area * area;
  return {
    total: Math.round(total * 10) / 10, crossings: x.crossings, bends: x.bends, wire: x.wireLength,
    conventions: q.conventions.length, breaches: q.breaches.length, backwards, upstream, area: Math.round(area),
  };
}
