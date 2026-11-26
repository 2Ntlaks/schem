// SPICE netlist (.cir / .sp / .net) importer -> schem LoadedProject + canonical .schem DSL.

import { cmpNatural } from "../geom/geom.js";
import { formatDsl } from "../core/dsl-format.js";
import { NET_NAME, PART_ID, PIN } from "../core/dsl-parser.js";
import { netKind, type Circuit, type Net, type NetKind, type Part, type PinDef, type PinDefs, type Role } from "../core/model.js";
import { parseQuantity, quantityOf } from "../core/quantity.js";
import { validate } from "../core/validate.js";
import { defaultRole, loadProject, SCHEMA, type LoadedProject } from "./project.js";
import { BUILTIN } from "../symbols/library.js";

export interface SpiceImportResult {
  ok: boolean;
  project?: LoadedProject;
  dsl?: string;
  warnings: string[];
  errors: string[];
}

interface LogicalLine {
  line: number;
  text: string;
}

interface SpiceModel {
  name: string;
  type: string;
  rawParams: string;
}

interface SpiceSubckt {
  name: string;
  pins: string[];
}

const SKIPPED_DIRECTIVES = new Set([
  ".tran", ".ac", ".dc", ".op", ".param", ".params", ".options", ".option",
  ".plot", ".print", ".probe", ".save", ".ic", ".nodeset", ".include", ".inc",
  ".lib", ".backanno", ".meas", ".measure", ".step", ".temp", ".tf", ".noise",
  ".four", ".pz", ".sens", ".func", ".global", ".width", ".savebias", ".loadbias",
]);

const TITLE_WORDS = /^(RC|RL|LC|RLC|COMMON|CIRCUIT|CURRENT|VOLTAGE|RESISTOR|CAPACITOR|INDUCTOR|DIODE|CMOS|MOSFET|LINEAR|LOGIC|MODEL|MIXED|MAIN|INPUT|INVERTER|RECTIFIER|REGULATOR|LOW|HIGH|BAND|PASS|FILTER|AMPLIFIER|DIFF|DIFFERENTIAL|OPAMP|OP-AMP)$/i;

const KNOWN_OPAMP = /^(OPAMP|OP_?AMP|IDEAL_?OPAMP|UA741|LM741|LM358|LM324|TL07[124]|TL08[124]|OP07|OP27|OP37|OPA\d+\w*|AD8\d+\w*|AD7\d+\w*|LT10\d+\w*|LF35[136]\w*|MCP60\d+\w*|NE553[24]\w*|LMV358\w*|INA\d+\w*)$/i;

const KNOWN_PNP = /^(2N2907|2N3906|2N4403|2N5401|BC55[6-9]|BC560|BC327|BC85[6-8]|SS8550|S8550|MPSA56|MMBT3906|MMBT2907|TIP32|TIP42|BD140|PN2907)/i;
const KNOWN_NPN = /^(2N2222|2N3904|2N4401|2N5551|BC54[6-9]|BC550|BC337|BC84[6-8]|SS8050|S8050|MPSA06|MMBT3904|MMBT2222|TIP31|TIP41|BD139|PN2222)/i;

const KNOWN_PMOS = /^(PMOS|PFET|IRF9\d|BS250|BSS84|SI2301|AO3401|ZVP\d|FQP\d+P|IRLP\d|P\d|P_)/i;
const KNOWN_NMOS = /^(NMOS|NFET|2N700[02]|BS170|BSS138|IRF[5-8]\d|IRFZ\d|AO3400|SI2302|ZVN\d|FQP\d+N|IRLZ\d|N\d|N_)/i;

const BATTERY_REF = /^(V_?BATT?\w*|BATT?\w*)$/i;

const DIODE_LED = /LED/i;
const DIODE_SCHOTTKY = /SCHOTTKY|^1N58\d|^SB\d|^BAT\d|^SS\d|^MBR\d|^RB\d/i;
const DIODE_ZENER = /ZENER|^BZX\d|^BZV\d|^1N47\d|^1N52\d|^1N53\d|^MMBZ\d|^DZ/i;

function stripInlineComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ";") return line.slice(0, i);
  }
  return line;
}

