// Loads every Phase 0b case and edit script through src/core and reports problems.
// Run: npx tsx phase0/check-cases.ts            (exit 1 if any case or edit fails to load)
//      npx tsx phase0/check-cases.ts --quiet    (summary lines only)
//      npx tsx phase0/check-cases.ts --show-test (also details of the test set; not for the layout builder before the end gate)
// Agent B (independent case author). Reads only src/core and src/symbols/library.ts.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, netKind, type Circuit, type PinDef, type PinDefs } from "../src/core/model.js";
import { applyOps, type CircuitOp } from "../src/core/ops.js";
import { parseQuantity, quantityOf } from "../src/core/quantity.js";
import { classOf, resolveEndpoint, validate } from "../src/core/validate.js";
import { BUILTIN } from "../src/symbols/library.js";

export const PHASE0 = dirname(fileURLToPath(import.meta.url));
export const CASES = join(PHASE0, "cases");

const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Where a part's pin inventory came from. Only "builtin" and "inline" load in the engine today. */
export type PinSource = "inline" | "builtin" | "module-asset" | "proposed" | "missing";

const PROPOSED: Record<string, { pins: PinDef[] }> = readJson(join(PHASE0, "proposed-symbols.json")).types;

export interface LoadedCase {
  path: string;
  file: any;
  circuit: Circuit;
  pinDefs: PinDefs;
  pinSource: Record<string, PinSource>;
}

/** Pin inventory per part: inline pins, else built-in symbol, else embedded module asset, else the proposal. */
export function pinDefsFor(file: any): { pinDefs: PinDefs; pinSource: Record<string, PinSource> } {
  const pinDefs: PinDefs = {};
  const pinSource: Record<string, PinSource> = {};
  const assets = file.assets?.definitions ?? {};
  const strip = (pins: any[]): PinDef[] => pins.map(({ at: _a, dir: _d, ...rest }) => rest as PinDef);
  for (const part of file.circuit.parts) {
    const t = part.type as string;
    if (Array.isArray(part.pins)) { pinDefs[part.id] = strip(part.pins); pinSource[part.id] = "inline"; }
    else if (BUILTIN[t] && BUILTIN[t]!.kind !== "port") { pinDefs[part.id] = strip(BUILTIN[t]!.pins); pinSource[part.id] = "builtin"; }
    else if (assets[t]?.pins) { pinDefs[part.id] = strip(assets[t].pins); pinSource[part.id] = "module-asset"; }
    else if (PROPOSED[t]?.pins.length) { pinDefs[part.id] = strip(PROPOSED[t]!.pins); pinSource[part.id] = "proposed"; }
    else { pinDefs[part.id] = []; pinSource[part.id] = "missing"; }
  }
  return { pinDefs, pinSource };
}

export function loadCase(path: string): LoadedCase {
  const file = readJson(path);
  const { pinDefs, pinSource } = pinDefsFor(file);
  return { path, file, circuit: file.circuit, pinDefs, pinSource };
}

