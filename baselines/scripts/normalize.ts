// Turns each frozen Phase 0b case into one flat, tool-neutral netlist that every baseline converter reads.
// Pins are resolved with the case author's own loader (phase0/check-cases.ts + src/core), read only.
// Run from the repo root:  npx tsx baselines/scripts/normalize.ts
// Output: baselines/out/_netlist/<set>/caseNN.json   (test-set files stay under out/, see README hygiene note)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCase, CASES } from "../../phase0/check-cases.js";
import { resolveEndpoint, groupRepresentative } from "../../src/core/validate.js";
import { netKind } from "../../src/core/model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function label(p: any): string {
  const pr = p.props ?? {};
  return pr.value ?? pr.partNumber ?? pr.label ?? (pr.color ? `${pr.color}` : "");
}

for (const set of ["validation", "test"]) {
  const outDir = join(ROOT, "out", "_netlist", set);
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(join(CASES, set)).filter((x) => /^case\d\d.*\.json$/.test(x)).sort()) {
    const lc = loadCase(join(CASES, set, f));
    const file = lc.file;
    const reps: Record<string, Record<string, string>> = {};
    for (const p of file.circuit.parts) {
      const def = file.assets?.definitions?.[p.type];
      if (def?.representatives) reps[p.id] = def.representatives;
    }
    const nets = file.circuit.nets.map((n: any) => {
      const members = n.endpoints.map((e: string) => {
        const r = resolveEndpoint(e, lc.pinDefs);
        if (!r.ok) throw new Error(`${f}: ${r.issue.message}`);
        let num: string, viaGroup: string | undefined;
        if (r.ep.kind === "terminal") num = r.ep.number;
        else {
          viaGroup = r.ep.group;
          num = reps[r.ep.part]?.[r.ep.group] ?? groupRepresentative(r.ep.part, r.ep.group, lc.pinDefs)!;
        }
        const pin = lc.pinDefs[r.ep.part]!.find((q) => q.number === num)!;
        return { part: r.ep.part, pin: num, name: pin.name, role: pin.role, ...(viaGroup ? { group: viaGroup } : {}), written: e };
      });
      return { id: n.id, name: n.name ?? null, kind: netKind(n), members };
    });
    const nc = (file.circuit.nc ?? []).map((e: string) => {
      const r = resolveEndpoint(e, lc.pinDefs);
      if (!r.ok || r.ep.kind !== "terminal") throw new Error(`${f}: bad nc ${e}`);
      return { part: r.ep.part, pin: r.ep.number };
    });
    const parts = file.circuit.parts.map((p: any) => ({
      id: p.id, type: p.type, props: p.props ?? {}, label: label(p),
      moduleName: file.assets?.definitions?.[p.type]?.name ?? null,
      pinSource: lc.pinSource[p.id],
      pins: lc.pinDefs[p.id]!.map((q) => ({ number: q.number, name: q.name, role: q.role, ...(q.group ? { group: q.group } : {}) })),
    }));
    const caseNo = f.slice(4, 6);
    const out = { case: Number(caseNo), set, source: `phase0/cases/${set}/${f}`, title: file.meta?.title ?? "", parts, nets, nc };
    writeFileSync(join(outDir, `case${caseNo}.json`), JSON.stringify(out, null, 1));
    console.log(`${set} case${caseNo}: ${parts.length} parts, ${nets.length} nets`);
  }
}
