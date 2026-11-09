// Draw the README gallery pictures that come straight from examples/: docs/assets/gallery-<name>.png.
//
// Usage: npm run readme:gallery
//
// Each picture is the example file laid out and rendered by the engine when this runs, at twice the
// size `schem draw` writes. A drawing that is not valid stops the script.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toPng } from "../src/render/png.js";
import { toSvg } from "../src/render/svg.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXAMPLES = ["sallen-key-filter", "wien-bridge", "relaxation-oscillator"];
const OUT = path.join(ROOT, "docs", "assets");

mkdirSync(OUT, { recursive: true });
for (const name of EXAMPLES) {
  const file = path.join(ROOT, "examples", `${name}.schem.json`);
  const project = readProject(file).project;
  if (!project) throw new Error(`${name}: the example file could not be read`);
  const r = layout(project);
  if (!r.render || r.status !== "valid" || !checkDrawing(project.circuit, r.pinDefs, r.render).valid) throw new Error(`${name}: the drawing is not valid (${r.status})`);
  const png = toPng(toSvg(r.render), 20);
  writeFileSync(path.join(OUT, `gallery-${name}.png`), png);
  console.log(`wrote docs/assets/gallery-${name}.png (${Math.round(png.length / 1024)} KB)`);
}
