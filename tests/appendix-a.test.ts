// SPEC Appendix A (rev C.2): the worked block graphs, placed exactly as their constraints say,
// routed by the 0a router, must pass layers 1-2 with the stated junction and crossing counts.

import { describe, expect, it } from "vitest";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { A1, A2 } from "./support/appendix-a.js";

for (const [name, ex] of [["A.1 inverting summing amplifier", A1], ["A.2 I2C bus with pull-ups", A2()]] as const) {
  describe(name, () => {
    const r = layout(ex.project, { place: ex.place, ...(ex.prewire ? { prewire: ex.prewire } : {}) });
    const q = checkDrawing(ex.project.circuit, r.pinDefs, r.render!);

    it("lays out as valid and passes the verifier and the overlap checks", () => {
      expect(r.status).toBe("valid");
      expect(q.connections.errors).toEqual([]);
      expect(q.overlaps).toEqual([]);
    });

    it(`has ${ex.expect.dots} junction dots and ${ex.expect.crossings} crossings`, () => {
      expect([q.metrics.dots, q.metrics.crossings]).toEqual([ex.expect.dots, ex.expect.crossings]);
    });

    it("breaks no convention and no readability limit", () => {
      expect(q.conventions).toEqual([]);
      expect(q.breaches).toEqual([]);
    });
  });
}
