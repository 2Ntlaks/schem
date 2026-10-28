// tscircuit baseline: build a tscircuit circuit from one neutral netlist and draw its schematic.
//
// Usage: node baselines/scripts/tscircuit_draw.mjs <netlist.json> <attempt-K.config.json> <out-dir> <K>
// Writes <out-dir>/attempt-K.input.json (the tscircuit circuit JSON plus the pin map used by the check),
// attempt-K.svg, attempt-K.png and attempt-K.check.txt (the connections read back from the schematic part of
// the circuit JSON, compared with the case).
//
// tscircuit is installed outside this repo. Point SCHEM_BASELINES at its parent folder (default
// $HOME/schem-baselines). The packages and exact API calls are recorded in baselines/VERSIONS.md.
//
// Conversion rules (attempt 1; a config file can change per-part settings for a revision, see README):
// - built-in parts use tscircuit's own schematic symbols: resistor, capacitor, polarised-capacitor, inductor,
//   diode, LED, battery, voltage source, NPN/PNP transistor, N-MOSFET/P-MOSFET, op-amp and crystal;
// - every other part type (header, IC, module, relay, motor, and any unknown type) becomes a tscircuit
//   <chip> box labelled with its reference and value/type, showing only the pins that appear in a net or in
//   the netlist's nc list. Each pin keeps its real name; a name that repeats on the same box is made unique by
//   appending the pin number (for example GND_4 and GND_22). A numeric case pin number is also the chip's pin
//   number, so the box shows the real package number (an ATtiny's VCC pin is 8, not its position in the used
//   set); a pin whose number is not a positive integer (relay A1, module J2-1) takes the lowest free number
//   and keeps its real name as the label. Pins are placed in the order they appear in the netlist: the first
//   half on the left, the second half on the right, so the numbers run counter-clockwise like a DIP package.
//   This is the only pin-side/order setting used; no coordinate or trace path is set;
// - two-terminal passives are drawn horizontally (the tool-wide default, chosen on the neutral circuits); a
//   config can set any part's orientation or rotation, or a chip box's width and height;
// - power and ground nets are expressed as tscircuit <net> elements. tscircuit draws a rail symbol at every
//   pin that is otherwise unconnected, and the rail symbols are joined by their net name. This is the
//   schematic convention for supplies and keeps long supply wires off the drawing;
// - every other net is drawn as tscircuit <trace> elements between pins. A net with more than two pins is a
//   star: one trace from the pin whose part has the most net memberships to each of the other pins. No
//   coordinates or trace paths are given; tscircuit's own schematic router lays the wires out;
// - net names are shown on signal traces when the netlist names the net, and on every supply rail. tscircuit
//   ends a short wire at a named net label instead of drawing a long wire across the sheet, so the label name
//   is the drawn connection (the check joins same-named labels).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rasterize } from "./rasterize.mjs";

const BASE = process.env.SCHEM_BASELINES ?? join(homedir(), "schem-baselines");
const TSCIRCUIT = join(BASE, "tscircuit");
const CORE_PATH = join(TSCIRCUIT, "node_modules", "@tscircuit", "core", "dist", "index.js");
const C2S_PATH = join(TSCIRCUIT, "node_modules", "circuit-to-svg", "dist", "index.js");
if (!existsSync(CORE_PATH) || !existsSync(C2S_PATH)) {
  throw new Error(
    `tscircuit is not installed at ${TSCIRCUIT}. Install @tscircuit/core and circuit-to-svg there (see baselines/VERSIONS.md).`,
  );
}
const core = await import(pathToFileURL(CORE_PATH).href);
const { convertCircuitJsonToSchematicSvg } = await import(pathToFileURL(C2S_PATH).href);
const {
  Circuit,
  Board,
  Resistor,
  Capacitor,
  Inductor,
  Diode,
  Led,
  Battery,
  VoltageSource,
  Transistor,
  Mosfet,
  OpAmp,
  Crystal,
  Chip,
  Trace,
  Net,
} = core;

