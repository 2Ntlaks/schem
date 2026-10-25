// Modules (SPEC 7.3): boards and breakouts with real pin numbers, names, aliases, groups, roles,
// interface roles, a controller flag and the documentation they come from. A module has no
// artwork: it is drawn as a generated box, like `ic`.
//
// Phase 1 ships only the modules the corpus uses. The JSON files here are byte-identical copies
// of phase0/modules/*.json (the frozen case author's definitions); a test checks that.

import { readFileSync } from "node:fs";
import type { Issue, PinDef, Role } from "../core/model.js";

export interface ModuleDoc {
  title?: string;
  url: string;
  revision: string;
  [key: string]: unknown;
}

/** Module definition shape (phase0 AUTHOR-NOTES item 4; recorded in docs/PHASE0B-NOTES.md). */
export interface ModuleDef {
  id: string;
  version: number;
  kind: "module";
  name: string;
  refPrefix: string;
  /** Microcontroller boards rank as flow sources (SPEC 9.2 step 2). */
  controller?: boolean;
  doc: ModuleDoc;
  pins: PinDef[];
}

const ROLES: ReadonlySet<Role> = new Set(["power_in", "power_out", "ground", "input", "output", "bidir", "passive", "nc"]);
/** Same token rules as endpoints (src/core/validate.ts): pin numbers and group names fit inside `[...]` / `{...}`. */
const TOKEN = /^[A-Za-z0-9_+\-]+$/;
const MODULE_ID = /^module:[a-z0-9][a-z0-9.\-]*$/;
const PIN_KEYS = new Set(["number", "name", "role", "aliases", "group", "iface", "chain"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

/** Library file names, in a fixed order (SPEC 9.6). */
const FILES = ["arduino-uno-r3.json", "esp32-devkitc-v4.json", "pololu-d24v10f5.json", "waveshare-lcd1602-i2c.json"];

/** The shipped module library, by module id (`module:esp32-devkitc-v4`). */
export const MODULE_LIBRARY: Readonly<Record<string, ModuleDef>> = Object.freeze(Object.fromEntries(
  FILES.map((f) => {
    const def = JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")) as ModuleDef;
    const issues = checkModuleDef(def, def.id);
    if (issues.length) throw new Error(`module library ${f}: ${issues.map((i) => `${i.code} ${i.message}`).join("; ")}`);
    return [def.id, def];
  }),
));

/** The library file a module id comes from (for tests and tooling). */
export function moduleFile(id: string): string | undefined {
  const f = `${id.replace(/^module:/, "")}.json`;
  return FILES.includes(f) ? f : undefined;
}

/**
 * Check a module definition (from the library or from a file's `assets.definitions[key]`).
 * Returns issues (empty = usable). Code E202 for every problem, each naming the module and pin.
 */
export function checkModuleDef(def: unknown, key: string): Issue[] {
  const out: Issue[] = [];
  const bad = (message: string) => out.push({ code: "E202", message: `module ${key}: ${message}`, at: key });
  if (!isObj(def)) { bad("definition is not an object."); return out; }
  if (!MODULE_ID.test(key)) bad(`id must look like "module:name" (lower case, digits, "-" and ".").`);
  if (def.id !== key) bad(`definition id "${String(def.id)}" does not match its key.`);
  if (def.kind !== "module") bad(`kind must be "module".`);
  if (!Number.isInteger(def.version) || (def.version as number) < 1) bad("version must be a positive integer.");
  if (typeof def.name !== "string" || !def.name) bad("name is missing.");
  if (typeof def.refPrefix !== "string" || !/^[A-Za-z]+$/.test(def.refPrefix)) bad("refPrefix must be letters.");
  if (def.controller !== undefined && typeof def.controller !== "boolean") bad("controller must be true or false.");
  if (!isObj(def.doc) || typeof def.doc.url !== "string" || typeof def.doc.revision !== "string")
    bad("doc must give the documentation url and revision the pins come from (SPEC 7.3).");
  out.push(...checkPinList(def.pins, `module ${key}`, "E202", true));
  return out;
}

/**
 * Check a pin inventory (a module definition's, or a part's own `pins`): numbers unique and
 * usable inside `[...]`, names present, roles known, aliases unique within the part (SPEC 6.2).
 * `roleRequired: false` lets inline pins leave the role to the SPEC 7.3 default.
 */
export function checkPinList(pins: unknown, owner: string, code: string, roleRequired: boolean): Issue[] {
  const out: Issue[] = [];
  const bad = (message: string) => out.push({ code, message: `${owner}: ${message}`, at: owner });
  if (!Array.isArray(pins) || pins.length === 0) { bad("pins must be a non-empty list."); return out; }
  const numbers = new Set<string>(), aliases = new Set<string>();
  pins.forEach((p: unknown, i: number) => {
    if (!isObj(p)) { bad(`pin ${i + 1} is not an object.`); return; }
    const at = typeof p.number === "string" ? `pin ${p.number}` : `pin ${i + 1}`;
    if (typeof p.number !== "string" || !TOKEN.test(p.number)) { bad(`${at}: number must use letters, digits, "_", "+" or "-".`); return; }
    if (numbers.has(p.number)) bad(`${at}: duplicate pin number.`);
    numbers.add(p.number);
    if (typeof p.name !== "string" || !p.name) bad(`${at}: name is missing.`);
    if ((roleRequired || p.role !== undefined) && (typeof p.role !== "string" || !ROLES.has(p.role as Role))) bad(`${at}: unknown role "${String(p.role)}".`);
    if (p.aliases !== undefined) {
      if (!isStrArray(p.aliases)) bad(`${at}: aliases must be a list of names.`);
      else for (const a of p.aliases) { if (aliases.has(a)) bad(`${at}: alias "${a}" is used twice (aliases are unique within a part).`); aliases.add(a); }
    }
    if (p.group !== undefined && (typeof p.group !== "string" || !TOKEN.test(p.group))) bad(`${at}: group must use letters, digits, "_", "+" or "-".`);
    if (p.iface !== undefined && !isStrArray(p.iface)) bad(`${at}: iface must be a list of interface roles.`);
    if (p.chain !== undefined && p.chain !== "in" && p.chain !== "out") bad(`${at}: chain must be "in" or "out".`);
    for (const k of Object.keys(p)) if (!PIN_KEYS.has(k)) bad(`${at}: unknown field "${k}".`);
  });
  return out;
}

/** The logical pin inventory of a module (a deep copy, safe to put on a part). */
export function modulePins(def: ModuleDef): PinDef[] {
  return structuredClone(def.pins);
}
