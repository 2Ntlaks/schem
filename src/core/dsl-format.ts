// JSON-to-text conversion (SPEC 8.3). Refuse fields the grammar cannot represent.
import { isDeepStrictEqual } from "node:util";
import { cmpStr } from "../geom/geom.js";
import { LIBRARY, NEAR_HINT_SCHEMA, projectDocument, projectPinDefs, SCHEMA, type LoadedProject } from "../io/project.js";
import { MODULE_LIBRARY } from "../modules/index.js";
import { BUILTIN } from "../symbols/library.js";
import { NET_NAME, OPTION_KEY, PIN, TERMINAL, TYPE } from "./dsl-parser.js";
import type { Hint } from "./intent.js";
import { canonical, type Net, type Part, type PinDefs } from "./model.js";
import { parseQuantity, quantityOf } from "./quantity.js";
import { resolveEndpoint } from "./validate.js";

export type DslFormatResult = { ok: true; source: string } | { ok: false; fields: string[] };

const quote = (value: string) => '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
const canQuote = (value: unknown): value is string => typeof value === "string" && !/[\r\n]/.test(value);
const option = (key: string, value: string) => `${key}=${/^[A-Za-z0-9_+.-]+$/.test(value) ? value : quote(value)}`;
const ROLES = new Set(["power_in", "power_out", "ground", "input", "output", "bidir", "passive", "nc"]);
const PIN_FIELDS = new Set(["number", "name", "role", "group"]);

function hintLine(hint: Hint, path: string, fail: (field: string) => void): string | undefined {
  const prefix = hint.priority === "strict" ? "hint strict" : "hint";
  const suffix = hint.priority === "high" ? " priority=high" : "";
  let body: string;
  switch (hint.type) {
    case "relative": body = `${hint.part} ${hint.rel} ${hint.of}`; break;
    case "near": body = `near ${hint.part} ${hint.of}`; break;
    case "align": body = `${hint.axis} ${hint.parts.join(" ")}`; break;
    case "orient": {
      if (hint.flip) fail(`${path}.flip`);
      if (hint.rot !== 0 && hint.rot !== 90) { fail(`${path}.rot`); return; }
      body = `${hint.part} ${hint.rot === 0 ? "horizontal" : "vertical"}`;
      break;
    }
    case "pinSides": {
      const sides = Object.entries(hint.sides);
      if (!sides.length) fail(`${path}.sides`);
      for (const [side, pins] of sides)
        if (!pins.length || !pins.every((pin) => PIN.test(pin))) fail(`${path}.sides.${side}`);
      body = [hint.part, ...sides.map(([side, pins]) => `pins-${side} ${pins.map((pin) => `${hint.part}[${pin}]`).join(" ")}`)].join(" ");
      break;
    }
    case "decouples": body = `${hint.part} decouples ${hint.pin}`; break;
  }
  return `${prefix} ${body}${suffix}`;
}

function partLine(part: Part, defs: PinDefs, fail: (field: string) => void): string {
  const path = `circuit.parts[${part.id}]`;
  if (!TYPE.test(part.type)) fail(`${path}.type`);
  const words = ["part", part.id, part.type];
  for (const [key, value] of Object.entries(part.props ?? {})) {
    if (!OPTION_KEY.test(key) || !canQuote(value)) { fail(`${path}.props.${key}`); continue; }
    const unit = quantityOf(part.type, key), quantity = unit && parseQuantity(value, unit);
    if (quantity && !quantity.ok && quantity.code.startsWith("E")) fail(`${path}.props.${key}`);
    words.push(option(key, value));
  }
  if (part.pins?.length) {
    words.push("pins:");
    for (const pin of part.pins) {
      const field = `${path}.pins[${pin.number}]`;
      for (const key of Object.keys(pin)) {
        const value = pin[key as keyof typeof pin];
        if (!PIN_FIELDS.has(key) && value !== undefined && (!Array.isArray(value) || value.length))
          fail(`${field}.${key}`);
      }
      if (!PIN.test(pin.number)) fail(`${field}.number`);
      if (!PIN.test(pin.name)) fail(`${field}.name`);
      if (pin.role !== undefined && !ROLES.has(pin.role)) fail(`${field}.role`);
      if (pin.group !== undefined && !PIN.test(pin.group)) fail(`${field}.group`);
      const role = pin.role ?? defs[part.id]?.find((definition) => definition.number === pin.number)?.role;
      words.push(`${pin.number}:${pin.name}${role ? `/${role}` : ""}${pin.group ? `@${pin.group}` : ""}`);
    }
  }
  return words.join(" ");
}