// Case pin number -> tscircuit pin number (1-based, the order in which the pins are declared).
// A pin not listed here has no tscircuit representation.
const BUILTIN = {
  resistor: {
    make: (p, o) =>
      new Resistor({ name: p.id, resistance: text(p.props.value ?? p.label) || "1k", ...ori(o) }),
    pins: { 1: 1, 2: 2 },
  },
  capacitor: {
    make: (p, o) =>
      new Capacitor({ name: p.id, capacitance: text(p.props.value ?? p.label) || "1u", ...ori(o) }),
    pins: { 1: 1, 2: 2 },
  },
  "polarised-capacitor": {
    make: (p, o) =>
      new Capacitor({
        name: p.id,
        capacitance: text(p.props.value ?? p.label) || "1u",
        polarized: true,
        ...ori(o),
      }),
    pins: { "+": 1, "-": 2 },
  },
  inductor: {
    make: (p, o) =>
      new Inductor({ name: p.id, inductance: text(p.props.value ?? p.label) || "1u", ...ori(o) }),
    pins: { 1: 1, 2: 2 },
  },
  diode: {
    make: (p, o) =>
      new Diode({ name: p.id, variant: p.props.variant ?? "standard", ...ori(o) }),
    pins: { A: 1, K: 2 },
  },
  led: {
    make: (p, o) => new Led({ name: p.id, color: p.props.color ?? "red", ...ori(o) }),
    pins: { A: 1, K: 2 },
  },
  battery: {
    make: (p, o) =>
      new Battery({ name: p.id, voltage: text(p.props.value ?? p.label) || "9V", ...ori(o) }),
    pins: { "+": 1, "-": 2 },
  },
  vsource: {
    make: (p) =>
      new VoltageSource({
        name: p.id,
        voltage: text(p.props.value ?? p.label) || "1V",
        ...(p.props.frequency ? { frequency: text(p.props.frequency) } : {}),
      }),
    pins: { "+": 1, "-": 2 },
  },
  npn: {
    make: (p) =>
      new Transistor({
        name: p.id,
        type: "npn",
        pinLabels: { pin1: "collector", pin2: "base", pin3: "emitter" },
      }),
    pins: { B: 2, C: 1, E: 3 },
  },
  pnp: {
    make: (p) =>
      new Transistor({
        name: p.id,
        type: "pnp",
        pinLabels: { pin1: "collector", pin2: "base", pin3: "emitter" },
      }),
    pins: { B: 2, C: 1, E: 3 },
  },
  nmos: {
    make: (p) =>
      new Mosfet({ name: p.id, channelType: "n", mosfetMode: "enhancement" }),
    pins: { G: 3, D: 1, S: 2 },
  },
  pmos: {
    make: (p) =>
      new Mosfet({ name: p.id, channelType: "p", mosfetMode: "enhancement" }),
    pins: { G: 3, D: 1, S: 2 },
  },
  opamp: {
    make: (p) => new OpAmp({ name: p.id }),
    // case IN- -> tscircuit inverting input, IN+ -> non-inverting input, OUT -> output
    pins: { 2: 2, 3: 1, 1: 3 },
  },
  crystal: {
    make: (p, o) =>
      new Crystal({
        name: p.id,
        frequency: text(p.props.value ?? p.label) || "8MHz",
        loadCapacitance: text(p.props.loadCapacitance) || "18pF",
        ...ori(o),
      }),
    pins: { 1: 1, 2: 2 },
  },
};

// Per-part schematic orientation, when the netlist or the attempt config asks for one.
function ori(o) {
  return o.orientation ? { schOrientation: o.orientation } : {};
}

function text(v) {
  return v === undefined || v === null ? "" : String(v);
}

function partValue(p) {
  return (
    text(p.moduleName) ||
    text(p.props.label) ||
    text(p.props.partNumber) ||
    text(p.props.value) ||
    text(p.label) ||
    text(p.type)
  );
}

