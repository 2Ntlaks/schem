// netlistsvg baseline: convert one case's netlist to netlistsvg's input (Yosys JSON) and draw it with the
// analog skin that ships with netlistsvg 1.0.2 (lib/analog.svg, unmodified).
//
// Usage: node baselines/scripts/netlistsvg_draw.mjs <netlist.json> <attempt-K.config.json> <out-dir> <K>
// Writes <out-dir>/attempt-K.netlistsvg.json (the input), attempt-K.svg, attempt-K.png and attempt-K.check.txt
// (the connections in the input, with same-named power symbols joined, compared with the case).
//
// Conversion rules (attempt 1; a config file can change them per case, see README):
// - parts with a symbol in the analog skin use it (r_v, c_v, d_v, d_led_v, v, q_npn, q_pnp, op); every other
//   part is a "generic" box whose label is "<ref> <value>" and whose ports are the pins in a net or marked nc;
// - power and ground nets are split: every pin on them gets its own vcc / gnd / vee symbol named after the net,
//   the way netlistsvg's own analog examples draw supplies; signal nets are one hyperedge each;
// - port directions follow the netlist's chain direction (in -> "input", out -> "output"), since ELK lays the
//   graph out top-down from outputs to inputs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rasterize } from "./rasterize.mjs";

const BASE = process.env.SCHEM_BASELINES ?? join(homedir(), "schem-baselines");
const NSVG = join(BASE, "netlistsvg", "node_modules", "netlistsvg");
const SKIN = join(NSVG, "lib", "analog.svg");

// case type -> [skin type, {case pin: skin port}, {skin port: direction}]
const SKIN_MAP = {
  resistor: ["r_v", { 1: "A", 2: "B" }, { A: "input", B: "output" }],
  capacitor: ["c_v", { 1: "A", 2: "B" }, { A: "input", B: "output" }],
  "polarised-capacitor": ["c_v", { "+": "A", "-": "B" }, { A: "input", B: "output" }],
  led: ["d_led_v", { A: "+", K: "-" }, { "+": "input", "-": "output" }],
  diode: ["d_v", { A: "+", K: "-" }, { "+": "input", "-": "output" }],
  battery: ["v", { "+": "+", "-": "-" }, { "+": "output", "-": "input" }],
  vsource: ["v", { "+": "+", "-": "-" }, { "+": "output", "-": "input" }],
  npn: ["q_npn", { B: "B", C: "C", E: "E" }, { B: "input", C: "input", E: "output" }],
  pnp: ["q_pnp", { B: "B", C: "C", E: "E" }, { B: "input", C: "input", E: "output" }],
  opamp: ["op", { 3: "+", 2: "-", 1: "OUT" }, { "+": "input", "-": "input", OUT: "output" }],
};