/** Split a SPICE card into tokens, preserving quoted strings, `{expr}`, and `(...)` groups. */
function tokenizeSpice(text: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let parenDepth = 0;
  let braceDepth = 0;

  const flush = () => {
    if (cur.length > 0) {
      tokens.push(cur);
      cur = "";
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      cur += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      cur += ch;
      continue;
    }
    if (ch === "}") {
      if (braceDepth > 0) braceDepth--;
      cur += ch;
      continue;
    }
    if (parenDepth === 0 && braceDepth === 0 && /\s/.test(ch)) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return tokens;
}

function isSpiceNumericValue(token: string): boolean {
  if (/^\{.+\}$/.test(token)) return true;
  if (/^[A-Za-z]+=.+$/.test(token)) return true;
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(?:meg|mil|[fpnuµμmkgt]|ohm|ohms|Ω|[fhva])*[fhva]?$/i.test(token)
    || /^\d+[pnuµμmkMGRV]\d+$/i.test(token);
}

function isLikelySourceSpec(token: string): boolean {
  if (/^(DC|AC|SIN|SINE|PULSE|PWL|EXP|SFFM)(?:\(|=|$)/i.test(token)) return true;
  return isSpiceNumericValue(token);
}

function isLikelyRefDes(token: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(token)) return false;
  if (TITLE_WORDS.test(token)) return false;
  return /\d/.test(token) || token.length <= 5;
}

/** Decide whether line 1 is an element card (not a circuit title). */
function looksLikeElementLine(line: string): boolean {
  const cleaned = stripInlineComment(line).trim();
  if (!cleaned) return false;
  const tokens = tokenizeSpice(cleaned);
  if (tokens.length < 3) return false;
  const ref = tokens[0]!;
  if (!isLikelyRefDes(ref)) return false;
  const lead = ref[0]!.toUpperCase();
  if (lead === "R" || lead === "C" || lead === "L") {
    return tokens.length >= 4 && isSpiceNumericValue(tokens[3]!);
  }
  if (lead === "V" || lead === "I") {
    return tokens.length >= 4 && isLikelySourceSpec(tokens[3]!);
  }
  if (lead === "D") {
    return tokens.length >= 4 && /\d/.test(ref);
  }
  if (lead === "Q" || lead === "M") {
    return tokens.length >= 5 && /\d/.test(ref);
  }
  if (lead === "X") {
    return tokens.length >= 3 && /\d/.test(ref);
  }
  return false;
}

function preprocessSpice(source: string, warnings: string[]): { title?: string; lines: LogicalLine[] } {
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
  const lines: LogicalLine[] = [];
  let title: string | undefined;
  let checkedFirstLine = false;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const raw = rawLines[i]!;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (!checkedFirstLine) {
      checkedFirstLine = true;
      if (!trimmed.startsWith("*") && !trimmed.startsWith(";") && !trimmed.startsWith(".") && !looksLikeElementLine(trimmed)) {
        title = trimmed;
        continue;
      }
    }

    if (trimmed.startsWith("*") || trimmed.startsWith(";")) continue;

    const noComment = stripInlineComment(trimmed).trim();
    if (!noComment) continue;

    if (noComment.startsWith("+")) {
      const rest = noComment.slice(1).trim();
      if (lines.length === 0) {
        warnings.push(`Line ${lineNum}: stray '+' continuation line ignored.`);
      } else if (rest) {
        lines[lines.length - 1]!.text += ` ${rest}`;
      }
      continue;
    }

    lines.push({ line: lineNum, text: noComment });
  }

  return { ...(title ? { title } : {}), lines };
}

/** Convert clean SPICE scientific notation (e.g. 1e-6, 2.2e3) to SI prefix notation when in range. */
function formatScientific(num: number): string | undefined {
  if (!Number.isFinite(num) || num === 0) return "0";
  const abs = Math.abs(num);
  const prefixes: Array<[number, string]> = [
    [1e9, "G"],
    [1e6, "MEG"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  if (abs < 1e-13 || abs >= 1e12) return undefined;
  const [mult, prefix] = prefixes.find(([m]) => abs >= m * 0.999999) ?? [1e-12, "p"];
  const scaled = Number((num / mult).toPrecision(6));
  return `${scaled}${prefix}`;
}

/**
 * Normalize a SPICE scalar quantity string so `parseQuantity` and `displayValue`
 * handle SPICE casing (`100NF`, `10U`, `1Meg`, `1e-6`) cleanly.
 */
function normalizeSpiceQuantity(raw: string, kind: "ohm" | "farad" | "henry" | "volt" | "amp" | "hertz"): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("{")) return trimmed;

  // Scientific notation with optional trailing unit (e.g. 1e-6, 1e-6F, 2.2e3ohm)
  const sci = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))[eE]([+-]?\d+)(ohm|ohms|Ω|[fhva]|hz)?$/i.exec(trimmed);
  if (sci) {
    const val = Number(`${sci[1]}e${sci[2]}`);
    const formatted = formatScientific(val);
    if (formatted !== undefined) {
      return appendUnitIfNeeded(formatted, kind);
    }
    return trimmed;
  }

  // RKM notation (e.g. 4k7, 2R2, 4u7, 3V3)
  const rkm = /^(\d+)([pnuµμmkMGRV])(\d+)$/i.exec(trimmed);
  if (rkm) {
    const [, a, p, b] = rkm as unknown as [string, string, string, string];
    const lp = p.toLowerCase();
    const normP = lp === "r" ? "R" : lp === "v" ? "V" : lp === "g" ? "G" : lp;
    return `${a}${normP}${b}`;
  }

  // Standard SPICE number + optional SI prefix + optional unit
  const m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(meg|[pnuµμmkg])?(ohm|ohms|Ω|hz|[fhva])?$/i.exec(trimmed);
  if (m) {
    const [, num, rawPrefix, rawUnit] = m as unknown as [string, string, string | undefined, string | undefined];
    let prefix = "";
    if (rawPrefix) {
      const lp = rawPrefix.toLowerCase();
      if (lp === "meg") prefix = "MEG";
      else if (lp === "g") prefix = "G";
      else if (lp === "µ" || lp === "μ") prefix = "u";
      else prefix = lp; // p, n, u, m, k (in SPICE, M is milli and K is kilo)
    }
    // Special case: "100f" on capacitor with no prefix might be femto, whereas "1F" is 1 Farad.
    if (!rawPrefix && rawUnit === "f" && kind === "farad") {
      return trimmed;
    }
    const unitSuffix = canonicalUnitSuffix(kind, rawUnit);
    return `${num}${prefix}${unitSuffix}`;
  }

  return trimmed;
}

