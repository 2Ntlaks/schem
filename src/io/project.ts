// Project files (SPEC 6.5, 6.6): read the `*.schem.json` shape and the Phase 0a shape
// (`meta` + `circuit`, endpoints by name) into the engine's Project, and write the canonical
// SPEC 6.5 form back.
//
// In memory, a `module:*` part is expanded into an inline-pin part (like `ic`): its `pins` come
// from the module definition (the file's `assets.definitions`, else the shipped library), and a
// controller module gets `props.controller: "true"` unless the part sets it. Saving undoes both,
// so the file keeps the part as written. `ext` is kept byte for byte and never interpreted.

import { readFileSync } from "node:fs";
import { cmpNatural } from "../geom/geom.js";
import { canonical, type Circuit, type Issue, type Net, type Part, type PinDef, type PinDefs, type Role } from "../core/model.js";
import { resolveEndpoint, validate } from "../core/validate.js";
import { checkHints, HINT_TYPES, type Hint, type HintPriority, type Intent, type Lock, type NetStyle } from "../core/intent.js";
import { pinDefsOf, type Project } from "../layout/layout.js";
import { BUILTIN } from "../symbols/library.js";
import { checkModuleDef, checkPinList, MODULE_LIBRARY, modulePins, type ModuleDef } from "../modules/index.js";

/** The schema this engine writes. Readers accept any 1.x and refuse a newer major (SPEC 6.6). */
export const SCHEMA = "schem/1.0";
/** `assets.library` written for files that do not name one. */
export const LIBRARY = "schem-symbols@0.0.1";

export interface Meta { title?: string; created?: string; nextNetId?: number; nextHintId?: number }

export interface Assets {
  library?: string;
  /** Module definitions (`module:*`, interpreted) and symbol definitions (kept as read). */
  definitions: Record<string, unknown>;
}

export interface LoadedProject extends Project {
  schema: string;
  /** Which shape the file had: the SPEC 6.5 project file, or the Phase 0a `meta` + `circuit` shape. */
  shape: "schem" | "phase0a";
  meta: Meta;
  /** The engine's circuit: module parts carry their pins (see the file header). */
  circuit: Circuit;
  intent: Intent;
  assets: Assets;
  /** Inert metadata, preserved and never interpreted (SPEC 6.6). */
  ext: Record<string, unknown>;
  /** SPEC 6.5 `layout`, kept as read. It is a cache; edits drop it. */
  layoutCache?: unknown;
  /** Fields outside `ext` this version does not know (SPEC 6.6): the file renders, edits are refused. */
  unknownFields: string[];
}

export interface LoadResult {
  ok: boolean;
  project?: LoadedProject;
  /** Pin inventory per part, as the loader resolved it. */
  pinDefs?: PinDefs;
  errors: Issue[];
  warnings: Issue[];
  /** Part types that are neither a symbol, `ic`, a module, nor a part with its own pins (sorted). */
  missingTypes: string[];
}

export interface LoadOptions {
  /** Module library to fall back on (default: the shipped library). */
  modules?: Readonly<Record<string, ModuleDef>>;
}