// Make a pin name safe for a tscircuit pin label: keep letters, digits, + - _ . and replace the rest.
function sanitize(name, fallback) {
  let s = text(name)
    .trim()
    .replace(/[^A-Za-z0-9+_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) s = text(fallback).trim().replace(/[^A-Za-z0-9+_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "pin";
}

function uniqueLabels(pins) {
  const seen = new Map();
  const names = pins.map((pin) => sanitize(pin.name, pin.number));
  const dup = new Map();
  for (const name of names) dup.set(name, (dup.get(name) ?? 0) + 1);
  return pins.map((pin, i) => {
    let label = names[i];
    if (dup.get(label) > 1) label = `${label}_${sanitize(pin.number, i + 1)}`;
    let n = 1;
    const base = label;
    while (seen.has(label)) label = `${base}_${++n}`;
    seen.set(label, true);
    return label;
  });
}

function main() {
  const [netlistPath, configPath, outDir, k] = process.argv.slice(2);
  if (!netlistPath || !configPath || !outDir || !k) {
    throw new Error("usage: tscircuit_draw.mjs <netlist.json> <attempt-K.config.json> <out-dir> <K>");
  }
  const nl = JSON.parse(readFileSync(netlistPath, "utf8"));
  const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  mkdirSync(outDir, { recursive: true });

  const ov = cfg.parts ?? {};
  const boardW = cfg.board?.width ?? "200mm";
  const boardH = cfg.board?.height ?? "150mm";
  const signalTopology = cfg.signalTopology ?? "star"; // "star" or "chain"
  const signalNetLabels = cfg.signalNetLabels ?? true; // print the net name on signal traces
  const signalElements = cfg.signalElements ?? "trace"; // "trace" edges or one tscircuit <net> per signal net
  // Tool-wide orientation: two-terminal passives lie horizontally, which tscircuit's own layout packs without
  // overlaps and which keeps their value text and net labels off the wires (chosen on the neutral circuits).
  const orientations = cfg.orientations ?? {
    resistor: "horizontal",
    capacitor: "horizontal",
    "polarised-capacitor": "horizontal",
    inductor: "horizontal",
  };
  const supplyKinds = new Set(cfg.supplyKinds ?? ["power", "ground"]);
  const chipSize = cfg.chip ?? {}; // tool-wide chip box size (schematic units)

  // Pins that are mentioned by a net or by the nc list. Other pins are not drawn on a chip box, the same
  // rule the netlistsvg baseline uses for its generic boxes.
  const used = {};
  for (const n of nl.nets) for (const m of n.members) (used[m.part] ??= new Set()).add(m.pin);
  for (const e of nl.nc ?? []) (used[e.part] ??= new Set()).add(e.pin);

  // How many nets each part takes part in, used only to choose the star centre of a multi-pin net.
  const degree = {};
  for (const n of nl.nets) for (const m of n.members) degree[m.part] = (degree[m.part] ?? 0) + 1;

  const circuit = new Circuit();
  const board = new Board({ width: boardW, height: boardH });
  circuit.add(board);

  const pinMap = {}; // ref -> { tscircuit pin number: case pin number }
  const selector = {}; // "ref\u0000casePin" -> "ref.pinN"

  for (const p of nl.parts) {
    const o = {
      ...(ov[p.id] ?? {}),
      orientation:
        ov[p.id]?.orientation ?? orientations[p.type] ?? p.props.schOrientation,
    };
    const builtin = o.generic ? undefined : BUILTIN[p.type];
    let comp;
    let shown;

    if (builtin) {
      comp = builtin.make(p, o);
      shown = p.pins;
      // built-in symbols have their own pin names; map case pins to pin ordinals
      for (const pin of shown) {
        const ordinal = builtin.pins[pin.number];
        if (!ordinal) {
          throw new Error(`${p.id}: no tscircuit pin for case pin ${pin.number} on a ${p.type}`);
        }
        (pinMap[p.id] ??= {})[ordinal] = pin.number;
        selector[`${p.id}\u0000${pin.number}`] = `${p.id}.pin${ordinal}`;
      }
    } else {
      shown = p.pins.filter((pin) => used[p.id]?.has(pin.number));
      if (shown.length === 0) shown = p.pins.slice(0, Math.min(p.pins.length, 2));
      const labels = uniqueLabels(shown);
      // A numeric pin number becomes the chip's pin number, so the box shows the real package number (for an
      // ATtiny the VCC pin is 8, not its position in the used set). Pins whose number is not a positive integer
      // (relay A1, module J2-1) take the lowest free numbers instead; their real name is still shown as the label.
      const usedOrdinals = new Set();
      const ordinals = shown.map((pin) => {
        const num = text(pin.number).trim();
        if (/^[1-9]\d*$/.test(num) && !usedOrdinals.has(Number(num))) {
          usedOrdinals.add(Number(num));
          return Number(num);
        }
        return null;
      });
      let next = 1;
      for (let i = 0; i < ordinals.length; i++) {
        if (ordinals[i] !== null) continue;
        while (usedOrdinals.has(next)) next++;
        ordinals[i] = next;
        usedOrdinals.add(next);
      }
      const pinLabels = Object.fromEntries(
        labels.map((label, i) => [`pin${ordinals[i]}`, label]),
      );
      const n = shown.length;
      const leftCount = n <= 3 ? n : Math.ceil(n / 2);
      const left = ordinals.slice(0, leftCount);
      const right = ordinals.slice(leftCount);
      const schPinArrangement = {
        leftSide: { pins: left, direction: "top-to-bottom" },
        ...(right.length ? { rightSide: { pins: right, direction: "bottom-to-top" } } : {}),
      };
      const value = partValue(p);
      const chipWidth = o.schWidth ?? chipSize.width;
      const chipHeight = o.schHeight ?? chipSize.height;
      const props = {
        name: p.id,
        manufacturerPartNumber: value,
        pinLabels,
        schPinArrangement,
        ...(chipWidth ? { schWidth: chipWidth } : {}),
        ...(chipHeight ? { schHeight: chipHeight } : {}),
        ...(o.rotation !== undefined ? { schRotation: o.rotation } : {}),
      };
      comp = new Chip(props);
      shown.forEach((pin, i) => {
        (pinMap[p.id] ??= {})[ordinals[i]] = pin.number;
        selector[`${p.id}\u0000${pin.number}`] = `${p.id}.pin${ordinals[i]}`;
      });
    }

    if (o.rotation !== undefined && builtin) comp.schRotation = o.rotation;
    board.add(comp);
  }

  // Supplies: a tscircuit <net> per named power/ground net. tscircuit draws a rail at each pin that is not
  // otherwise wired and joins same-named rails, which is how the check reads them back.
  for (const n of nl.nets) {
    if (!(supplyKinds.has(n.kind) && n.name)) continue;
    const connectsTo = n.members.map((m) => selector[`${m.part}\u0000${m.pin}`]);
    if (connectsTo.some((s) => !s)) {
      throw new Error(`net ${n.id} (${n.name}): a member has no tscircuit pin`);
    }
    board.add(
      new Net({
        name: n.name,
        connectsTo,
        isPowerNet: n.kind === "power",
        isGroundNet: n.kind === "ground",
      }),
    );
  }

  // Signal nets: one trace per edge. The star centre is the member whose part has the most net memberships.
  for (const n of nl.nets) {
    if (supplyKinds.has(n.kind) && n.name) continue;
    const members = n.members.map((m) => {
      const sel = selector[`${m.part}\u0000${m.pin}`];
      if (!sel) throw new Error(`net ${n.id}: ${m.part}[${m.pin}] has no tscircuit pin`);
      return { ...m, sel };
    });
    if (members.length < 2) continue;
    if (signalElements === "net") {
      board.add(new Net({ name: n.name || undefined, connectsTo: members.map((m) => m.sel) }));
      continue;
    }
    const traceName = signalNetLabels && n.name ? { name: n.name } : {};
    if (signalTopology === "chain") {
      for (let i = 1; i < members.length; i++) {
        board.add(new Trace({ ...traceName, from: members[i - 1].sel, to: members[i].sel }));
      }
    } else {
      let hub = 0;
      for (let i = 1; i < members.length; i++) {
        const a = degree[members[i].part] ?? 0;
        const b = degree[members[hub].part] ?? 0;
        if (a > b) hub = i;
      }
      for (let i = 0; i < members.length; i++) {
        if (i === hub) continue;
        board.add(new Trace({ ...traceName, from: members[hub].sel, to: members[i].sel }));
      }
    }
  }

  const circuitJson = circuit.getCircuitJson();
  const input = {
    generator: "baselines/scripts/tscircuit_draw.mjs",
    packages: { "@tscircuit/core": "0.0.2229", "circuit-to-svg": "0.0.454" },
    netlist: netlistPath,
    pinMap,
    circuitJson,
  };
  const inputPath = join(outDir, `attempt-${k}.input.json`);
  writeFileSync(inputPath, JSON.stringify(input, null, 1));

  const svgPath = join(outDir, `attempt-${k}.svg`);
  writeFileSync(svgPath, convertCircuitJsonToSchematicSvg(circuitJson));
  rasterize(svgPath, join(outDir, `attempt-${k}.png`));

  const check = connectionCheck(nl, input);
  writeFileSync(join(outDir, `attempt-${k}.check.txt`), check.lines.join("\n") + "\n");
  console.log(`check: ${check.pass ? "PASS" : "FAIL"}`);
  if (!check.pass) {
    console.log(check.lines.filter((l) => !/: OK /.test(l) && l !== "RESULT FAIL").join("\n"));
  }
}

// ---- the connection check -------------------------------------------------------------------------------
// Read the schematic layer only: schematic ports, schematic traces (their edges and junctions) and schematic
// net labels joined by name. Source ports are used only to turn a schematic port back into a case pin; the
// netlist is used only for the expected groups and the pin names. No connection is read from the input.
function connectionCheck(nl, input) {
  const cj = input.circuitJson;
  const pinMap = input.pinMap;
  const sourceComponents = Object.fromEntries(
    cj.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e.name]),
  );
  const sourcePorts = Object.fromEntries(
    cj.filter((e) => e.type === "source_port").map((e) => [e.source_port_id, e]),
  );
  const schematicPorts = cj.filter((e) => e.type === "schematic_port");
  const traces = cj.filter((e) => e.type === "schematic_trace");
  const labels = cj.filter((e) => e.type === "schematic_net_label");

  const EPS = 1e-4;
  const RAIL_STEM = 0.2;
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) {
      const next = parent.get(x);
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const key = (p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const point = (p) => {
    const k = key(p);
    find(k);
    return k;
  };
  const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS;
  const onSegment = (p, a, b) => {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) > EPS) return false;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (len2 < EPS) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    return dot >= -EPS && dot <= len2 + EPS;
  };

  const tracePoints = [];
  for (const t of traces) {
    const pts = [];
    for (const e of t.edges ?? []) {
      for (const p of [e.from, e.to]) {
        if (pts.length === 0 || !same(pts[pts.length - 1], p)) pts.push(p);
      }
    }
    for (let i = 0; i < pts.length; i++) point(pts[i]);
    for (let i = 1; i < pts.length; i++) union(key(pts[i - 1]), key(pts[i]));
    for (const j of t.junctions ?? []) {
      const jk = point(j);
      for (let i = 1; i < pts.length; i++) {
        if (onSegment(j, pts[i - 1], pts[i])) union(jk, key(pts[i - 1]));
      }
    }
    tracePoints.push({ trace: t, pts });
  }

  const portKey = {};
  for (const p of schematicPorts) {
    const pk = point(p.center);
    portKey[p.schematic_port_id] = pk;
    for (const { trace, pts } of tracePoints) {
      // a port connects only at a vertex or a junction, not where a wire merely crosses it
      for (let i = 0; i < pts.length; i++) {
        if (same(p.center, pts[i])) union(pk, key(pts[i]));
      }
      for (const j of trace.junctions ?? []) {
        if (same(p.center, j)) union(pk, key(j));
      }
    }
  }

  const labelKey = {};
  for (const l of labels) {
    const anchor = l.anchor_position;
    if (!anchor) continue;
    const lk = point(anchor);
    labelKey[l.schematic_net_label_id] = lk;
    // A rail symbol has a 0.2 long lead ending away from its text. The lead is part of the drawn symbol, so
    // either end of it can be the electrical contact.
    let stem = anchor;
    if (l.symbol_name && /^rail_/.test(l.symbol_name)) {
      const d = RAIL_STEM;
      stem =
        l.anchor_side === "top"
          ? { x: anchor.x, y: anchor.y + d }
          : l.anchor_side === "bottom"
            ? { x: anchor.x, y: anchor.y - d }
            : l.anchor_side === "left"
              ? { x: anchor.x + d, y: anchor.y }
              : l.anchor_side === "right"
                ? { x: anchor.x - d, y: anchor.y }
                : anchor;
      union(lk, point(stem));
    }
    for (const p of schematicPorts) {
      if (same(anchor, p.center) || same(stem, p.center)) union(lk, portKey[p.schematic_port_id]);
    }
    for (const { pts } of tracePoints) {
      for (let i = 1; i < pts.length; i++) {
        if (onSegment(anchor, pts[i - 1], pts[i]) || onSegment(stem, pts[i - 1], pts[i])) {
          union(lk, key(pts[i - 1]));
        }
      }
    }
  }

  // Same-named net labels are one net. tscircuit's schematic convention is to end a short wire at a named net
  // label rather than route a long wire across the sheet, so the label name is the drawn connection. A pin
  // that gets neither a wire nor a label stays alone and is reported as missing.
  const byText = {};
  for (const l of labels) {
    if (!labelKey[l.schematic_net_label_id]) continue;
    (byText[l.text] ??= []).push(labelKey[l.schematic_net_label_id]);
  }
  for (const ks of Object.values(byText)) {
    for (let i = 1; i < ks.length; i++) union(ks[0], ks[i]);
  }

  const casePinOf = (p) => {
    const sp = sourcePorts[p.source_port_id];
    if (!sp) return null;
    const ref = sourceComponents[sp.source_component_id];
    const casePin = pinMap[ref]?.[String(sp.pin_number)];
    return casePin === undefined ? null : { ref, pin: casePin };
  };

  const groups = new Map();
  const portCasePin = {};
  for (const p of schematicPorts) {
    const cp = casePinOf(p);
    if (!cp) continue;
    const id = `${cp.ref}[${cp.pin}]`;
    portCasePin[p.schematic_port_id] = id;
    const g = find(portKey[p.schematic_port_id]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(id);
  }
  for (const g of groups.values()) g.sort();

  const ncSet = new Set((nl.nc ?? []).map((e) => `${e.part}[${e.pin}]`));
  const caseSets = nl.nets.map((n) => n.members.map((m) => `${m.part}[${m.pin}]`).sort());
  const allCasePins = new Set([...caseSets.flat(), ...ncSet]);
  const lines = [];
  let pass = true;

  for (const [i, n] of nl.nets.entries()) {
    const want = caseSets[i];
    const first = want[0];
    let got = [];
    for (const g of groups.values()) if (g.includes(first)) { got = g; break; }
    const good = JSON.stringify(got) === JSON.stringify(want);
    pass &&= good;
    lines.push(
      `${n.id} ${n.name ?? "(unnamed)"}: ${good ? "OK" : "MISSING"} want=${JSON.stringify(want)} got=${JSON.stringify(got)}`,
    );
  }

  // ports tscircuit drew that are not in the case at all
  for (const p of schematicPorts) {
    const cp = casePinOf(p);
    if (!cp) {
      pass = false;
      lines.push(`EXTRA port ${p.schematic_port_id} (${p.display_pin_label ?? "?"}) not in the case`);
      continue;
    }
    const id = `${cp.ref}[${cp.pin}]`;
    if (!allCasePins.has(id)) {
      pass = false;
      lines.push(`EXTRA port ${id} not in the case`);
      continue;
    }
    if (ncSet.has(id)) {
      const g = groups.get(find(portKey[p.schematic_port_id])) ?? [];
      if (g.length > 1) {
        pass = false;
        lines.push(`EXTRA connected nc pin ${id} got=${JSON.stringify(g)}`);
      }
    }
  }

  // an unconnected case pin that is not marked nc
  for (const g of groups.values()) {
    if (g.length === 1 && !ncSet.has(g[0]) && !caseSets.some((s) => s.length === 1 && s[0] === g[0])) {
      pass = false;
      lines.push(`EXTRA unconnected port ${g[0]}`);
    }
  }

  lines.push(`RESULT ${pass ? "PASS" : "FAIL"}`);
  return { pass, lines };
}

main();