function appendUnitIfNeeded(value: string, kind: "ohm" | "farad" | "henry" | "volt" | "amp" | "hertz"): string {
  if (kind === "volt") return `${value}V`;
  if (kind === "amp") return `${value}A`;
  if (kind === "hertz") return `${value}Hz`;
  return value;
}

function canonicalUnitSuffix(kind: "ohm" | "farad" | "henry" | "volt" | "amp" | "hertz", rawUnit?: string): string {
  if (kind === "volt") return "V";
  if (kind === "amp") return "A";
  if (kind === "hertz") return "Hz";
  if (!rawUnit) return "";
  if (kind === "farad" && /^f$/i.test(rawUnit)) return "F";
  if (kind === "henry" && /^h$/i.test(rawUnit)) return "H";
  if (kind === "ohm" && /^(ohm|ohms|Ω)$/i.test(rawUnit)) return "";
  return rawUnit;
}

/** Ensure a candidate `props.value` will not trigger a hard E310/E311 error in `formatDsl`. */
function safePartValue(partType: string, value: string): string {
  const unit = quantityOf(partType, "value");
  if (!unit) return value;
  const q = parseQuantity(value, unit);
  if (!q.ok && q.code.startsWith("E")) {
    return value.replaceAll(",", ".");
  }
  return value;
}

function parseModelDirective(tokens: string[]): SpiceModel | undefined {
  if (tokens.length < 3) return undefined;
  const name = tokens[1]!;
  const rest = tokens.slice(2).join(" ").trim();
  const paren = rest.indexOf("(");
  if (paren >= 0) {
    const type = rest.slice(0, paren).trim().toUpperCase();
    const rawParams = rest.slice(paren + 1).replace(/\)\s*$/, "").trim();
    return type ? { name, type, rawParams } : undefined;
  }
  const type = tokens[2]!.toUpperCase();
  const rawParams = tokens.slice(3).join(" ").trim();
  return { name, type, rawParams };
}

function parseSubcktDirective(tokens: string[]): SpiceSubckt | undefined {
  if (tokens.length < 2) return undefined;
  const name = tokens[1]!;
  const pins: string[] = [];
  for (let i = 2; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (/^params:?$/i.test(tok) || tok.includes("=")) break;
    pins.push(tok);
  }
  return { name, pins };
}

function sanitizePartId(raw: string): string {
  let id = raw.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z]/.test(id)) id = `U_${id}`;
  return id;
}

function sanitizePinName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_+-]/g, "_").replace(/^_+|_+$/g, "");
  if (cleaned && PIN.test(cleaned)) return cleaned;
  return fallback;
}

function sanitizeNetName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_+.-]/g, "_");
  if (cleaned && NET_NAME.test(cleaned)) return cleaned;
  return "NET";
}

function detectDiodeType(modelName: string | undefined, modelDef: SpiceModel | undefined): "diode" | "zener" | "schottky" | "led" {
  const params = modelDef?.rawParams ?? "";
  if (/\btype\s*=\s*led\b/i.test(params)) return "led";
  if (/\btype\s*=\s*schottky\b/i.test(params)) return "schottky";
  if (/\btype\s*=\s*zener\b/i.test(params)) return "zener";
  if (!modelName) return "diode";
  if (DIODE_LED.test(modelName)) return "led";
  if (DIODE_SCHOTTKY.test(modelName)) return "schottky";
  if (DIODE_ZENER.test(modelName)) return "zener";
  return "diode";
}