function netLine(net: Net, fail: (field: string) => void): string {
  const path = `circuit.nets[${net.id}]`;
  if (net.name === undefined) {
    if (net.kind !== undefined) fail(`${path}.kind`);
    if (net.domain != null) fail(`${path}.domain`);
    if (net.endpoints.length < 2) fail(`${path}.endpoints`);
    return `connect ${net.endpoints.join(" ")}`;
  }
  if (!NET_NAME.test(net.name)) fail(`${path}.name`);
  const options: string[] = [];
  if (net.kind !== undefined) options.push(option("kind", net.kind));
  if (net.domain != null) {
    if (!canQuote(net.domain)) fail(`${path}.domain`);
    else options.push(option("domain", net.domain));
  }
  return ["net", net.name, ...options, "=", ...net.endpoints].join(" ");
}

export function formatDsl(project: LoadedProject): DslFormatResult {
  const fields = new Set(project.unknownFields);
  const fail = (field: string) => { fields.add(field); };
  if (project.schema !== SCHEMA && project.schema !== NEAR_HINT_SCHEMA) fail("schema");
  if (project.meta.created) fail("meta.created");
  if (Object.keys(project.ext).length) fail("ext");
  if (project.layoutCache != null && (typeof project.layoutCache !== "object" || Object.keys(project.layoutCache).length)) fail("layout");
  if (project.intent.spacing !== undefined) fail("intent.spacing");
  if (project.assets.library && project.assets.library !== LIBRARY) fail("assets.library");
  for (const [type, definition] of Object.entries(project.assets.definitions)) {
    const builtin = type.startsWith("module:") ? MODULE_LIBRARY[type] : BUILTIN[type];
    if (!isDeepStrictEqual(definition, builtin)) fail(`assets.definitions[${type}]`);
  }

  const head: string[] = [];
  if (project.meta.title !== undefined) {
    if (!canQuote(project.meta.title)) fail("meta.title");
    else head.push(`circuit ${quote(project.meta.title)}`);
  }
  if (project.intent.style) {
    const style: string[] = [];
    for (const [key, value] of Object.entries(project.intent.style)) {
      if (!OPTION_KEY.test(key) || !canQuote(value)) fail(`intent.style.${key}`);
      else style.push(option(key, value));
    }
    if (style.length) head.push(`style ${style.join(" ")}`);
  }

  // Use the file serializer's canonical pin spelling and its treatment of built-in modules.
  const document = projectDocument(project) as { circuit: LoadedProject["circuit"]; intent: { hints: Hint[] } };
  const defs = projectPinDefs(project);
  const parts = [...document.circuit.parts].sort((a, b) => cmpStr(a.id, b.id)).map((part) => partLine(part, defs, fail));
  const nets = document.circuit.nets.map((net) => netLine(net, fail)).sort(cmpStr);
  const nc = document.circuit.nc?.length ? [`nc ${document.circuit.nc.join(" ")}`] : [];
  const intent: string[] = [];
  for (const [index, hint] of document.intent.hints.entries()) {
    const line = hintLine(hint, `intent.hints[${index}]`, fail);
    if (line) intent.push(line);
  }
  for (const lock of project.intent.locks ?? []) {
    const { part, x, y, rot, flip } = lock;
    intent.push(`lock ${part} at ${x},${y}${rot ? ` rotate ${rot}` : ""}${flip ? " flip" : ""}`);
  }
  for (const [part, side] of Object.entries(project.intent.overrides?.labelSide ?? {})) {
    if (!project.circuit.parts.some((p) => p.id === part)) fail(`intent.overrides.labelSide.${part}`);
    intent.push(`override ${part} label-side=${side}`);
  }
  const netById = new Map(document.circuit.nets.map((net) => [net.id, net]));
  for (const [index, override] of (project.intent.overrides?.netStyle ?? []).entries()) {
    const path = `intent.overrides.netStyle[${index}]`;
    const net = netById.get(override.net);
    if (!net?.name) { fail(`${path}.net`); continue; }
    let pin = "";
    if (override.endpoint !== undefined) {
      const endpoint = resolveEndpoint(override.endpoint, defs);
      const name = endpoint.ok ? canonical(endpoint.ep) : "";
      if (!TERMINAL.test(name) || !net.endpoints.includes(name)) fail(`${path}.endpoint`);
      else pin = ` at ${name}`;
    }
    intent.push(`override net ${net.name}${pin} style=${override.style}`);
  }
  if (fields.size) return { ok: false, fields: [...fields].sort(cmpStr) };
  const groups = [head, parts, nets, nc, intent].filter((group) => group.length);
  return { ok: true, source: groups.length ? groups.map((group) => group.join("\n")).join("\n\n") + "\n" : "" };
}
