// The random-edit stability sweep of tests/edits.test.ts, with the figures printed:
// `npx tsx scripts/edit-sweep.ts`. Use it to see which generated edits break the stability gate.
import { layout } from "../src/layout/layout.js";
import { edit } from "../src/edit/edit.js";
import { stabilityBreaks } from "../src/edit/report.js";
import { generate } from "../tests/support/generate.js";
import { randomEdit } from "../tests/support/random-edits.js";

let saved = 0, stable = 0;
for (let seed = 1; seed <= 150; seed++) {
  const g = generate(seed, 5);
  const base = layout({ circuit: g.circuit });
  if (!base.state || !base.status.startsWith("valid")) continue;
  const e = randomEdit(g.circuit, seed * 31);
  if (!e.ops.length) continue;
  const r = edit({ project: { circuit: g.circuit }, previous: base.state, ops: e.ops });
  if (!r.saved) continue;
  saved++;
  const breaks = stabilityBreaks(r.report!);
  if (breaks.length) console.log(`#${seed} ${e.kind}: ${breaks.join("; ")}`); else stable++;
}
console.log(`${stable} of ${saved} saved edits are stable (${(100 * stable / saved).toFixed(1)}%)`);