function parseSourceArgs(specText: string, refId: string): {
  type: "ac-source" | "battery" | "vsource";
  props: Record<string, string>;
} {
  const props: Record<string, string> = {};
  const trimmed = specText.trim();
  if (!trimmed) {
    return { type: BATTERY_REF.test(refId) ? "battery" : "vsource", props };
  }

  // SIN / SINE (VO VA FREQ ...)
  const sinMatch = /\bSINE?\s*\(([^)]*)\)/i.exec(trimmed);
  if (sinMatch) {
    const args = sinMatch[1]!.split(/[\s,]+/).filter(Boolean);
    if (args.length >= 2) {
      props.value = normalizeSpiceQuantity(args[1]!, "volt");
    } else if (args.length === 1) {
      props.value = normalizeSpiceQuantity(args[0]!, "volt");
    }
    if (args.length >= 3) {
      props.freq = normalizeSpiceQuantity(args[2]!, "hertz");
    }
    if (args.length >= 1 && args[0] !== "0" && args[0] !== "0V") {
      props.offset = normalizeSpiceQuantity(args[0]!, "volt");
    }
    return { type: "ac-source", props };
  }

  // AC <mag> [phase]
  const acMatch = /\bAC(?:=|\s+)([^\s,()]+)/i.exec(trimmed);
  if (acMatch) {
    props.value = normalizeSpiceQuantity(acMatch[1]!, "volt");
    return { type: "ac-source", props };
  }
  if (/^\s*AC\b/i.test(trimmed)) {
    props.value = "1V";
    return { type: "ac-source", props };
  }

  // PULSE (V1 V2 ...)
  const pulseMatch = /\bPULSE\s*\(([^)]*)\)/i.exec(trimmed);
  if (pulseMatch) {
    const args = pulseMatch[1]!.split(/[\s,]+/).filter(Boolean);
    if (args.length >= 2) {
      props.value = normalizeSpiceQuantity(args[1]!, "volt");
    } else if (args.length === 1) {
      props.value = normalizeSpiceQuantity(args[0]!, "volt");
    }
    props.waveform = `PULSE(${args.join(" ")})`;
    return { type: "vsource", props };
  }

  // DC <val> or DC=<val>
  const dcMatch = /\bDC(?:=|\s+)([^\s,()]+)/i.exec(trimmed);
  if (dcMatch) {
    props.value = normalizeSpiceQuantity(dcMatch[1]!, "volt");
    return { type: BATTERY_REF.test(refId) ? "battery" : "vsource", props };
  }

  // Bare value token (e.g. "5", "5V", "12")
  const firstTok = tokenizeSpice(trimmed)[0];
  if (firstTok) {
    props.value = normalizeSpiceQuantity(firstTok, "volt");
  }
  return { type: BATTERY_REF.test(refId) ? "battery" : "vsource", props };
}

function classifyOpampPin(name: string): "in+" | "in-" | "out" | undefined {
  const n = name.trim().toLowerCase();
  if (/^(in\+|inp|noninv|non_inv|\+|vp|vin\+|in_p|pos)$/.test(n)) return "in+";
  if (/^(in-|inm|inv|invert|-|vn|vin-|in_n|neg)$/.test(n)) return "in-";
  if (/^(out|vout|vo|o|output)$/.test(n)) return "out";
  return undefined;
}

function inferIcPinRole(name: string, allNames: readonly string[]): Role {
  if (/^(GND|AGND|DGND|PGND|VSS|GROUND|0V|COM)$/i.test(name)) return "ground";
  const hasVin = allNames.some((n) => /^VIN$/i.test(n));
  const hasVout = allNames.some((n) => /^VOUT$/i.test(n));
  if (hasVin && hasVout) {
    if (/^VIN$/i.test(name)) return "power_in";
    if (/^VOUT$/i.test(name)) return "power_out";
  }
  if (/^(VCC|VDD|VEE|V\+|V-|VP|VN|VS\+|VS-|VBAT|VBUS|3V3|5V|12V|PWR|SUPPLY)$/i.test(name)) return "power_in";
  if (/^(VOUT|OUT|VO|Q|QB|Y|OUTPUT|OUT\d*)$/i.test(name)) return "output";
  if (/^(IN|IN\+|IN-|INP|INM|VIN|A|B|CLK|RST|RESET|EN|TRIG|THR|THRES|CTRL|CV|INPUT|IN\d*)$/i.test(name)) return "input";
  return defaultRole(name);
}

