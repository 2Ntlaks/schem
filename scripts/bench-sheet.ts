// One image of every bench drawing, for a quick look: `npx tsx scripts/bench-sheet.ts [names...]`
// writes out/bench/sheet.png (run `npm run bench` first).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { ROOT } from "./lib/case-run.js";

const dir = join(ROOT, "out", "bench");
const want = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith(".png") && !f.startsWith("sheet") && (!want.length || want.includes(f.replace(".png", "")))).sort();
const cols = Math.min(3, files.length), cell = 560, rows = Math.ceil(files.length / cols);
const size = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)] as const;
let body = "";
files.forEach((f, i) => {
  const b = readFileSync(join(dir, f)), [w, h] = size(b);
  const k = Math.min((cell - 20) / w, (cell - 50) / h, 1.2);
  const x = (i % cols) * cell + (cell - w * k) / 2, y = Math.floor(i / cols) * cell + 36;
  body += `<text x="${(i % cols) * cell + 12}" y="${Math.floor(i / cols) * cell + 24}" font-family="DejaVu Sans" font-size="18">${f.replace(".png", "")}</text>`;
  body += `<image x="${x}" y="${y}" width="${w * k}" height="${h * k}" href="data:image/png;base64,${b.toString("base64")}"/>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
writeFileSync(join(dir, "sheet.png"), new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
console.log(`out/bench/sheet.png (${files.length} drawings)`);
