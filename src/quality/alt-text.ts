// Reader-facing alt text and net connectivity table (SPEC 10.4).
// Derived strictly from verified electrical connectivity (render.electrical) and part metadata.
// Structural sentences only; functional names appear only when a template matched, marked as inferred.

import { cmpNatural, cmpStr, DELTA, DIRS, edgeKey, key, step, unitEdges, type Dir, type Pt } from "../geom/geom.js";
import { canonical, netKind, type Circuit, type Net, type NetKind, type Part, type PinDefs } from "../core/model.js";
import { groupRepresentative, validate } from "../core/validate.js";
import { BUILTIN } from "../symbols/library.js";
import type { RenderModel } from "../render/model.js";
import { verify } from "../verify/verify.js";

export interface NetTableRow {
  /** Net id in the circuit. */
  id: string;
  /** Display name (explicit net name if given, else net id). */
  name: string;
  /** Electrical kind: power, ground, or signal. */
  kind: NetKind;
  /** Optional domain (e.g. "analog"), else null. */
  domain: string | null;
  /** Drawn presentation derived from render.electrical: connected by wires or by named ports. */
  presentation: "wire" | "port";
  /** Connected pins in canonical order ("R1[1]", "U1[2]"), from verified connectivity. */
  pins: string[];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) { p = this.find(p); this.parent.set(x, p); }
    else this.parent.set(x, x);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (cmpStr(ra, rb) < 0) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

const KIND_ORDER: Record<NetKind, number> = { power: 0, ground: 1, signal: 2 };

/**
 * Extract the verified net connectivity table from the drawn electrical geometry (`render.electrical`).
 * Throws if the drawing fails Layer 1 electrical verification (`verify()`).
 */