const TOP = new Set(["schema", "meta", "circuit", "intent", "assets", "layout", "ext"]);
const META = new Set(["title", "created", "nextNetId", "nextHintId"]);
const CIRCUIT = new Set(["parts", "nets", "nc"]);
const PART = new Set(["id", "type", "props", "pins"]);
const NET = new Set(["id", "name", "kind", "domain", "endpoints"]);
const INTENT = new Set(["hints", "locks", "overrides", "style", "spacing"]);
const OVERRIDES = new Set(["labelSide", "netStyle"]);
const ASSETS = new Set(["library", "definitions"]);
const LOCK = new Set(["part", "x", "y", "rot", "flip"]);
const HINT_KEYS: Record<Hint["type"], string[]> = {
  relative: ["part", "rel", "of"],
  align: ["axis", "parts"],
  orient: ["part", "rot", "flip"],
  pinSides: ["part", "sides"],
  decouples: ["part", "pin"],
};
const PART_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const NET_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const SIDES = ["left", "right", "top", "bottom"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** SPEC 7.3 default role for an inline pin written without one (same rule as the layout's). */
export function defaultRole(name: string): Role {
  if (/^(GND|VSS|AGND|DGND)$/i.test(name)) return "ground";
  if (/^(VCC|VDD|VIN|3V3|5V|V\+|VBAT)$/i.test(name)) return "power_in";
  return "bidir";
}

const stripPin = ({ at: _a, dir: _d, ...rest }: PinDef & { at?: unknown; dir?: unknown }): PinDef => rest;

/** Read a project file from disk. */
export function readProject(path: string, opts: LoadOptions = {}): LoadResult {
  return loadProject(readFileSync(path, "utf8"), opts);
}

/** Load a project from JSON text or an already parsed object. Never throws on bad input. */
export function loadProject(input: string | unknown, opts: LoadOptions = {}): LoadResult {
  const errors: Issue[] = [], warnings: Issue[] = [], unknownFields: string[] = [];
  const fail = (code: string, message: string, at?: string): LoadResult => ({ ok: false, errors: [...errors, { code, message, ...(at ? { at } : {}) }], warnings, missingTypes: [] });
  const err = (code: string, message: string, at?: string) => errors.push({ code, message, ...(at ? { at } : {}) });
  const unknown = (where: string, o: Obj, known: ReadonlySet<string>) => { for (const k of Object.keys(o)) if (!known.has(k)) unknownFields.push(`${where}${where ? "." : ""}${k}`); };

  let doc: unknown = input;
  if (isStr(input)) {
    try { doc = JSON.parse(input); } catch (e) { return fail("E100", `the file is not JSON: ${(e as Error).message}`); }
  }
  if (!isObj(doc)) return fail("E102", "a project file is a JSON object.");
  unknown("", doc, TOP);

  // Schema and shape (SPEC 6.6).
  let shape: LoadedProject["shape"] = "phase0a";
  let schema = SCHEMA;
  if (doc.schema !== undefined) {
    const m = isStr(doc.schema) ? /^schem\/(\d+)\.(\d+)$/.exec(doc.schema) : null;
    if (!m) return fail("E101", `schema "${String(doc.schema)}" is not of the form "schem/MAJOR.MINOR".`);
    if (Number(m[1]) > 1) return fail("E101", `schema ${doc.schema} is newer than this engine (it reads schem/1.x). Update schem to open it.`);
    if (Number(m[1]) < 1) return fail("E101", `schema ${doc.schema} is not supported (this engine reads schem/1.x).`);
    shape = "schem";
    schema = doc.schema as string;
  }

  // meta
  const meta: Meta = {};
  if (doc.meta !== undefined) {
    if (!isObj(doc.meta)) return fail("E102", "meta must be an object.", "meta");
    unknown("meta", doc.meta, META);
    for (const k of ["title", "created"] as const) if (doc.meta[k] !== undefined) { if (isStr(doc.meta[k])) meta[k] = doc.meta[k] as string; else err("E102", `meta.${k} must be a string.`, `meta.${k}`); }
    for (const k of ["nextNetId", "nextHintId"] as const) if (doc.meta[k] !== undefined) { const v = doc.meta[k]; if (Number.isInteger(v) && (v as number) >= 1) meta[k] = v as number; else err("E102", `meta.${k} must be a positive integer.`, `meta.${k}`); }
  }

  // assets: module definitions are checked; other definitions are kept as read.
  const assets: Assets = { definitions: {} };
  if (doc.assets !== undefined) {
    if (!isObj(doc.assets)) return fail("E102", "assets must be an object.", "assets");
    unknown("assets", doc.assets, ASSETS);
    if (doc.assets.library !== undefined) { if (isStr(doc.assets.library)) assets.library = doc.assets.library; else err("E102", "assets.library must be a string.", "assets.library"); }
    if (doc.assets.definitions !== undefined) {
      if (!isObj(doc.assets.definitions)) return fail("E102", "assets.definitions must be an object.", "assets.definitions");
      for (const [k, d] of Object.entries(doc.assets.definitions)) {
        if (k.startsWith("module:")) errors.push(...checkModuleDef(d, k));
        assets.definitions[k] = structuredClone(d);
      }
    }
  }

  // circuit
  const c = doc.circuit;
  if (!isObj(c)) return fail("E102", "the file has no circuit object.", "circuit");
  unknown("circuit", c, CIRCUIT);
  if (!Array.isArray(c.parts)) return fail("E102", "circuit.parts must be a list.", "circuit.parts");
  if (!Array.isArray(c.nets)) return fail("E102", "circuit.nets must be a list.", "circuit.nets");
  if (c.nc !== undefined && !isStrArray(c.nc)) return fail("E102", "circuit.nc must be a list of terminals.", "circuit.nc");

  const library = opts.modules ?? MODULE_LIBRARY;
  const parts: Part[] = [];
  const pinDefs: PinDefs = {};
  const missing = new Set<string>();
  for (const [i, raw] of c.parts.entries()) {
    if (!isObj(raw)) { err("E102", `part ${i + 1} is not an object.`); continue; }
    const id = raw.id, type = raw.type;
    if (!isStr(id) || !PART_ID.test(id)) { err("E102", `part ${i + 1}: id ${JSON.stringify(id)} must match ^[A-Za-z][A-Za-z0-9_]*$.`); continue; }
    if (!isStr(type) || !type) { err("E102", `part ${id}: type is missing.`, id); continue; }
    unknown(`circuit.parts[${id}]`, raw, PART);
    const part: Part = { id, type };
    if (raw.props !== undefined) {
      if (!isObj(raw.props) || !Object.values(raw.props).every(isStr)) { err("E102", `part ${id}: props must map names to strings (values are kept as written, SPEC 6.7).`, id); continue; }
      part.props = { ...(raw.props as Record<string, string>) };
    }
    if (raw.pins !== undefined) {
      const issues = checkPinList(raw.pins, `part ${id}`, "E203", false);
      if (issues.length) { errors.push(...issues); continue; }
      if (BUILTIN[type]) { err("E203", `part ${id}: "${type}" is a fixed symbol and has its own pins; remove "pins".`, id); continue; }
      if (type.startsWith("module:")) { err("E203", `part ${id}: a module part takes its pins from the module definition; remove "pins".`, id); continue; }
      part.pins = structuredClone(raw.pins as PinDef[]);
    }
    // Resolve the pin inventory: symbol, module, or the part's own pins (ic, header, custom).
    if (BUILTIN[type]) pinDefs[id] = BUILTIN[type]!.pins.map(stripPin);
    else if (type.startsWith("module:")) {
      let def = assets.definitions[type] as ModuleDef | undefined;
      if (def === undefined && library[type]) { def = structuredClone(library[type]!); assets.definitions[type] = def; }
      if (def === undefined) { err("E202", `part ${id}: unknown module "${type}". Known modules: ${Object.keys(library).sort(cmpNatural).join(", ")}.`, id); continue; }
      if (checkModuleDef(def, type).length) continue; // already reported
      part.pins = modulePins(def);
      if (def.controller && part.props?.controller === undefined) part.props = { ...(part.props ?? {}), controller: "true" };
      pinDefs[id] = modulePins(def);
    } else if (part.pins) pinDefs[id] = ownPins(part);
    else if (type === "ic") { err("E203", `part ${id}: an ic needs its pins (SPEC 7.3).`, id); continue; }
    else { missing.add(type); err("E201", `unknown part type "${type}" (${id}).`, id); }
    parts.push(part);
  }

  const nets: Net[] = [];
  for (const [i, raw] of c.nets.entries()) {
    if (!isObj(raw)) { err("E102", `net ${i + 1} is not an object.`); continue; }
    if (!isStr(raw.id) || !NET_ID.test(raw.id)) { err("E102", `net ${i + 1}: id ${JSON.stringify(raw.id)} is not a net id.`); continue; }
    unknown(`circuit.nets[${raw.id}]`, raw, NET);
    if (!isStrArray(raw.endpoints)) { err("E102", `net ${raw.id}: endpoints must be a list of strings.`, raw.id); continue; }
    const net: Net = { id: raw.id, endpoints: [...raw.endpoints] };
    if (raw.name !== undefined) { if (isStr(raw.name) && raw.name) net.name = raw.name; else err("E102", `net ${raw.id}: name must be a non-empty string.`, raw.id); }
    if (raw.kind !== undefined) { if (raw.kind === "signal" || raw.kind === "power" || raw.kind === "ground") net.kind = raw.kind; else err("E102", `net ${raw.id}: kind must be signal, power or ground.`, raw.id); }
    if (raw.domain !== undefined) { if (raw.domain === null || isStr(raw.domain)) net.domain = raw.domain; else err("E102", `net ${raw.id}: domain must be a string.`, raw.id); }
    nets.push(net);
  }
  if (new Set(nets.map((n) => n.id)).size !== nets.length) err("E102", "two nets have the same id.");
  const circuit: Circuit = { parts, nets, ...(c.nc !== undefined ? { nc: [...(c.nc as string[])] } : {}) };

  // Circuit invariants (SPEC 6.3), only when every part's pins are known (else every endpoint of an
  // unknown part would be reported again).
  if (!errors.length) errors.push(...validate(circuit, pinDefs).issues);

  // intent
  const intent: Intent = {};
  if (doc.intent !== undefined) {
    if (!isObj(doc.intent)) return fail("E102", "intent must be an object.", "intent");
    const it = doc.intent;
    unknown("intent", it, INTENT);
    if (it.hints !== undefined) {
      if (!Array.isArray(it.hints)) err("E102", "intent.hints must be a list.", "intent.hints");
      else intent.hints = it.hints.flatMap((h, i) => { const r = parseHint(h, i, unknownFields); if ("error" in r) { errors.push(r.error); return []; } return [r.hint]; });
    }
    if (it.locks !== undefined) {
      if (!Array.isArray(it.locks)) err("E102", "intent.locks must be a list.", "intent.locks");
      else intent.locks = it.locks.flatMap((l, i): Lock[] => {
        if (!isObj(l) || !isStr(l.part) || !Number.isInteger(l.x) || !Number.isInteger(l.y) || ![0, 90, 180, 270].includes(l.rot as number) || typeof (l.flip ?? false) !== "boolean") {
          err("E102", `lock ${i + 1} must be { part, x, y, rot, flip } with integer grid x, y and rot 0, 90, 180 or 270.`, "intent.locks"); return [];
        }
        unknown(`intent.locks[${l.part}]`, l, LOCK);
        if (!parts.some((p) => p.id === l.part)) err("E251", `lock: unknown part "${l.part}".`, l.part);
        return [{ part: l.part, x: l.x as number, y: l.y as number, rot: l.rot as Lock["rot"], flip: (l.flip ?? false) as boolean }];
      });
    }
    if (it.overrides !== undefined) {
      if (!isObj(it.overrides)) err("E102", "intent.overrides must be an object.", "intent.overrides");
      else {
        unknown("intent.overrides", it.overrides, OVERRIDES);
        const o: NonNullable<Intent["overrides"]> = {};
        const ls = it.overrides.labelSide;
        if (ls !== undefined) {
          if (!isObj(ls) || !Object.values(ls).every((s) => s === "above" || s === "below" || s === "left" || s === "right")) err("E102", "overrides.labelSide maps part ids to above, below, left or right.", "intent.overrides.labelSide");
          else o.labelSide = { ...(ls as Record<string, "above">) };
        }
        const ns = it.overrides.netStyle;
        if (ns !== undefined) {
          if (!Array.isArray(ns) || !ns.every((x) => isObj(x) && isStr(x.net) && (x.style === "wire" || x.style === "port" || x.style === "label") && (x.endpoint === undefined || isStr(x.endpoint)))) err("E102", "overrides.netStyle is a list of { net, endpoint?, style: wire | port | label }.", "intent.overrides.netStyle");
          else o.netStyle = structuredClone(ns as NetStyle[]);
        }
        intent.overrides = o;
      }
    }
    if (it.style !== undefined) {
      if (!isObj(it.style)) err("E102", "intent.style must be an object.", "intent.style");
      else intent.style = structuredClone(it.style) as Intent["style"];
    }
    if (it.spacing !== undefined) {
      if (typeof it.spacing === "number" && it.spacing >= 1 && it.spacing <= 4) intent.spacing = it.spacing; else err("E102", "intent.spacing must be a number from 1 to 4.", "intent.spacing");
    }
  }
  if (!errors.length && intent.hints) {
    const h = checkHints(intent.hints, circuit, pinDefs);
    errors.push(...h.errors);
    warnings.push(...h.warnings);
  }

  // ext: inert, kept exactly.
  let ext: Record<string, unknown> = {};
  if (doc.ext !== undefined) {
    if (!isObj(doc.ext)) return fail("E102", "ext must be an object.", "ext");
    ext = structuredClone(doc.ext);
  }

  const missingTypes = [...missing].sort(cmpNatural);
  if (errors.length) return { ok: false, errors, warnings, missingTypes };
  const project: LoadedProject = {
    schema, shape, meta, circuit, intent, assets, ext, unknownFields,
    ...(doc.layout !== undefined ? { layoutCache: structuredClone(doc.layout) } : {}),
  };
  if (unknownFields.length) warnings.push({ code: "W105", message: `the file uses fields this engine does not know (${unknownFields.join(", ")}). It can be drawn, but edits are refused (SPEC 6.6).` });
  return { ok: true, project, pinDefs, errors, warnings, missingTypes };
}

function parseHint(h: unknown, i: number, unknownFields: string[]): { hint: Hint } | { error: Issue } {
  const bad = (message: string): { error: Issue } => ({ error: { code: "E260", message: `hint ${i + 1}: ${message}`, at: "intent.hints" } });
  if (!isObj(h)) return bad("not an object.");
  if (!isStr(h.id) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(h.id)) return bad("id is missing.");
  const type = h.type as Hint["type"];
  if (!HINT_TYPES.includes(type)) return bad(`type "${String(h.type)}" is not supported (supported: ${HINT_TYPES.join(", ")}).`);
  const priority = (h.priority ?? "normal") as HintPriority;
  if (priority !== "strict" && priority !== "high" && priority !== "normal") return bad(`priority must be strict, high or normal.`);
  for (const k of Object.keys(h)) if (k !== "id" && k !== "type" && k !== "priority" && !HINT_KEYS[type].includes(k)) unknownFields.push(`intent.hints[${h.id}].${k}`);
  const id = h.id;
  switch (type) {
    case "relative":
      if (!isStr(h.part) || !isStr(h.of) || !["right-of", "left-of", "above", "below"].includes(h.rel as string)) return bad("relative needs part, rel (right-of, left-of, above, below) and of.");
      return { hint: { id, type, part: h.part, rel: h.rel as "above", of: h.of, priority } };
    case "align":
      if ((h.axis !== "row" && h.axis !== "column") || !isStrArray(h.parts) || h.parts.length < 2) return bad("align needs axis (row or column) and at least two parts.");
      return { hint: { id, type, axis: h.axis, parts: [...h.parts], priority } };
    case "orient":
      if (!isStr(h.part) || ![0, 90, 180, 270].includes(h.rot as number) || (h.flip !== undefined && typeof h.flip !== "boolean")) return bad("orient needs part, rot (0, 90, 180, 270) and flip.");
      return { hint: { id, type, part: h.part, rot: h.rot as 0, flip: (h.flip ?? false) as boolean, priority } };
    case "pinSides": {
      if (!isStr(h.part) || !isObj(h.sides) || !Object.entries(h.sides).every(([k, v]) => (SIDES as readonly string[]).includes(k) && isStrArray(v))) return bad("pinSides needs part and sides { left?, right?, top?, bottom? } of pin numbers.");
      return { hint: { id, type, part: h.part, sides: structuredClone(h.sides as Record<string, string[]>), priority } };
    }
    case "decouples":
      if (!isStr(h.part) || !isStr(h.pin)) return bad("decouples needs part (the capacitor) and pin (the pin it decouples, e.g. U1[7]).");
      return { hint: { id, type, part: h.part, pin: h.pin, priority } };
  }
}

// ---------------------------------------------------------------------------
// Saving (SPEC 6.5 canonical serialisation): UTF-8, LF, 2-space indent, fixed key order,
// endpoints canonical and sorted in natural order. Props, pins, definitions and ext keep
// their own key order.

/** The pin inventory the engine uses for a loaded project's circuit. */
export function projectPinDefs(p: LoadedProject): PinDefs {
  const defs: PinDefs = {};
  for (const part of p.circuit.parts) defs[part.id] = BUILTIN[part.type] ? BUILTIN[part.type]!.pins.map(stripPin) : ownPins(part);
  return defs;
}

/**
 * Pins of a part that declares its own (ic, header, module after expansion, custom): the layout's
 * reading where it knows the type (a header pin without a role is passive), else the SPEC 7.3 defaults.
 */
function ownPins(part: Part): PinDef[] {
  return pinDefsOf({ parts: [part], nets: [] })[part.id] ?? (part.pins ?? []).map((x) => (x.role ? { ...x } : { ...x, role: defaultRole(x.name) }));
}

/** The SPEC 6.5 document for a project, as a plain object in canonical key order. */
export function projectDocument(p: LoadedProject): Record<string, unknown> {
  const defs = projectPinDefs(p);
  const canon = (e: string) => { const r = resolveEndpoint(e, defs); return r.ok ? canonical(r.ep) : e; };
  const sortEps = (eps: string[]) => [...new Set(eps.map(canon))].sort(cmpNatural);
  const used = new Set(p.circuit.parts.map((x) => x.type));

  const parts = p.circuit.parts.map((part) => {
    const out: Record<string, unknown> = { id: part.id, type: part.type };
    let props = part.props;
    if (part.type.startsWith("module:")) {
      const def = p.assets.definitions[part.type] as ModuleDef | undefined;
      if (def?.controller && props?.controller === "true") { const { controller: _c, ...rest } = props; props = rest; }
      if (props) out.props = props;
      if (props && !Object.keys(props).length) delete out.props;
    } else {
      if (props) out.props = props;
      if (part.pins) out.pins = part.pins;
    }
    return out;
  });
  const nets = p.circuit.nets.map((n) => {
    const out: Record<string, unknown> = { id: n.id };
    if (n.name !== undefined) out.name = n.name;
    if (n.kind !== undefined) out.kind = n.kind;
    if (n.domain !== undefined) out.domain = n.domain;
    out.endpoints = sortEps(n.endpoints);
    return out;
  });
  const maxId = (ids: string[], prefix: string) => Math.max(0, ...ids.map((id) => Number(new RegExp(`^${prefix}(\\d+)$`).exec(id)?.[1] ?? 0)));
  const meta: Record<string, unknown> = {};
  if (p.meta.title !== undefined) meta.title = p.meta.title;
  if (p.meta.created !== undefined) meta.created = p.meta.created;
  meta.nextNetId = Math.max(p.meta.nextNetId ?? 1, maxId(p.circuit.nets.map((n) => n.id), "n") + 1);
  meta.nextHintId = Math.max(p.meta.nextHintId ?? 1, maxId((p.intent.hints ?? []).map((h) => h.id), "h") + 1);

  const hints = (p.intent.hints ?? []).map((h) => {
    const out: Record<string, unknown> = { id: h.id, type: h.type };
    for (const k of HINT_KEYS[h.type]) out[k] = k === "pin" ? canon((h as { pin: string }).pin) : (h as unknown as Record<string, unknown>)[k];
    out.priority = h.priority;
    return out;
  });
  const intent: Record<string, unknown> = {
    hints,
    locks: (p.intent.locks ?? []).map((l) => ({ part: l.part, x: l.x, y: l.y, rot: l.rot, flip: l.flip })),
    overrides: p.intent.overrides ?? {},
    style: p.intent.style ?? { theme: "clean", symbols: "ieee" },
  };
  if (p.intent.spacing !== undefined) intent.spacing = p.intent.spacing;

  // Every module used is embedded (SPEC 6.5); module definitions no part uses any more are dropped.
  const definitions: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(p.assets.definitions)) if (!k.startsWith("module:") || used.has(k)) definitions[k] = d;

  const doc: Record<string, unknown> = {
    schema: p.shape === "schem" ? p.schema : SCHEMA,
    meta,
    circuit: { parts, nets, nc: sortEps(p.circuit.nc ?? []) },
    intent,
    assets: { library: p.assets.library ?? LIBRARY, definitions },
  };
  if (p.layoutCache !== undefined) doc.layout = p.layoutCache;
  doc.ext = p.ext;
  return doc;
}

/** Canonical file text (SPEC 6.5). Loading it again gives the same project. */
export function saveProject(p: LoadedProject): string {
  if (p.unknownFields.length) throw new Error(`cannot write this project: it uses fields this engine does not know (${p.unknownFields.join(", ")}), and writing would lose them (SPEC 6.6).`);
  return `${JSON.stringify(projectDocument(p), null, 2)}\n`;
}
