// Draws the Appendix A worked examples with the fixed placements from tests/appendix-a.test.ts
// to out/appendix-a1.png and out/appendix-a2.png, for looking at them.
import { mkdirSync, writeFileSync } from "node:fs";
import { layout } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";
import { checkDrawing } from "../src/quality/index.js";
import { A1, A2 } from "../tests/support/appendix-a.js";

mkdirSync("out", { recursive: true });
for (const [name, ex] of [["appendix-a1", A1], ["appendix-a2", A2()]] as const) {
  const r = layout(ex.project, { place: ex.place, ...(ex.prewire ? { prewire: ex.prewire } : {}) });
  if (!r.render) { console.log(name, r.status, r.issues); continue; }
  const q = checkDrawing(ex.project.circuit, r.pinDefs, r.render);
  writeFileSync(`out/${name}.png`, toPng(toSvg(r.render)));
  console.log(name, r.status, "verifier", q.connections.valid, "overlaps", q.overlaps.map((o) => o.message), "metrics", JSON.stringify(q.metrics), q.connections.errors.map((e) => e.message));
}