export function netTable(circuit: Circuit, pinDefs: PinDefs, render: RenderModel): NetTableRow[] {
  const el = render.electrical;
  const check = verify(circuit, pinDefs, el);
  if (!check.valid) {
    const detail = check.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`Cannot build net table from an unverified drawing: ${sanitize(detail)}`);
  }
  const v = validate(circuit, pinDefs);
  if (!v.valid) {
    const detail = v.issues.map((i) => `${i.code}: ${i.message}`).join("; ");
    throw new Error(`Invalid circuit: ${sanitize(detail)}`);
  }
  const ncSet = new Set(v.valid.nc.map(canonical));

  // Build electrical connectivity directly from render.electrical, mirroring src/verify/verify.ts.
  // fullUf joins ports with matching (kind, text, domain); wireUf joins only physical wire conductors.
  const pointDirs = new Map<string, Set<Dir>>();
  for (const poly of el.wires) {
    for (const [a, b] of unitEdges(poly)) {
      addDir(pointDirs, a, dirOf(a, b));
      addDir(pointDirs, b, dirOf(b, a));
    }
  }

  const pinsAt = new Map<string, string[]>();
  const drawnPinIds: string[] = [];
  for (const p of el.pins) {
    const id = `${p.part}[${p.number}]`;
    drawnPinIds.push(id);
    const k = key(p.at);
    pinsAt.set(k, [...(pinsAt.get(k) ?? []), id]);
  }
  const dots = new Set(el.dots.map(key));
  const portsAt = new Map<string, string[]>();
  for (const p of el.ports) {
    const k = key(p.at);
    portsAt.set(k, [...(portsAt.get(k) ?? []), portKey(p.kind, p.text, p.domain)]);
  }

  const fullUf = new UnionFind();
  const wireUf = new UnionFind();
  const points = new Set<string>([...pointDirs.keys(), ...pinsAt.keys(), ...dots, ...portsAt.keys()]);
  for (const k of [...points].sort(cmpStr)) {
    const pt = k.split(",").map(Number) as unknown as Pt;
    const dirs = pointDirs.get(k) ?? new Set<Dir>();
    const n = dirs.size;
    const pins = pinsAt.get(k) ?? [];
    const ports = portsAt.get(k) ?? [];
    const hasDot = dots.has(k);
    const edgeNode = (d: Dir) => `e:${edgeKey(pt, step(pt, d))}`;
    const allEdges = [...dirs].map(edgeNode);

    if (pins.length > 0) {
      for (const pin of pins) {
        const pn = `pin:${pin}`;
        for (const e of allEdges) { fullUf.union(pn, e); wireUf.union(pn, e); }
        for (const prt of ports) fullUf.union(pn, prt);
      }
      for (let i = 1; i < pins.length; i++) {
        fullUf.union(`pin:${pins[0]!}`, `pin:${pins[i]!}`);
        wireUf.union(`pin:${pins[0]!}`, `pin:${pins[i]!}`);
      }
      continue;
    }

    if (ports.length > 0) {
      for (const e of allEdges) fullUf.union(ports[0]!, e);
      for (const prt of ports.slice(1)) fullUf.union(ports[0]!, prt);
      continue;
    }

    if (n === 2) {
      fullUf.union(allEdges[0]!, allEdges[1]!);
      wireUf.union(allEdges[0]!, allEdges[1]!);
    } else if (n === 3) {
      for (const e of allEdges.slice(1)) { fullUf.union(allEdges[0]!, e); wireUf.union(allEdges[0]!, e); }
    } else if (n === 4) {
      if (hasDot) {
        for (const e of allEdges.slice(1)) { fullUf.union(allEdges[0]!, e); wireUf.union(allEdges[0]!, e); }
      } else {
        fullUf.union(edgeNode("left"), edgeNode("right"));
        fullUf.union(edgeNode("up"), edgeNode("down"));
        wireUf.union(edgeNode("left"), edgeNode("right"));
        wireUf.union(edgeNode("up"), edgeNode("down"));
      }
    }
  }

  // Internal pin groups inside a part are electrically joined.
  for (const id of drawnPinIds) {
    const m = /^(.+)\[(.+)\]$/.exec(id)!;
    const g = pinDefs[m[1]!]?.find((d) => d.number === m[2])?.group;
    if (g !== undefined) {
      fullUf.union(`pin:${id}`, `grp:${m[1]}{${g}}`);
      wireUf.union(`pin:${id}`, `grp:${m[1]}{${g}}`);
    }
  }

  // Group verified drawn pins and ports by equivalence class root.
  const pinsByRoot = new Map<string, string[]>();
  for (const id of [...drawnPinIds].sort(cmpNatural)) {
    const r = fullUf.find(`pin:${id}`);
    const list = pinsByRoot.get(r) ?? [];
    list.push(id);
    pinsByRoot.set(r, list);
  }
  const rootsWithPort = new Set<string>();
  for (const p of el.ports) {
    rootsWithPort.add(fullUf.find(portKey(p.kind, p.text, p.domain)));
  }

  const rows: NetTableRow[] = [];
  for (const net of circuit.nets) {
    const eps = v.valid.endpoints.get(net.id) ?? [];
    const expectedDrawn: string[] = [];
    for (const ep of eps) {
      const id = ep.kind === "terminal"
        ? canonical(ep)
        : `${ep.part}[${groupRepresentative(ep.part, ep.group, pinDefs, ncSet)}]`;
      expectedDrawn.push(id);
    }

    // Collect verified connected pins from the equivalence class of this net's endpoints.
    const verifiedPins = new Set<string>();
    const roots = new Set<string>();
    for (const id of expectedDrawn) {
      const r = fullUf.find(`pin:${id}`);
      roots.add(r);
      for (const member of pinsByRoot.get(r) ?? [id]) verifiedPins.add(member);
    }
    const pins = [...verifiedPins].sort(cmpNatural);

    // Determine presentation strictly from render.electrical:
    // If any drawn port belongs to this net's equivalence class, it is "port" unless
    // all (>= 2) pins are already joined together directly by physical wires.
    const hasPort = [...roots].some((r) => rootsWithPort.has(r));
    const wireRoots = new Set(pins.map((id) => wireUf.find(`pin:${id}`)));
    const presentation: "wire" | "port" = hasPort && (pins.length <= 1 || wireRoots.size > 1) ? "port" : "wire";

    rows.push({
      id: net.id,
      name: net.name ?? net.id,
      kind: netKind(net),
      domain: net.domain ?? null,
      presentation,
      pins,
    });
  }

  return rows.sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || cmpNatural(a.name, b.name)
    || cmpStr(a.domain ?? "", b.domain ?? "")
    || cmpNatural(a.id, b.id),
  );
}

