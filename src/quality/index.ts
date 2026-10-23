// One entry point for verification layers 1-4 on a finished drawing. A drawing is shown
// as finished only if layers 1 and 2 pass; layers 3 and 4 report what to improve.

import type { Circuit, PinDefs } from "../core/model.js";
import type { RenderModel } from "../render/model.js";
import { verify, type VerifyResult } from "../verify/verify.js";
import { checkConventions, type Finding } from "./conventions.js";
import { limitBreaches, measureDrawing, type LimitBreach, type Metrics } from "./metrics.js";
import { checkOverlaps, type QualityIssue } from "./overlap.js";

export interface DrawingCheck {
  /** Layers 1 and 2 both pass. */
  valid: boolean;
  connections: VerifyResult;
  overlaps: QualityIssue[];
  conventions: Finding[];
  metrics: Metrics;
  breaches: LimitBreach[];
}

export function checkDrawing(circuit: Circuit, pinDefs: PinDefs, m: RenderModel): DrawingCheck {
  const connections = verify(circuit, pinDefs, m.electrical);
  const overlaps = checkOverlaps(m);
  const metrics = measureDrawing(m);
  return {
    valid: connections.valid && overlaps.length === 0,
    connections,
    overlaps,
    conventions: checkConventions(circuit, pinDefs, m),
    metrics,
    breaches: limitBreaches(metrics),
  };
}

export type { Finding, LimitBreach, Metrics, QualityIssue };