/** SPEC 9.3 warnings that src/core does not compute yet (supply pins, one-endpoint nets, values, polarity). */
export function warnings(c: Circuit, pinDefs: PinDefs): string[] {
  const out: string[] = [];
  const written = new Set<string>(); // canonical terminals and classes written in some net
  const netOfClass = new Map<string, string>();
  for (const n of c.nets) for (const e of n.endpoints) {
    const r = resolveEndpoint(e, pinDefs);
    if (!r.ok) continue;
    written.add(canonical(r.ep));
    netOfClass.set(classOf(r.ep, pinDefs), n.id);
  }
  const nc = new Set((c.nc ?? []).map((e) => { const r = resolveEndpoint(e, pinDefs); return r.ok ? canonical(r.ep) : e; }));
  for (const p of c.parts) for (const pin of pinDefs[p.id] ?? []) {
    if (pin.role !== "power_in" && pin.role !== "ground") continue;
    const t = `${p.id}[${pin.number}]`;
    const groupConnected = pin.group !== undefined && netOfClass.has(`${p.id}{${pin.group}}`);
    if (!written.has(t) && !groupConnected && !nc.has(t)) out.push(`W supply pin ${t} (${pin.name}, ${pin.role}) is in no net`);
  }
  for (const n of c.nets) if (n.endpoints.length === 1) out.push(`W410 net ${n.name ?? n.id} has one endpoint (${n.endpoints[0]})`);
  for (const p of c.parts) for (const [k, v] of Object.entries(p.props ?? {})) {
    const unit = quantityOf(p.type, k);
    if (!unit) continue;
    const r = parseQuantity(v, unit);
    if (!r.ok) out.push(`${r.code} ${p.id}.${k}: ${r.message}`);
  }
  for (const p of c.parts) {
    const two = (pinDefs[p.id] ?? []).filter((x) => x.chain);
    if (p.type !== "resistor" && p.type !== "capacitor" && two.length === 2) {
      const nets = two.map((x) => netOfClass.get(classOf({ kind: "terminal", part: p.id, number: x.number }, pinDefs)));
      if (nets[0] !== undefined && nets[0] === nets[1]) out.push(`W polarised part ${p.id} has both pins on net ${nets[0]}`);
    }
  }
  return out;
}

/** Check intent references (hint targets) resolve. */
export function intentProblems(file: any, pinDefs: PinDefs): string[] {
  const out: string[] = [];
  const parts = new Set(file.circuit.parts.map((p: any) => p.id));
  for (const h of file.intent?.hints ?? []) {
    if (!parts.has(h.part)) out.push(`hint ${h.id}: unknown part ${h.part}`);
    if (h.type === "decouples") {
      const r = resolveEndpoint(h.pin, pinDefs);
      if (!r.ok) out.push(`hint ${h.id}: ${r.issue.code} ${r.issue.message}`);
      else if (r.ep.kind === "terminal") {
        const role = pinDefs[r.ep.part]?.find((p) => p.number === (r.ep as any).number)?.role;
        if (role !== "power_in") out.push(`hint ${h.id}: ${h.pin} is not a power_in pin (role ${role})`);
        const capNets = file.circuit.nets.filter((n: any) => n.endpoints.some((e: string) => e.startsWith(`${h.part}[`)));
        const pinNet = file.circuit.nets.find((n: any) => n.endpoints.some((e: string) => { const q = resolveEndpoint(e, pinDefs); return q.ok && canonical(q.ep) === h.pin; }));
        if (!pinNet || !capNets.includes(pinNet)) out.push(`hint ${h.id}: ${h.part} is not on the net of ${h.pin}`);
        if (!capNets.some((n: any) => netKind(n) === "ground")) out.push(`hint ${h.id}: ${h.part} has no pin on a ground net`);
      }
    }
  }
  return out;
}

/** Module definitions embedded in assets must equal phase0/modules/<name>.json exactly. */
export function assetProblems(file: any): string[] {
  const out: string[] = [];
  for (const [id, def] of Object.entries<any>(file.assets?.definitions ?? {})) {
    const path = join(PHASE0, "modules", `${id.replace(/^module:/, "")}.json`);
    if (!existsSync(path)) { out.push(`asset ${id}: no phase0/modules file`); continue; }
    if (JSON.stringify(readJson(path)) !== JSON.stringify(def)) out.push(`asset ${id}: differs from ${relative(PHASE0, path)}`);
    const nums = new Set<string>(), aliases = new Set<string>();
    for (const p of def.pins) {
      if (nums.has(p.number)) out.push(`asset ${id}: duplicate pin number ${p.number}`);
      nums.add(p.number);
      for (const a of p.aliases ?? []) { if (aliases.has(a)) out.push(`asset ${id}: duplicate alias ${a}`); aliases.add(a); }
    }
  }
  for (const part of file.circuit.parts) if (String(part.type).startsWith("module:") && !file.assets?.definitions?.[part.type])
    out.push(`part ${part.id}: module ${part.type} has no definition in assets`);
  return out;
}

// ------------------------------------------------------------------ edit scripts