/**
 * Format a verified net table as a clean GitHub-flavored Markdown table.
 */
export function netTableMarkdown(rows: readonly NetTableRow[]): string {
  const lines = [
    "| Net | Kind | Presentation | Connected pins |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const netLabel = row.domain ? `${row.name} (${row.domain})` : row.name;
    const pins = row.pins.length > 0 ? row.pins.join(", ") : "-";
    lines.push(`| ${mdCell(netLabel)} | ${row.kind} | ${row.presentation} | ${mdCell(pins)} |`);
  }
  return lines.join("\n");
}

/**
 * Concise, plain-English accessibility alt text derived strictly from verified electrical
 * connectivity (`render.electrical`) and part metadata. Functional circuit names appear only
 * when a template matched in `notes` and are explicitly marked as inferred.
 */
export function altText(
  circuit: Circuit,
  pinDefs: PinDefs,
  render: RenderModel,
  notes: readonly string[] = [],
): string {
  const rows = netTable(circuit, pinDefs, render);
  const sentences: string[] = [];

  // 1. Opening summary: title (if present), part count, part breakdown, and net count.
  const title = render.meta.title ? sanitize(render.meta.title).trim() : "";
  const partCount = circuit.parts.length;
  const netCount = rows.length;
  const breakdown = partBreakdown(circuit.parts);
  const partPhrase = breakdown ? `${partCount} ${plural(partCount, "part")} (${breakdown})` : `${partCount} ${plural(partCount, "part")}`;
  const netPhrase = `${netCount} ${plural(netCount, "net")}`;
  if (title) sentences.push(`Schematic of ${title}, with ${partPhrase} and ${netPhrase}.`);
  else sentences.push(`Schematic with ${partPhrase} and ${netPhrase}.`);

  // 2. Key ICs and modules from part metadata (structural labels only).
  const keyDevices = describeKeyDevices(circuit.parts);
  if (keyDevices) sentences.push(keyDevices);

  // 3. Recognized structures (ONLY from matched template notes, clearly marked as inferred).
  const validParts = new Set(circuit.parts.map((p) => p.id));
  const structures = parseMatchedTemplates(notes, validParts);
  if (structures.length > 0) {
    const label = structures.length === 1
      ? "Inferred structure (from matched template)"
      : "Inferred structures (from matched templates)";
    sentences.push(`${label}: ${joinList(structures)}.`);
  }

  // 4. Power and ground rails from verified connectivity.
  const powerRows = rows.filter((r) => r.kind === "power");
  const groundRows = rows.filter((r) => r.kind === "ground");
  const railParts: string[] = [];
  if (powerRows.length > 0) {
    const heading = powerRows.length === 1 ? "Power rail" : "Power rails";
    railParts.push(`${heading}: ${joinList(powerRows.map(formatRail))}.`);
  }
  if (groundRows.length > 0) {
    const heading = groundRows.length === 1 ? "Ground rail" : "Ground rails";
    railParts.push(`${heading}: ${joinList(groundRows.map(formatRail))}.`);
  }
  if (railParts.length > 0) sentences.push(railParts.join(" "));

  // 5. Signal flow summary from verified connectivity and drawn pin positions.
  const flowSentence = summarizeSignalFlow(circuit, pinDefs, render, rows);
  if (flowSentence) sentences.push(flowSentence);

  return sanitize(sentences.join(" ")).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Helpers

function portKey(kind: string, text: string, domain: string | null): string {
  return `port:${kind}|${text}|${domain ?? ""}`;
}

function addDir(m: Map<string, Set<Dir>>, p: Pt, d: Dir): void {
  const k = key(p);
  const s = m.get(k);
  if (s) s.add(d);
  else m.set(k, new Set([d]));
}

function dirOf(a: Pt, b: Pt): Dir {
  for (const d of DIRS) {
    const v = DELTA[d];
    if (a[0] + v[0] === b[0] && a[1] + v[1] === b[1]) return d;
  }
  throw new Error("not a unit edge");
}

/** Replace em dashes and en dashes with plain hyphens. */
function sanitize(text: string): string {
  return text.replace(/[\u2013\u2014]/g, "-");
}

function mdCell(text: string): string {
  return sanitize(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function plural(n: number, singular: string, pluralForm?: string): string {
  if (n === 1) return singular;
  if (pluralForm) return pluralForm;
  if (singular.endsWith("y") && !/[aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  if (singular.endsWith("ch") || singular.endsWith("sh") || singular.endsWith("s") || singular.endsWith("x")) return `${singular}es`;
  return `${singular}s`;
}

const PART_TYPE_LABELS: Record<string, [string, string]> = {
  resistor: ["resistor", "resistors"],
  capacitor: ["capacitor", "capacitors"],
  "polarised-capacitor": ["polarized capacitor", "polarized capacitors"],
  "polarized-capacitor": ["polarized capacitor", "polarized capacitors"],
  inductor: ["inductor", "inductors"],
  led: ["LED", "LEDs"],
  diode: ["diode", "diodes"],
  zener: ["Zener diode", "Zener diodes"],
  schottky: ["Schottky diode", "Schottky diodes"],
  opamp: ["op-amp", "op-amps"],
  battery: ["battery", "batteries"],
  vsource: ["voltage source", "voltage sources"],
  "ac-source": ["AC source", "AC sources"],
  npn: ["NPN transistor", "NPN transistors"],
  pnp: ["PNP transistor", "PNP transistors"],
  nmos: ["NMOS transistor", "NMOS transistors"],
  pmos: ["PMOS transistor", "PMOS transistors"],
  potentiometer: ["potentiometer", "potentiometers"],
  spst: ["switch", "switches"],
  pushbutton: ["pushbutton", "pushbuttons"],
  relay: ["relay", "relays"],
  motor: ["motor", "motors"],
  buzzer: ["buzzer", "buzzers"],
  fuse: ["fuse", "fuses"],
  crystal: ["crystal", "crystals"],
  ic: ["IC", "ICs"],
  header: ["header", "headers"],
};

function partTypeLabel(type: string, count: number): string {
  if (type.startsWith("module:")) return plural(count, "module", "modules");
  const known = PART_TYPE_LABELS[type];
  if (known) return count === 1 ? known[0] : known[1];
  const clean = sanitize(type.replace(/_/g, " "));
  return plural(count, clean);
}

function partBreakdown(parts: readonly Part[]): string {
  const counts = new Map<string, number>();
  for (const p of parts) {
    const keyType = p.type.startsWith("module:") ? "module:*" : p.type;
    counts.set(keyType, (counts.get(keyType) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]));
  const maxItems = 5;
  const shown = sorted.slice(0, maxItems).map(([t, c]) => `${c} ${partTypeLabel(t, c)}`);
  if (sorted.length > maxItems) {
    const restCount = sorted.slice(maxItems).reduce((s, [, c]) => s + c, 0);
    shown.push(`${restCount} other ${plural(restCount, "part")}`);
  }
  return joinList(shown);
}

function describeKeyDevices(parts: readonly Part[]): string | null {
  const devices = parts
    .filter((p) => p.type === "ic" || p.type.startsWith("module:"))
    .sort((a, b) => cmpNatural(a.id, b.id))
    .map((p) => {
      const label = p.props?.partNumber ?? p.props?.label ?? p.props?.value ?? p.title;
      return label ? `${p.id} (${sanitize(label).trim()})` : p.id;
    });
  if (devices.length === 0) return null;
  const heading = devices.length === 1 ? "Key device" : "Key devices";
  return `${heading}: ${formatCappedList(devices, 6)}.`;
}

function templateName(id: string): string {
  if (id === "opamp-inverting") return "inverting op-amp stage";
  if (id === "opamp-noninverting") return "non-inverting op-amp stage";
  if (id === "opamp-integrator") return "op-amp integrator";
  if (id === "opamp-differentiator") return "op-amp differentiator";
  if (id === "opamp-lowpass") return "active inverting low-pass filter";
  if (id === "opamp-highpass") return "active inverting high-pass filter";
  if (id === "i2c-pullups") return "I2C bus with pull-up resistors";
  if (id === "voltage-divider") return "voltage divider";
  if (id === "pull-up") return "pull-up resistor";
  if (id === "pull-down") return "pull-down resistor";
  if (id === "led-series" || id === "led-series-vertical") return "series LED indicator";
  if (id.startsWith("h-bridge-")) return "H-bridge driver";
  if (id.startsWith("low-side-")) return "low-side switch";
  if (id.startsWith("diff-pair-")) return "differential pair with current-mirror load";
  if (id === "bridge-rectifier") return "full-wave bridge rectifier";
  if (id.startsWith("sallen-key-lowpass")) return "Sallen-Key low-pass filter";
  if (id.startsWith("sallen-key-highpass")) return "Sallen-Key high-pass filter";
  if (id === "npn-led-astable") return "astable LED multivibrator";
  if (id === "relaxation-oscillator") return "relaxation oscillator";
  if (id.startsWith("wien-bridge-")) return "Wien bridge oscillator";
  return sanitize(id.replace(/-/g, " "));
}

/**
 * Parse matched template identifiers from layout notes or `LayoutState.templates` entries.
 * Ignores abandoned, dropped, or non-template placement notes.
 */
function parseMatchedTemplates(notes: readonly string[], validParts: ReadonlySet<string>): string[] {
  const entries = new Map<string, { label: string; parts: string[] }>();
  for (const raw of notes) {
    const note = raw.trim();
    if (!note) continue;
    // Skip notes describing dropped, abandoned, or blocked template attempts.
    if (/\b(abandoned|dropped|skipped|left to the router)\b/i.test(note)) continue;
    // Skip decoupling placement notes (not a circuit topology template).
    if (/^decoupling@\d+:/i.test(note)) continue;

    // Match either bare `id@version:P1,P2` (from LayoutState.templates)
    // or prefixed `template: id@version:P1,P2` / `template id@version:P1,P2`.
    const m = /^(?:template[:\s]+)?([a-z0-9-]+)@\d+:([A-Za-z0-9_,-]+)$/i.exec(note);
    if (!m) continue;
    const id = m[1]!.toLowerCase();
    const parts = m[2]!
      .split(",")
      .map((s) => s.trim())
      .filter((p) => p.length > 0 && validParts.has(p))
      .sort(cmpNatural);
    const label = templateName(id);
    const dedupeKey = `${id}:${parts.join(",")}`;
    entries.set(dedupeKey, { label, parts });
  }

  return [...entries.values()]
    .sort((a, b) => cmpStr(a.label, b.label) || cmpNatural(a.parts.join(","), b.parts.join(",")))
    .map(({ label, parts }) => (parts.length > 0 ? `${label} (${parts.join(", ")})` : label));
}

function formatRail(row: NetTableRow): string {
  const label = row.domain ? `${row.name} (${row.domain})` : row.name;
  const how = row.presentation === "port" ? "ports" : "wires";
  return `${label} (${row.pins.length} ${plural(row.pins.length, "pin")}, ${how})`;
}

function summarizeSignalFlow(
  circuit: Circuit,
  pinDefs: PinDefs,
  render: RenderModel,
  rows: readonly NetTableRow[],
): string {
  const signalRows = rows.filter((r) => r.kind === "signal");
  if (signalRows.length === 0) {
    return rows.length > 0
      ? "No signal nets; all connections are on power and ground rails."
      : "No connected nets.";
  }

  // Compute each part's mean drawn position from render.electrical.pins.
  const coords = new Map<string, { sx: number; sy: number; n: number }>();
  for (const p of render.electrical.pins) {
    const cur = coords.get(p.part) ?? { sx: 0, sy: 0, n: 0 };
    cur.sx += p.at[0];
    cur.sy += p.at[1];
    cur.n += 1;
    coords.set(p.part, cur);
  }
  const posOf = (part: string): [number, number] => {
    const c = coords.get(part);
    return c && c.n > 0 ? [c.sx / c.n, c.sy / c.n] : [0, 0];
  };
  const cmpPos = (a: string, b: string) => {
    const [ax, ay] = posOf(a), [bx, by] = posOf(b);
    return ax - bx || ay - by || cmpNatural(a, b);
  };

  const partById = new Map(circuit.parts.map((p) => [p.id, p]));
  const netById = new Map(circuit.nets.map((n) => [n.id, n]));
  const roleOf = (pinId: string) => {
    const m = /^(.+)\[(.+)\]$/.exec(pinId);
    if (!m) return undefined;
    return pinDefs[m[1]!]?.find((d) => d.number === m[2])?.role;
  };

  // Build left-to-right directed signal adjacency from verified signal nets.
  const signalParts = new Set<string>();
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    if (!outgoing.has(from)) outgoing.set(from, new Set());
    if (!incoming.has(to)) incoming.set(to, new Set());
    outgoing.get(from)!.add(to);
    incoming.get(to)!.add(from);
  };

  const namedSignalNets: string[] = [];
  for (const row of signalRows) {
    const rawNet = netById.get(row.id);
    if (rawNet?.name) namedSignalNets.push(rawNet.name);
    const pins = row.pins;
    const parts = [...new Set(pins.map((id) => id.slice(0, id.indexOf("["))))].sort(cmpPos);
    for (const p of parts) signalParts.add(p);
    if (parts.length < 2) continue;

    // Identify explicit drivers (output/power_out pins or source parts) on this net.
    const drivers = new Set<string>();
    for (const pinId of pins) {
      const partId = pinId.slice(0, pinId.indexOf("["));
      const role = roleOf(pinId);
      const partType = partById.get(partId)?.type ?? "";
      if (role === "output" || role === "power_out" || BUILTIN[partType]?.kind === "source") {
        drivers.add(partId);
      }
    }

    if (drivers.size > 0 && drivers.size < parts.length) {
      for (const d of drivers) {
        for (const p of parts) if (!drivers.has(p)) addEdge(d, p);
      }
    } else {
      // Otherwise orient edges along the verified drawn left-to-right order.
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) addEdge(parts[i]!, parts[j]!);
      }
    }
  }

  const netLabel = `${signalRows.length} ${plural(signalRows.length, "signal net")}`;
  const uniqueNamed = [...new Set(namedSignalNets)].sort(cmpNatural);
  const namedSuffix = uniqueNamed.length > 0
    ? (uniqueNamed.length === signalRows.length && uniqueNamed.length <= 4
      ? ` (${joinList(uniqueNamed)})`
      : ` (including ${formatCappedList(uniqueNamed, 4)})`)
    : "";

  const ordered = [...signalParts].sort(cmpPos);
  if (ordered.length === 0) return `Signal connections span ${netLabel}${namedSuffix}.`;
  if (ordered.length === 1) return `Signal connections span ${netLabel}${namedSuffix} on ${ordered[0]}.`;

  const starts = ordered.filter((p) => (incoming.get(p)?.size ?? 0) === 0);
  const ends = ordered.filter((p) => (outgoing.get(p)?.size ?? 0) === 0 && !starts.includes(p));
  const startList = starts.length > 0 ? starts : [ordered[0]!];
  const endList = ends.length > 0 ? ends : [ordered[ordered.length - 1]!].filter((p) => !startList.includes(p));
  const startSet = new Set(startList);
  const endSet = new Set(endList);
  const middle = ordered.filter((p) => !startSet.has(p) && !endSet.has(p));

  if (endList.length === 0) {
    return `Signal flow from left to right across ${netLabel}${namedSuffix} connects ${formatCappedList(ordered, 6)}.`;
  }
  if (middle.length === 0) {
    return `Signal flow from left to right across ${netLabel}${namedSuffix}: from ${formatCappedList(startList, 4)} to ${formatCappedList(endList, 4)}.`;
  }
  return `Signal flow from left to right across ${netLabel}${namedSuffix}: from ${formatCappedList(startList, 4)} through ${formatCappedList(middle, 5)} to ${formatCappedList(endList, 4)}.`;
}

function formatCappedList(items: readonly string[], max: number): string {
  if (items.length <= max) return joinList(items);
  const kept = items.slice(0, max);
  const more = items.length - max;
  return `${kept.join(", ")}, and ${more} more`;
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
