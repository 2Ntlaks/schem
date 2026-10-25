// Draws the small template circuits of tests/support/template-circuits.ts to out/templates/<name>.png,
// with their block graphs and checks, for looking at them.
import { mkdirSync, writeFileSync } from "node:fs";
import { layout } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";
import { checkDrawing } from "../src/quality/index.js";
import { TEMPLATE_CIRCUITS } from "../tests/support/template-circuits.js";

mkdirSync("out/templates", { recursive: true });
for (const [name, project] of Object.entries(TEMPLATE_CIRCUITS)) {
  const r = layout(project);
  if (!r.render) { console.log(name, r.status, r.issues); continue; }
  const q = checkDrawing(project.circuit, r.pinDefs, r.render);
  writeFileSync(`out/templates/${name}.png`, toPng(toSvg(r.render)));
  console.log(`${name}: ${r.status}, valid ${q.valid}, blocks ${r.blocks!.map((b) => `${b.id}@${b.rank}`).join(" ")}`);
  console.log(`  metrics: crossings ${q.metrics.crossings}, bends ${q.metrics.bends}, dots ${q.metrics.dots}; conventions [${q.conventions.map((c) => c.id).join(", ")}]; breaches [${q.breaches.map((b) => b.metric).join(", ")}]`);
  for (const n of r.notes) console.log(`  note: ${n}`);
}
