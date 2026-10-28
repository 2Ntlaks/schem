// Edit scripts (SPEC 11.3, 11.4 `schem edit <file> --ops ops.json`): read a script's `ops` array
// and apply it as one transaction through src/edit (edit()). The file shape is the one the frozen
// Phase 0b cases use: { schema?, case?, edit?, description?, ops: [...], expect?: { ok, affectedParts } }.
// A bare array of operations is accepted too.

import { readFileSync } from "node:fs";
import { cmpStr } from "../geom/geom.js";
import type { Issue } from "../core/model.js";
import { checkHints } from "../core/intent.js";
import { edit, revision, type EditOp, type EditResult } from "../edit/edit.js";
import { stabilityBreaks, type ChangeReport } from "../edit/report.js";
import type { LayoutState } from "../core/intent.js";
import { MODULE_LIBRARY, checkModuleDef, modulePins, type ModuleDef } from "../modules/index.js";
import { projectPinDefs, type LoadedProject } from "./project.js";

export interface EditScript {
  schema?: string;
  /** The case file the script applies to, relative to phase0/cases/. */
  case?: string;
  edit?: string;
  description?: string;
  ops: EditOp[];
  /** SPEC 11.4 optimistic-concurrency tokens (rev C.3 `ops.json`). */
  expectedRevision?: string;
  expectedLayout?: string;
  /** Phase 0b scripts only: the expected outcome. `affectedParts` follows the rev C.2 table. */
  expect?: { ok?: boolean | "either"; affectedParts?: string[] };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isSides = (o: Obj) => ["left", "right", "top", "bottom"].every((s) => o[s] === undefined || isStrArray(o[s]));

/** Required fields of every operation edit() supports, checked before anything runs. */
const OPS: Record<string, (o: Obj) => boolean> = {
  connect: (o) => isStrArray(o.endpoints) && o.endpoints.length > 0 && (o.name === undefined || isStr(o.name)),
  disconnect: (o) => isStr(o.endpoint),
  mergeNets: (o) => isStrArray(o.nets) && isStr(o.keep),
  renameNet: (o) => isStr(o.net) && isStr(o.name),
  setNoConnect: (o) => isStr(o.terminal) && typeof o.nc === "boolean",
  renamePart: (o) => isStr(o.from) && isStr(o.to),
  removePart: (o) => isStr(o.part),
  addPart: (o) => isObj(o.part) && isStr(o.part.id) && isStr(o.part.type),
  setProp: (o) => isStr(o.part) && isStr(o.key) && (isStr(o.value) || o.value === null),
  lock: (o) => isStr(o.part),
  unlock: (o) => isStr(o.part),
  setOrientation: (o) => isStr(o.part) && [0, 90, 180, 270].includes(o.rot as number),
  setPinSides: (o) => isStr(o.part) && isSides(o),
  setLabelSide: (o) => isStr(o.part) && ["above", "below", "left", "right"].includes(o.side as string),
  setSpacing: (o) => typeof o.factor === "number",
  place: (o) => isStr(o.part) && isStr(o.of) && ["right-of", "left-of", "above", "below"].includes(o.rel as string),
  align: (o) => (o.axis === "row" || o.axis === "column") && isStrArray(o.parts),
  removeHint: (o) => isStr(o.id),
  relayout: (o) => o.mode === "incremental" || o.mode === "canonical",
};
/** SPEC 11.3 operations the engine does not have yet. */
const NOT_YET = new Set(["setHint", "clearOverride", "setNetStyle"]);

/** Parse an edit script (file text, parsed JSON, or a bare ops array). */
export function parseEditScript(input: string | unknown): { ok: true; script: EditScript } | { ok: false; issues: Issue[] } {
  let doc: unknown = input;
  if (isStr(input)) {
    try { doc = JSON.parse(input); } catch (e) { return { ok: false, issues: [{ code: "E100", message: `the edit script is not JSON: ${(e as Error).message}` }] }; }
  }
  if (Array.isArray(doc)) doc = { ops: doc };
  if (!isObj(doc) || !Array.isArray(doc.ops)) return { ok: false, issues: [{ code: "E102", message: "an edit script is { ops: [...] } or a list of operations." }] };
  const issues: Issue[] = [];
  doc.ops.forEach((o, i) => {
    const name = isObj(o) ? o.op : undefined;
    if (!isObj(o) || !isStr(name)) issues.push({ code: "E102", message: `op ${i + 1}: an operation is an object with "op".` });
    else if (NOT_YET.has(name)) issues.push({ code: "E108", message: `op ${i + 1}: "${name}" is not supported yet.` });
    else if (!OPS[name]) issues.push({ code: "E102", message: `op ${i + 1}: unknown operation "${name}". Known: ${Object.keys(OPS).join(", ")}.` });
    else if (!OPS[name]!(o)) issues.push({ code: "E102", message: `op ${i + 1} (${name}): missing or wrong fields (SPEC 11.3).` });
  });
  const ex = doc.expect;
  if (ex !== undefined && (!isObj(ex) || (ex.ok !== undefined && typeof ex.ok !== "boolean" && ex.ok !== "either") || (ex.affectedParts !== undefined && !isStrArray(ex.affectedParts))))
    issues.push({ code: "E102", message: `expect is { ok: true | false | "either", affectedParts: [...] }.` });
  if (issues.length) return { ok: false, issues };
  const script: EditScript = { ops: structuredClone(doc.ops) as EditOp[] };
  for (const k of ["schema", "case", "edit", "description", "expectedRevision", "expectedLayout"] as const) if (isStr(doc[k])) script[k] = doc[k] as string;
  if (isObj(ex)) script.expect = structuredClone(ex) as EditScript["expect"];
  return { ok: true, script };
}

export function readEditScript(path: string): ReturnType<typeof parseEditScript> {
  return parseEditScript(readFileSync(path, "utf8"));
}

export interface ScriptRun {
  result: EditResult;
  /** The edited project, when the edit was saved. */
  project?: LoadedProject;
  /** Whether saved / rejected matches `expect.ok` (true when the script expects nothing). */
  asExpected: boolean;
  /**
   * The frozen `expect.affectedParts` (rev C.2 table) next to the affected parts the edit computed by
   * the rev C.3 rule (port-drawn nets do not spread), which gate 4 uses. Both are reported; a
   * difference is information, not a failure.
   */
  affected: { expected?: string[]; actual: string[]; match?: boolean };
  /** Hints removed with a removed part (SPEC 11.3, rev C.3), as edit() lists them. */
  removedHints: string[];
  /** SPEC 15 gate 4 on the change report (incremental edits only). */
  stability?: { report: ChangeReport; breaks: string[] };
}

/**
 * Apply an edit script to a loaded project as one transaction (SPEC 11.3). `previous` is the
 * layout the project was last drawn with; without it the edit lays out canonically.
 */
export function applyEditScript(project: LoadedProject, script: EditScript, previous?: LayoutState): ScriptRun {
  const refuse = (issues: string[]): ScriptRun => ({
    result: { saved: false, status: "invalid_input", project, affected: { parts: [], nets: [] }, issues, revision: revision(project) },
    asExpected: script.expect?.ok === false || script.expect?.ok === "either" || script.expect?.ok === undefined,
    affected: { ...(script.expect?.affectedParts ? { expected: script.expect.affectedParts } : {}), actual: [] },
    removedHints: [],
  });
  if (project.unknownFields.length) return refuse([`E105 edits are refused: the file uses fields this engine does not know (${project.unknownFields.join(", ")}) (SPEC 6.6).`]);

  // A module added by the script gets its pins (and controller flag) from the file's assets or the library.
  const definitions = { ...project.assets.definitions };
  const ops: EditOp[] = [];
  for (const op of script.ops) {
    if (op.op === "addPart" && op.part.type.startsWith("module:") && !op.pins) {
      const def = (definitions[op.part.type] ?? MODULE_LIBRARY[op.part.type]) as ModuleDef | undefined;
      if (!def) return refuse([`E202 addPart ${op.part.id}: unknown module "${op.part.type}".`]);
      const bad = checkModuleDef(def, op.part.type);
      if (bad.length) return refuse(bad.map((i) => `${i.code} ${i.message}`));
      definitions[op.part.type] = definitions[op.part.type] ?? structuredClone(def);
      const props = def.controller && op.part.props?.controller === undefined ? { ...(op.part.props ?? {}), controller: "true" } : op.part.props;
      ops.push({ ...op, part: { ...op.part, title: def.name, ...(props ? { props } : {}) }, pins: modulePins(def) });
    } else ops.push(op);
  }

  const result = edit({
    project, ops, ...(previous ? { previous } : {}),
    ...(script.expectedRevision ? { expectedRevision: script.expectedRevision } : {}), ...(script.expectedLayout ? { expectedLayout: script.expectedLayout } : {}),
  });
  const expected = script.expect?.affectedParts;
  const actual = [...result.affected.parts].sort(cmpStr);
  const compared = result.saved || actual.length > 0; // a transaction refused before layout computes no affected parts
  const affected = { ...(expected ? { expected, ...(compared ? { match: JSON.stringify([...expected].sort(cmpStr)) === JSON.stringify(actual) } : {}) } : {}), actual };
  let edited: LoadedProject | undefined;
  if (result.saved) {
    const p = result.project as LoadedProject;
    const { layoutCache: _stale, ...rest } = p;
    edited = { ...rest, assets: { ...project.assets, definitions } };
    // Hints must still make sense after the edit (a decouples hint whose capacitor became a resistor, ...).
    const h = checkHints(edited.intent.hints ?? [], edited.circuit, projectPinDefs(edited));
    if (h.errors.length) {
      const r = refuse(h.errors.map((i) => `${i.code} ${i.message}`));
      return { ...r, affected };
    }
  }
  const ok = script.expect?.ok;
  return {
    result,
    ...(edited ? { project: edited } : {}),
    asExpected: ok === undefined || ok === "either" || ok === result.saved,
    affected,
    removedHints: result.removedHints ?? [],
    ...(result.report ? { stability: { report: result.report, breaks: stabilityBreaks(result.report) } } : {}),
  };
}