export function importSpice(source: string): SpiceImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, warnings, errors: ["SPICE netlist input is empty."] };
  }

  const pre = preprocessSpice(source, warnings);
  let title = pre.title;

  const models = new Map<string, SpiceModel>();
  const subckts = new Map<string, SpiceSubckt>();
  const elementLines: LogicalLine[] = [];

  // Pass 1: collect .title, .model, .subckt ... .ends, and filter simulation directives.
  let subcktDepth = 0;
  let openSubcktName = "";
  let inControl = false;

  for (const stmt of pre.lines) {
    const tokens = tokenizeSpice(stmt.text);
    if (tokens.length === 0) continue;
    const first = tokens[0]!;

    if (inControl) {
      if (first.toLowerCase() === ".endc") inControl = false;
      continue;
    }

    if (subcktDepth > 0) {
      const low = first.toLowerCase();
      if (low === ".subckt") {
        subcktDepth++;
      } else if (low === ".ends") {
        subcktDepth--;
      } else if (low === ".end") {
        warnings.push(`Line ${stmt.line}: reached .end before closing .subckt "${openSubcktName}".`);
        subcktDepth = 0;
        break;
      }
      continue;
    }

    if (first.startsWith(".")) {
      const dir = first.toLowerCase();
      if (dir === ".end") break;
      if (dir === ".title") {
        const t = stmt.text.slice(first.length).trim();
        if (t) title = t;
        continue;
      }
      if (dir === ".model") {
        const m = parseModelDirective(tokens);
        if (m) models.set(m.name.toUpperCase(), m);
        else warnings.push(`Line ${stmt.line}: could not parse .model directive.`);
        continue;
      }
      if (dir === ".subckt") {
        const sc = parseSubcktDirective(tokens);
        if (sc) {
          subckts.set(sc.name.toUpperCase(), sc);
          openSubcktName = sc.name;
        } else {
          warnings.push(`Line ${stmt.line}: could not parse .subckt directive.`);
          openSubcktName = "unknown";
        }
        subcktDepth = 1;
        continue;
      }
      if (dir === ".ends") {
        warnings.push(`Line ${stmt.line}: stray .ends outside .subckt ignored.`);
        continue;
      }
      if (dir === ".control") {
        inControl = true;
        warnings.push(`Ignored directive ".control" (line ${stmt.line}).`);
        continue;
      }
      if (SKIPPED_DIRECTIVES.has(dir)) {
        warnings.push(`Ignored directive "${dir}" (line ${stmt.line}).`);
        continue;
      }
      warnings.push(`Ignored unsupported directive "${dir}" (line ${stmt.line}).`);
      continue;
    }

    elementLines.push(stmt);
  }

  if (subcktDepth > 0) {
    warnings.push(`Unclosed .subckt "${openSubcktName}" (missing .ends).`);
  }

  // Pass 2: instantiate elements and build net connections.
  const parts: Part[] = [];
  const seenParts = new Map<string, string>(); // UPPER -> id

  interface NetAcc {
    key: string;
    name: string;
    kind?: NetKind;
    endpoints: string[];
  }
  const netsByKey = new Map<string, NetAcc>();
  const usedDisplayNames = new Set<string>();

  const connect = (rawNode: string, endpoint: string) => {
    const isGroundZero = rawNode === "0" || /^GND$/i.test(rawNode);
    const key = isGroundZero ? "GND" : rawNode.toUpperCase();
    let acc = netsByKey.get(key);
    if (!acc) {
      let displayName: string;
      if (isGroundZero) {
        displayName = "GND";
      } else {
        const base = sanitizeNetName(rawNode);
        if (base !== rawNode) {
          warnings.push(`Sanitized SPICE node "${rawNode}" to net name "${base}".`);
        }
        displayName = base;
        let suffix = 2;
        while (usedDisplayNames.has(displayName)) {
          displayName = `${base}_${suffix++}`;
        }
      }
      usedDisplayNames.add(displayName);
      const inferred = isGroundZero ? "ground" : netKind({ name: displayName });
      acc = {
        key,
        name: displayName,
        ...(inferred !== "signal" ? { kind: inferred } : {}),
        endpoints: [],
      };
      netsByKey.set(key, acc);
    }
    acc.endpoints.push(endpoint);
  };

  const registerPart = (rawRef: string, line: number): string | undefined => {
    const id = sanitizePartId(rawRef);
    if (!PART_ID.test(id)) {
      errors.push(`Line ${line}: invalid part identifier "${rawRef}".`);
      return undefined;
    }
    if (id !== rawRef) {
      warnings.push(`Line ${line}: sanitized part identifier "${rawRef}" to "${id}".`);
    }
    const upper = id.toUpperCase();
    if (seenParts.has(upper)) {
      errors.push(`Line ${line}: duplicate part identifier "${id}".`);
      return undefined;
    }
    seenParts.set(upper, id);
    return id;
  };

  for (const stmt of elementLines) {
    const tokens = tokenizeSpice(stmt.text);
    if (tokens.length === 0) continue;
    const rawRef = tokens[0]!;
    const lead = rawRef[0]!.toUpperCase();

    if (lead === "R" || lead === "C" || lead === "L") {
      const partType = lead === "R" ? "resistor" : lead === "C" ? "capacitor" : "inductor";
      const qtyKind = lead === "R" ? "ohm" : lead === "C" ? "farad" : "henry";
      if (tokens.length < 4) {
        errors.push(`Line ${stmt.line}: ${partType} "${rawRef}" requires 2 nodes and a value.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const n1 = tokens[1]!;
      const n2 = tokens[2]!;
      let rawVal = tokens[3]!;
      const eqPref = new RegExp(`^${lead}=`, "i");
      if (eqPref.test(rawVal)) rawVal = rawVal.slice(2);
      const cleanVal = safePartValue(partType, normalizeSpiceQuantity(rawVal, qtyKind));
      parts.push({ id, type: partType, props: { value: cleanVal } });
      connect(n1, `${id}[1]`);
      connect(n2, `${id}[2]`);
      continue;
    }

    if (lead === "D") {
      if (tokens.length < 3) {
        errors.push(`Line ${stmt.line}: diode "${rawRef}" requires anode and cathode nodes.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const anode = tokens[1]!;
      const cathode = tokens[2]!;
      const modelToken = tokens.length >= 4 && !tokens[3]!.includes("=") ? tokens[3]! : undefined;
      const modelDef = modelToken ? models.get(modelToken.toUpperCase()) : undefined;
      const diodeType = detectDiodeType(modelToken, modelDef);
      parts.push({
        id,
        type: diodeType,
        ...(modelToken ? { props: { partNumber: modelToken } } : {}),
      });
      connect(anode, `${id}[A]`);
      connect(cathode, `${id}[K]`);
      continue;
    }

    if (lead === "V") {
      if (tokens.length < 3) {
        errors.push(`Line ${stmt.line}: voltage source "${rawRef}" requires positive and negative nodes.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const pos = tokens[1]!;
      const neg = tokens[2]!;
      const specText = tokens.slice(3).join(" ");
      const parsed = parseSourceArgs(specText, id);
      if (parsed.props.value !== undefined) {
        parsed.props.value = safePartValue(parsed.type, parsed.props.value);
      }
      parts.push({
        id,
        type: parsed.type,
        ...(Object.keys(parsed.props).length ? { props: parsed.props } : {}),
      });
      if (parsed.type === "ac-source") {
        connect(pos, `${id}[1]`);
        connect(neg, `${id}[2]`);
      } else {
        connect(pos, `${id}[+]`);
        connect(neg, `${id}[-]`);
      }
      continue;
    }

    if (lead === "I") {
      if (tokens.length < 4) {
        errors.push(`Line ${stmt.line}: current source "${rawRef}" requires 2 nodes and a value.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const pos = tokens[1]!;
      const neg = tokens[2]!;
      const specText = tokens.slice(3).join(" ").trim();
      const dcMatch = /\bDC(?:=|\s+)([^\s,()]+)/i.exec(specText);
      const rawVal = dcMatch ? dcMatch[1]! : tokens[3]!;
      const cleanVal = normalizeSpiceQuantity(rawVal, "amp");

      const currentSym = BUILTIN["current-source"];
      if (currentSym && currentSym.pins.length >= 2) {
        // SPICE `Ixxx n+ n- val` drives current from n+ internally to n- (arrow points to n-).
        // On BUILTIN["current-source"], pins[0] (+) is the arrow tip and pins[1] (-) is the tail.
        const p0 = currentSym.pins[0]!.number;
        const p1 = currentSym.pins[1]!.number;
        parts.push({ id, type: "current-source", props: { value: safePartValue("current-source", cleanVal) } });
        connect(neg, `${id}[${p0}]`);
        connect(pos, `${id}[${p1}]`);
      } else {
        warnings.push(`Line ${stmt.line}: "current-source" symbol is not available in BUILTIN; mapped "${id}" to a 2-pin ic block.`);
        parts.push({
          id,
          type: "ic",
          props: { label: `I ${cleanVal}` },
          pins: [
            { number: "1", name: "POS", role: "output" },
            { number: "2", name: "NEG", role: "input" },
          ],
        });
        connect(pos, `${id}[1]`);
        connect(neg, `${id}[2]`);
      }
      continue;
    }

    if (lead === "Q") {
      if (tokens.length < 5) {
        errors.push(`Line ${stmt.line}: BJT "${rawRef}" requires collector, base, emitter nodes and a model name.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const nc = tokens[1]!;
      const nb = tokens[2]!;
      const ne = tokens[3]!;

      let modelToken = tokens[4]!;
      let subNode: string | undefined;
      if (!models.has(tokens[4]!.toUpperCase()) && tokens.length >= 6) {
        const cand = tokens[5]!;
        const isParamOrArea = cand.includes("=") || /^OFF$/i.test(cand) || /^\d+(?:\.\d+)?$/.test(cand);
        if (models.has(cand.toUpperCase()) || !isParamOrArea) {
          subNode = tokens[4]!;
          modelToken = cand;
        }
      }
      if (subNode !== undefined) {
        warnings.push(`Line ${stmt.line}: BJT "${id}" substrate node "${subNode}" omitted on 3-pin symbol.`);
      }

      const modelDef = models.get(modelToken.toUpperCase());
      let bjtType: "npn" | "pnp";
      if (modelDef?.type === "PNP") {
        bjtType = "pnp";
      } else if (modelDef?.type === "NPN") {
        bjtType = "npn";
      } else if (/PNP/i.test(modelToken) || KNOWN_PNP.test(modelToken)) {
        bjtType = "pnp";
      } else if (/NPN/i.test(modelToken) || KNOWN_NPN.test(modelToken)) {
        bjtType = "npn";
      } else {
        bjtType = "npn";
        warnings.push(`Line ${stmt.line}: BJT "${id}" model "${modelToken}" polarity is ambiguous (no .model found); defaulting to npn.`);
      }

      parts.push({ id, type: bjtType, props: { partNumber: modelToken } });
      connect(nc, `${id}[C]`);
      connect(nb, `${id}[B]`);
      connect(ne, `${id}[E]`);
      continue;
    }

    if (lead === "M") {
      if (tokens.length < 5) {
        errors.push(`Line ${stmt.line}: MOSFET "${rawRef}" requires drain, gate, source nodes and a model name.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const nd = tokens[1]!;
      const ng = tokens[2]!;
      const ns = tokens[3]!;

      let bulkNode: string | undefined;
      let modelToken: string;
      if (tokens.length >= 6 && models.has(tokens[5]!.toUpperCase())) {
        bulkNode = tokens[4]!;
        modelToken = tokens[5]!;
      } else if (models.has(tokens[4]!.toUpperCase())) {
        modelToken = tokens[4]!;
      } else if (tokens.length >= 6 && !tokens[5]!.includes("=")) {
        bulkNode = tokens[4]!;
        modelToken = tokens[5]!;
      } else {
        modelToken = tokens[4]!;
      }

      if (bulkNode !== undefined) {
        const normBulk = bulkNode === "0" || /^GND$/i.test(bulkNode) ? "GND" : bulkNode.toUpperCase();
        const normSrc = ns === "0" || /^GND$/i.test(ns) ? "GND" : ns.toUpperCase();
        if (normBulk !== normSrc) {
          warnings.push(`Line ${stmt.line}: MOSFET "${id}" bulk node "${bulkNode}" differs from source "${ns}" and is omitted on 3-pin symbol.`);
        }
      }

      const modelDef = models.get(modelToken.toUpperCase());
      let mosType: "nmos" | "pmos";
      if (modelDef?.type === "PMOS") {
        mosType = "pmos";
      } else if (modelDef?.type === "NMOS") {
        mosType = "nmos";
      } else if (modelDef?.type === "VDMOS") {
        mosType = /\bpchan\b/i.test(modelDef.rawParams) ? "pmos" : "nmos";
      } else if (KNOWN_PMOS.test(modelToken) || /^P/i.test(modelToken)) {
        mosType = "pmos";
      } else if (KNOWN_NMOS.test(modelToken) || /^N/i.test(modelToken)) {
        mosType = "nmos";
      } else {
        mosType = "nmos";
        warnings.push(`Line ${stmt.line}: MOSFET "${id}" model "${modelToken}" channel type is ambiguous (no .model found); defaulting to nmos.`);
      }

      parts.push({ id, type: mosType, props: { partNumber: modelToken } });
      connect(nd, `${id}[D]`);
      connect(ng, `${id}[G]`);
      connect(ns, `${id}[S]`);
      continue;
    }

    if (lead === "X") {
      // Strip trailing params: / key=value tokens to find <subcktName> and node list.
      const body: string[] = [];
      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (/^params:?$/i.test(tok) || tok.includes("=")) break;
        body.push(tok);
      }
      if (body.length < 2) {
        errors.push(`Line ${stmt.line}: subcircuit instance "${rawRef}" requires at least one node and a subcircuit name.`);
        continue;
      }
      const id = registerPart(rawRef, stmt.line);
      if (!id) continue;
      const subcktName = body[body.length - 1]!;
      const nodes = body.slice(0, -1);
      const subcktDef = subckts.get(subcktName.toUpperCase());

      // Check for 3-pin op-amp mapping.
      if (nodes.length === 3) {
        let opampPinMap: { inp: number; inm: number; out: number } | undefined;
        if (subcktDef && subcktDef.pins.length === 3) {
          const roles = subcktDef.pins.map(classifyOpampPin);
          const inp = roles.indexOf("in+");
          const inm = roles.indexOf("in-");
          const out = roles.indexOf("out");
          if (inp >= 0 && inm >= 0 && out >= 0) {
            opampPinMap = { inp, inm, out };
          }
        } else if (KNOWN_OPAMP.test(subcktName)) {
          opampPinMap = { inp: 0, inm: 1, out: 2 };
        }

        if (opampPinMap) {
          parts.push({ id, type: "opamp", props: { partNumber: subcktName } });
          connect(nodes[opampPinMap.inp]!, `${id}[3]`);
          connect(nodes[opampPinMap.inm]!, `${id}[2]`);
          connect(nodes[opampPinMap.out]!, `${id}[1]`);
          continue;
        }
      }

      // Generic IC box (including 5-pin op-amps with supply pins).
      let rawPinNames: string[];
      if (subcktDef) {
        if (subcktDef.pins.length !== nodes.length) {
          warnings.push(`Line ${stmt.line}: "${id}" passes ${nodes.length} nodes to .subckt "${subcktDef.name}" which declares ${subcktDef.pins.length} pins.`);
        }
        rawPinNames = nodes.map((_, i) => subcktDef.pins[i] ?? `P${i + 1}`);
      } else if (nodes.length === 5 && KNOWN_OPAMP.test(subcktName)) {
        rawPinNames = ["IN+", "IN-", "V+", "V-", "OUT"];
      } else {
        rawPinNames = nodes.map((_, i) => `P${i + 1}`);
      }

      const cleanNames = rawPinNames.map((n, i) => sanitizePinName(n, `P${i + 1}`));
      const icPins: PinDef[] = cleanNames.map((name, i) => ({
        number: String(i + 1),
        name,
        role: inferIcPinRole(name, cleanNames),
      }));

      parts.push({
        id,
        type: "ic",
        props: { partNumber: subcktName },
        pins: icPins,
      });
      nodes.forEach((node, i) => {
        connect(node, `${id}[${i + 1}]`);
      });
      continue;
    }

    if (lead === "K") {
      warnings.push(`Line ${stmt.line}: mutual inductance coupling "${rawRef}" ignored.`);
      continue;
    }

    warnings.push(`Line ${stmt.line}: unsupported SPICE element "${rawRef}" skipped.`);
  }

  if (errors.length > 0) {
    return { ok: false, warnings, errors };
  }

  if (parts.length === 0) {
    errors.push("No circuit elements found in SPICE netlist.");
    return { ok: false, warnings, errors };
  }

  // Deterministic canonical net ordering: power -> ground (GND first) -> signal.
  const kindRank = (k?: NetKind): number => (k === "power" ? 0 : k === "ground" ? 1 : 2);
  const sortedNetAccs = [...netsByKey.values()].sort((a, b) => {
    const rk = kindRank(a.kind) - kindRank(b.kind);
    if (rk !== 0) return rk;
    if (a.kind === "ground" && b.kind === "ground") {
      if (a.name === "GND" && b.name !== "GND") return -1;
      if (b.name === "GND" && a.name !== "GND") return 1;
    }
    return cmpNatural(a.name, b.name);
  });

  const nets: Net[] = sortedNetAccs.map((acc, index) => {
    const endpoints = [...new Set(acc.endpoints)].sort(cmpNatural);
    if (endpoints.length === 1) {
      warnings.push(`Net "${acc.name}" has only 1 endpoint (${endpoints[0]}).`);
    }
    return {
      id: `n${index + 1}`,
      name: acc.name,
      ...(acc.kind !== undefined ? { kind: acc.kind } : {}),
      endpoints,
    };
  });

  const circuit: Circuit = { parts, nets };
  const pinDefs: PinDefs = {};
  for (const part of parts) {
    const sym = BUILTIN[part.type];
    pinDefs[part.id] = sym
      ? sym.pins.map(({ at: _a, dir: _d, ...rest }) => rest)
      : (part.pins ?? []);
  }

  const validation = validate(circuit, pinDefs);
  if (validation.issues.length > 0) {
    for (const issue of validation.issues) {
      errors.push(`${issue.code}: ${issue.message}`);
    }
    return { ok: false, warnings, errors };
  }

  const loaded = loadProject({
    schema: SCHEMA,
    meta: title ? { title } : {},
    circuit,
    intent: {},
  });
  if (!loaded.ok || !loaded.project) {
    for (const issue of loaded.errors) {
      errors.push(`${issue.code}: ${issue.message}`);
    }
    return { ok: false, warnings, errors };
  }

  const formatted = formatDsl(loaded.project);
  if (!formatted.ok) {
    errors.push(`DSL formatting failed for fields: ${formatted.fields.join(", ")}`);
    return { ok: false, project: loaded.project, warnings, errors };
  }

  return {
    ok: true,
    project: loaded.project,
    dsl: formatted.source,
    warnings,
    errors,
  };
}