export type EditOp =
  | CircuitOp
  | { op: "setProp"; part: string; key: string; value: string }
  | { op: "setPinSides"; part: string; left?: string[]; right?: string[]; top?: string[]; bottom?: string[] }
  | { op: "removeHint"; id: string };

const partsOnNets = (c: Circuit, defs: PinDefs, netIds: Set<string>): Set<string> => {
  const s = new Set<string>();
  for (const n of c.nets) if (netIds.has(n.id)) for (const e of n.endpoints) { const r = resolveEndpoint(e, defs); if (r.ok) s.add(r.ep.part); }
  return s;
};
const netsOfPart = (c: Circuit, part: string): Set<string> =>
  new Set(c.nets.filter((n) => n.endpoints.some((e) => e.startsWith(part) && /^[[{.]/.test(e.slice(part.length)))).map((n) => n.id));

/**
 * Affected parts of a whole edit script, by the SPEC 9.5 table: setProp / setPinSides -> the part;
 * hints -> the parts named; addPart -> the new part and parts on the nets it joins (after the edit);
 * removePart -> parts on the nets it was on (before the edit). "Untouched" = every other part.
 */
export function affectedParts(before: Circuit, beforeDefs: PinDefs, after: Circuit, afterDefs: PinDefs, ops: EditOp[], hints: any[]): string[] {
  const s = new Set<string>();
  for (const op of ops) {
    if (op.op === "setProp" || op.op === "setPinSides") s.add(op.part);
    else if (op.op === "removeHint") {
      const h = hints.find((x) => x.id === op.id);
      if (h) { s.add(h.part); const r = resolveEndpoint(h.pin ?? "", beforeDefs); if (r.ok) s.add(r.ep.part); for (const x of [h.of, ...(h.parts ?? [])]) if (x) s.add(x); }
    } else if (op.op === "addPart") {
      s.add(op.part.id);
      for (const p of partsOnNets(after, afterDefs, netsOfPart(after, op.part.id))) s.add(p);
    } else if (op.op === "removePart") {
      for (const p of partsOnNets(before, beforeDefs, netsOfPart(before, op.part))) if (p !== op.part) s.add(p);
    } else if (op.op === "connect") {
      // A connect inside an addPart script touches the same nets; on its own it affects all parts on the nets involved.
      const ids = new Set<string>();
      for (const e of op.endpoints) { const r = resolveEndpoint(e, afterDefs); if (r.ok) for (const n of after.nets) if (n.endpoints.some((x) => { const q = resolveEndpoint(x, afterDefs); return q.ok && classOf(q.ep, afterDefs) === classOf(r.ep, afterDefs); })) ids.add(n.id); }
      for (const p of partsOnNets(after, afterDefs, ids)) s.add(p);
    }
  }
  const removed = new Set(ops.filter((o): o is { op: "removePart"; part: string } => o.op === "removePart").map((o) => o.part));
  return [...s].filter((p) => !removed.has(p)).sort(cmpStr);
}

export interface EditResult { ok: boolean; problems: string[]; notes: string[]; affected: string[]; after?: Circuit }

/** Apply an edit script to its case: circuit ops through src/core, setProp and visual ops by stand-ins here. */
export function runEdit(edit: any): EditResult {
  const problems: string[] = [], notes: string[] = [];
  const base = loadCase(join(CASES, edit.case));
  let c: Circuit = structuredClone(base.circuit);
  let defs: PinDefs = structuredClone(base.pinDefs);
  let hints: any[] = structuredClone(base.file.intent?.hints ?? []);
  const ops: EditOp[] = edit.ops;
  const libPins = (type: string): PinDef[] | undefined => {
    const fake = { circuit: { parts: [{ id: "_", type }] }, assets: base.file.assets };
    const r = pinDefsFor(fake);
    return r.pinSource["_"] === "missing" ? undefined : r.pinDefs["_"];
  };
  for (const op of ops) {
    try {
      if (op.op === "setProp") {
        const value = String(op.value);
        // Use src/core's setProp when it has one; otherwise set the property here.
        try { ({ circuit: c, pinDefs: defs } = applyOps(c, defs, [op as unknown as CircuitOp])); } catch { /* not supported */ }
        const p = c.parts.find((x) => x.id === op.part);
        if (!p) { problems.push(`setProp: unknown part ${op.part}`); continue; }
        if (p.props?.[op.key] === value) notes.push("setProp applied by src/core");
        else { p.props = { ...(p.props ?? {}), [op.key]: value }; notes.push("setProp is not in src/core/ops.ts; applied by this script's stand-in"); }
      } else if (op.op === "setPinSides") {
        if (!c.parts.some((x) => x.id === op.part)) problems.push(`setPinSides: unknown part ${op.part}`);
        const seen = new Set<string>();
        for (const side of ["left", "right", "top", "bottom"] as const) for (const e of op[side] ?? []) {
          const r = resolveEndpoint(e, defs);
          if (!r.ok) { problems.push(`setPinSides: ${r.issue.code} ${r.issue.message}`); continue; }
          if (r.ep.part !== op.part) problems.push(`setPinSides: ${e} is not a pin of ${op.part}`);
          const k = canonical(r.ep);
          if (seen.has(k)) problems.push(`setPinSides: ${k} listed twice`);
          seen.add(k);
        }
        notes.push("setPinSides is a visual operation (intent only); targets checked here");
      } else if (op.op === "removeHint") {
        if (!hints.some((h) => h.id === op.id)) problems.push(`removeHint: no hint ${op.id}`);
        hints = hints.filter((h) => h.id !== op.id);
      } else {
        const o = structuredClone(op) as CircuitOp;
        if (o.op === "addPart" && !o.pins) {
          const pins = libPins(o.part.type);
          if (pins) o.pins = pins; else problems.push(`addPart: no pin inventory for type ${o.part.type}`);
        }
        ({ circuit: c, pinDefs: defs } = applyOps(c, defs, [o]));
      }
    } catch (err: any) {
      problems.push(`${op.op}: ${err.message ?? err}`);
    }
  }
  // Hints must still point at existing parts (a removed part's hint must be removed in the same script).
  for (const h of hints) if (!c.parts.some((p) => p.id === h.part)) problems.push(`hint ${h.id} refers to removed part ${h.part}`);
  const v = validate(c, defs);
  for (const i of v.issues) problems.push(`${i.code} ${i.message}`);
  const affected = problems.length ? [] : affectedParts(base.circuit, base.pinDefs, c, defs, ops, base.file.intent?.hints ?? []);
  if (edit.expect?.affectedParts && JSON.stringify(edit.expect.affectedParts) !== JSON.stringify(affected))
    problems.push(`expect.affectedParts ${JSON.stringify(edit.expect.affectedParts)} != computed ${JSON.stringify(affected)}`);
  if (edit.edit === "longer-value") {
    const op = ops.find((o): o is Extract<EditOp, { op: "setProp" }> => o.op === "setProp")!;
    const old = base.circuit.parts.find((p) => p.id === op.part)?.props?.[op.key] ?? "";
    const len = (s: string) => [...s].length;
    const value = String(op.value);
    if (len(value) !== 3 * len(old)) problems.push(`longer-value: "${value}" has ${len(value)} characters, expected 3 x ${len(old)}`);
  }
  return { ok: problems.length === 0, problems, notes: [...new Set(notes)], affected, after: c };
}

// ------------------------------------------------------------------ manifest

export function manifestLines(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  };
  walk(CASES);
  return files
    .map((f) => relative(PHASE0, f).split("\\").join("/"))
    .sort(cmpStr)
    .map((rel) => `${createHash("sha256").update(readFileSync(join(PHASE0, rel))).digest("hex")}  ${rel}`);
}

// ------------------------------------------------------------------ main

function main() {
  const quiet = process.argv.includes("--quiet");
  const showTest = process.argv.includes("--show-test");
  const hidden = (rel: string) => rel.startsWith("test/") && !showTest;
  let failures = 0;
  const caseFiles = ["validation", "test"].flatMap((set) =>
    readdirSync(join(CASES, set)).filter((f) => f.endsWith(".json")).sort(cmpStr).map((f) => `${set}/${f}`));
  const missingTypes = new Map<string, Set<string>>();
  for (const rel of caseFiles) {
    const lc = loadCase(join(CASES, rel));
    const { issues } = validate(lc.circuit, lc.pinDefs);
    const problems = [...issues.map((i) => `${i.code} ${i.message}`), ...intentProblems(lc.file, lc.pinDefs), ...assetProblems(lc.file)];
    const pins = Object.values(lc.pinDefs).reduce((a, p) => a + p.length, 0);
    const notBuiltin = new Map<string, PinSource>();
    for (const part of lc.circuit.parts) {
      // `ic` is drawn by the generated box (icSymbol), so only other types can be missing.
      if (part.type !== "ic" && !(BUILTIN[part.type] && BUILTIN[part.type]!.kind !== "port")) notBuiltin.set(part.type, lc.pinSource[part.id]!);
    }
    for (const [t] of notBuiltin) { if (!missingTypes.has(t)) missingTypes.set(t, new Set()); missingTypes.get(t)!.add(rel.replace(/^.*\//, "").slice(0, 6)); }
    const warn = warnings(lc.circuit, lc.pinDefs);
    const status = problems.length ? "FAIL" : "loads OK";
    if (problems.length) failures++;
    console.log(`${rel.padEnd(42)} ${status.padEnd(8)} parts ${String(lc.circuit.parts.length).padStart(2)}  nets ${String(lc.circuit.nets.length).padStart(2)}  pins ${String(pins).padStart(3)}  hints ${(lc.file.intent?.hints ?? []).length}`);
    if (!quiet && hidden(rel)) { if (problems.length) console.log(`    ${problems.length} problem(s); details with --show-test`); }
    else if (!quiet) {
      for (const p of problems) console.log(`    error: ${p}`);
      if (notBuiltin.size) console.log(`    types not in src/symbols/library.ts: ${[...notBuiltin].map(([t, s]) => `${t} (${s})`).join(", ")}`);
      for (const w of warn) console.log(`    ${w}`);
    }
  }
  console.log("");
  const editFiles = readdirSync(join(CASES, "edits")).filter((f) => f.endsWith(".json")).sort(cmpStr);
  for (const f of editFiles) {
    const edit = readJson(join(CASES, "edits", f));
    const r = runEdit(edit);
    if (!r.ok) failures++;
    console.log(`edits/${f.padEnd(36)} ${r.ok ? "applies OK" : "FAIL"}  ops ${edit.ops.length}  affected ${r.affected.length}`);
    if (!quiet && hidden(edit.case)) { if (!r.ok) console.log(`    ${r.problems.length} problem(s); details with --show-test`); }
    else if (!quiet) {
      for (const p of r.problems) console.log(`    error: ${p}`);
      if (r.ok) console.log(`    affected parts: ${r.affected.join(" ")}`);
      for (const n of r.notes) console.log(`    note: ${n}`);
    }
  }
  console.log("");
  console.log("Symbol types the cases use that src/symbols/library.ts does not have (pin source, cases):");
  for (const [t, cs] of [...missingTypes].sort((a, b) => cmpStr(a[0], b[0]))) console.log(`  ${t.padEnd(32)} ${[...cs].sort(cmpStr).join(" ")}`);
  const manifest = join(PHASE0, "MANIFEST.sha256");
  if (existsSync(manifest)) {
    const want = readFileSync(manifest, "utf8").trim().split("\n");
    const have = manifestLines();
    const same = want.length === have.length && want.every((l, i) => l === have[i]);
    console.log(`\nMANIFEST.sha256: ${same ? `matches (${have.length} files)` : "DOES NOT MATCH"}`);
    if (!same) {
      failures++;
      const ws = new Set(want), hs = new Set(have);
      for (const l of want) if (!hs.has(l)) console.log(`    manifest only: ${l}`);
      for (const l of have) if (!ws.has(l)) console.log(`    on disk only:  ${l}`);
    }
  } else console.log("\nMANIFEST.sha256: not written yet");
  console.log(`\n${failures === 0 ? "ALL OK" : `${failures} FAILURE(S)`}`);
  process.exitCode = failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
