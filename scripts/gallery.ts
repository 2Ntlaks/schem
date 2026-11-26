// Draw the README gallery pictures that come straight from examples/: docs/assets/gallery-<name>.png.
//
// Usage: npm run readme:gallery
//
// Each picture is the example file laid out and rendered by the engine when this runs, at twice the
// size `schem draw` writes. A drawing that is not valid stops the script.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layout } from "../src/layout/layout.js";
import { formatOf, projectText } from "../src/mcp/project-files.js";
import { checkDrawing } from "../src/quality/index.js";
import { toPng } from "../src/render/png.js";
import { toSvg } from "../src/render/svg.js";
import { resolveTheme, type ThemeName } from "../src/render/themes.js";

interface GalleryItem {
  readonly output: string;
  readonly source: string;
  readonly theme?: ThemeName;
}

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ITEMS: readonly GalleryItem[] = [
  { output: "sallen-key-filter", source: "sallen-key-filter.schem.json" },
  { output: "wien-bridge", source: "wien-bridge.schem.json" },
  { output: "relaxation-oscillator", source: "relaxation-oscillator.schem.json" },
  { output: "pico-i2c-oled", source: "pico-i2c-oled.schem" },
  { output: "summing-dark", source: "summing-amp.schem.json", theme: "dark" },
];
const OUT = path.join(ROOT, "docs", "assets");

mkdirSync(OUT, { recursive: true });
for (const item of ITEMS) {
  const file = path.join(ROOT, "examples", item.source);
  const text = readFileSync(file, "utf8");
  const project = projectText(text, formatOf(file)).project;
  if (!project) throw new Error(`${item.output}: the example file could not be read (${item.source})`);
  const r = layout(project);
  if (!r.render || r.status !== "valid" || !checkDrawing(project.circuit, r.pinDefs, r.render).valid) {
    throw new Error(`${item.output}: the drawing is not valid (${r.status})`);
  }
  const svg = item.theme ? toSvg(r.render, { theme: item.theme }) : toSvg(r.render);
  const png = item.theme
    ? toPng(svg, 20, { background: resolveTheme(item.theme).background })
    : toPng(svg, 20);
  writeFileSync(path.join(OUT, `gallery-${item.output}.png`), png);
  console.log(`wrote docs/assets/gallery-${item.output}.png (${Math.round(png.length / 1024)} KB)`);
}