function main() {
  const [netlistPath, configPath, outDir, k] = process.argv.slice(2);
  const nl = JSON.parse(readFileSync(netlistPath, "utf8"));
  const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  mkdirSync(outDir, { recursive: true });
  const ov = cfg.parts ?? {};
  const splitKinds = new Set(cfg.splitKinds ?? ["power", "ground"]);
  const noSplit = new Set(cfg.noSplitNets ?? []);
  const symbolOf = (net) => (cfg.symbolOf?.[net.name]) ?? (net.kind === "ground" ? "gnd" : /^-/.test(net.name ?? "") ? "vee" : "vcc");

  const used = {};
  for (const n of nl.nets) for (const m of n.members) (used[m.part] ??= new Set()).add(m.pin);
  for (const e of nl.nc) (used[e.part] ??= new Set()).add(e.pin);

  const cells = {};
  const portOf = {}; // part -> {case pin: port}
  for (const p of nl.parts) {
    const o = ov[p.id] ?? {};
    const sm = !o.generic && SKIN_MAP[p.type];
    if (sm) {
      const [type, pm, dirs] = sm;
      const t = o.type ?? type;
      let value = o.value ?? p.label;
      if (p.type === "polarised-capacitor") value = `${value} (+ top)`;
      cells[p.id] = { type: t, port_directions: { ...dirs, ...(o.dirs ?? {}) }, connections: {}, attributes: { value, ...(o.attributes ?? {}) } };
      portOf[p.id] = Object.fromEntries(Object.entries(pm).map(([a, b]) => [String(a), b]));
    } else {
      const pinfo = Object.fromEntries(p.pins.map((q) => [q.number, q]));
      const show = o.pins ?? p.pins.map((q) => q.number).filter((n) => used[p.id]?.has(n));
      const dirs = {};
      const pm = {};
      for (const n of show) {
        const q = pinfo[n];
        // port label: the pin name, plus the number when the name alone is ambiguous on this part
        const dup = p.pins.filter((x) => x.name === q.name && show.includes(x.number)).length > 1;
        let port = dup || /^\d+$/.test(q.name) ? `${q.name === n ? n : `${q.name} (${n})`}` : q.name;
        pm[n] = port;
        const d = o.dirs?.[n] ?? (["input", "power_in", "ground"].includes(q.role) ? "input" : "output");
        dirs[port] = d;
      }
      const what = p.moduleName ?? p.props.label ?? p.props.partNumber ?? p.props.value ?? p.type;
      const extra = p.moduleName || !p.props.partNumber || what === p.props.partNumber ? "" : ` ${p.props.partNumber}`;
      cells[p.id] = { type: o.title ?? `${p.id} ${what}${extra}`, port_directions: dirs, connections: {}, attributes: { ...(o.attributes ?? {}) } };
      portOf[p.id] = pm;
    }
  }

  let bit = 2;
  const bitNames = {};
  const symbols = [];
  for (const n of nl.nets) {
    const split = n.name && splitKinds.has(n.kind) && !noSplit.has(n.name);
    if (split) {
      n.members.forEach((m, i) => {
        const b = bit++;
        cells[m.part].connections[portOf[m.part][m.pin]] = [b];
        const sym = symbolOf(n);
        const key = `${n.name}~${i + 1}`;
        cells[key] = { type: sym, port_directions: { A: sym === "gnd" ? "input" : sym === "vee" ? "input" : "output" }, connections: { A: [b] }, attributes: { name: n.name } };
        symbols.push(key);
        bitNames[b] = n.id;
      });
    } else {
      const b = bit++;
      for (const m of n.members) cells[m.part].connections[portOf[m.part][m.pin]] = [b];
      bitNames[b] = n.id;
    }
  }
  // no-connect pins: a bit of their own, so the port is drawn unconnected
  for (const e of nl.nc) cells[e.part].connections[portOf[e.part][e.pin]] = [bit++];
  // every port of a generic box needs a connection entry
  for (const c of Object.values(cells)) for (const p of Object.keys(c.port_directions)) c.connections[p] ??= [bit++];

  const yosys = { modules: { [`case${String(nl.case).padStart(2, "0")}`]: { ports: {}, cells } } };
  const inPath = join(outDir, `attempt-${k}.netlistsvg.json`);
  writeFileSync(inPath, JSON.stringify(yosys, null, 1));
  const svgPath = join(outDir, `attempt-${k}.svg`);
  execFileSync(process.execPath, [join(NSVG, "bin", "netlistsvg.js"), inPath, "-o", svgPath, "--skin", SKIN], { stdio: "inherit" });
  rasterize(svgPath, join(outDir, `attempt-${k}.png`));

  // ---- connection check: bits joined through same-named supply symbols, mapped back to case pins
  const parent = {};
  const find = (x) => (parent[x] === undefined || parent[x] === x ? (parent[x] = x) : (parent[x] = find(parent[x])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const byName = {};
  for (const key of symbols) { const c = cells[key]; const nm = `${c.type}:${c.attributes.name}`; if (byName[nm] !== undefined) union(c.connections.A[0], byName[nm]); else byName[nm] = c.connections.A[0]; }
  const groups = {};
  const back = Object.fromEntries(Object.entries(portOf).map(([pid, pm]) => [pid, Object.fromEntries(Object.entries(pm).map(([a, b]) => [b, a]))]));
  for (const [pid, pm] of Object.entries(portOf)) for (const port of Object.values(pm)) {
    const b = cells[pid].connections[port][0];
    (groups[find(b)] ??= []).push(`${pid}[${back[pid][port]}]`);
  }
  const svg = readFileSync(svgPath, "utf8");
  const lines = [];
  let ok = true;
  const ncSet = new Set(nl.nc.map((e) => `${e.part}[${e.pin}]`));
  const caseSets = nl.nets.map((n) => n.members.map((m) => `${m.part}[${m.pin}]`).sort());
  for (const [i, n] of nl.nets.entries()) {
    const want = caseSets[i];
    const g = Object.values(groups).find((x) => x.includes(want[0])).slice().sort();
    const good = JSON.stringify(g) === JSON.stringify(want);
    ok &&= good;
    lines.push(`${n.id} ${n.name ?? "(unnamed)"}: ${good ? "OK" : "MISMATCH"} want=${JSON.stringify(want)} got=${JSON.stringify(g)}`);
  }
  for (const g of Object.values(groups)) if (g.length === 1 && !ncSet.has(g[0]) && !caseSets.some((s) => s.includes(g[0]))) { ok = false; lines.push(`EXTRA unconnected port ${g[0]}`); }
  for (const key of Object.keys(cells)) if (!svg.includes(`cell_${key}`)) { ok = false; lines.push(`MISSING in SVG: cell ${key}`); }
  lines.push(`RESULT ${ok ? "PASS" : "FAIL"}`);
  writeFileSync(join(outDir, `attempt-${k}.check.txt`), lines.join("\n") + "\n");
  console.log(`check: ${ok ? "PASS" : "FAIL"}`);
}

main();
