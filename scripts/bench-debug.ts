// Prints where the layout put each part of one bench circuit: `npx tsx scripts/bench-debug.ts mcu`.
import { join } from "node:path";
import { layout } from "../src/layout/layout.js";
import { readProject } from "../src/io/project.js";
import { ROOT } from "./lib/case-run.js";

const name = process.argv[2] ?? "mcu";
const p = readProject(join(ROOT, "bench", "circuits", `${name}.schem.json`)).project!;
const r = layout(p);
console.log(r.status);
for (const n of r.notes) console.log("note:", n);
for (const b of r.blocks ?? []) console.log(`block ${b.id} rank ${b.rank} [${b.parts.join(" ")}]`);
for (const [id, s] of Object.entries(r.state?.parts ?? {}).sort((a, b) => a[1].column! - b[1].column! || a[1].at[1] - b[1].at[1])) console.log(`${id.padEnd(6)} col ${String(s.column).padEnd(8)} at ${s.at.join(",").padEnd(8)} rot ${s.orient.rot}${s.orient.flip ? " flip" : ""}`);
