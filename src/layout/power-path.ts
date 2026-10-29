// Series power path (SPEC 9.2 step 3).
//
// A fuse, switch, series diode, series inductor, regulator, or high-side
// transistor that sits between two different supply nets is part of the
// current path. Those pins are drawn with wires, so the path stays visible.
// Supply symbols stay on the other pins of the net (the loads). A supply net
// with only path pins and sources is drawn entirely as a wire, even when it
// has three or more endpoints.
//
// A diode or inductor with one pin on a signal or ground net is not on this
// path. A flyback diode stays a diode. Ground nets are left as they are.

import { cmpStr } from "../geom/geom.js";
import { canonical, netKind, type Circuit, type PinDefs } from "../core/model.js";
import { groupRepresentative, type ValidCircuit } from "../core/validate.js";
import { BUILTIN } from "../symbols/library.js";

/** Two-pin parts that are a series power path on their own. */
const SWITCH = new Set(["fuse", "spst", "pushbutton"]);
/** Two-pin parts that count only when both pins already sit on supply nets. */
const SERIES = new Set(["diode", "inductor"]);

/**
 * Channel pins of a transistor used as a high-side switch.
 * `supply` is the pin on the incoming rail. `switched` is the pin on the outgoing rail.
 */
const HIGH_SIDE: Record<string, { supply: string; switched: string }> = {
  pnp: { supply: "E", switched: "C" },
  pmos: { supply: "S", switched: "D" },
  npn: { supply: "C", switched: "E" },
  nmos: { supply: "D", switched: "S" },
};

export interface PowerPath {
  /** Supply nets drawn only as wires. They have path pins and no load pins. */
  wireNets: ReadonlySet<string>;
  /** "PART[pin]" pins on a port net that continue the path. They are routed, not given a supply symbol. */
  continuePins: ReadonlySet<string>;
  /** Those pins grouped by net id. Absent for a net that is drawn only as a wire. */
  continueByNet: ReadonlyMap<string, ReadonlySet<string>>;
  notes: readonly string[];
}

const EMPTY: PowerPath = { wireNets: new Set(), continuePins: new Set(), continueByNet: new Map(), notes: [] };

/** Which supply nets and pins belong to a series power path. */
export function powerPath(circuit: Circuit, defs: PinDefs, vc: ValidCircuit): PowerPath {
  const netOf = pinNets(defs, vc);
  const kindOf = new Map(circuit.nets.map((n) => [n.id, netKind(n)]));
  const isPower = (net: string | undefined): net is string => net !== undefined && kindOf.get(net) === "power";

  interface Link { part: string; pins: [string, string]; nets: [string, string] }
  const links: Link[] = [];
  const consider = (part: string, a: string, b: string) => {
    const na = netOf.get(`${part}[${a}]`), nb = netOf.get(`${part}[${b}]`);
    if (!isPower(na) || !isPower(nb) || na === nb) return;
    links.push({ part, pins: [a, b], nets: [na, nb] });
  };

  for (const part of [...circuit.parts].sort((a, b) => cmpStr(a.id, b.id))) {
    const pins = defs[part.id] ?? [];
    if ((SWITCH.has(part.type) || SERIES.has(part.type)) && pins.length === 2) {
      consider(part.id, pins[0]!.number, pins[1]!.number);
      continue;
    }
    const inn = pins.filter((p) => p.role === "power_in");
    const out = pins.filter((p) => p.role === "power_out");
    // A source has power pins too. It is the start of a path, not a regulator in the middle.
    if (BUILTIN[part.type]?.kind !== "source" && inn.length === 1 && out.length === 1) {
      consider(part.id, inn[0]!.number, out[0]!.number);
      continue;
    }
    const hs = HIGH_SIDE[part.type];
    if (hs) consider(part.id, hs.supply, hs.switched);
  }
  if (!links.length) return EMPTY;

  const onPath = new Map<string, Set<string>>();
  for (const link of links) for (let i = 0; i < 2; i++) {
    const net = link.nets[i]!;
    const pins = onPath.get(net) ?? new Set<string>();
    pins.add(`${link.part}[${link.pins[i]}]`);
    onPath.set(net, pins);
  }
  // The source symbol is the start of the wire, not a load that wants its own supply symbol.
  for (const part of circuit.parts) {
    if (BUILTIN[part.type]?.kind !== "source") continue;
    for (const pin of defs[part.id] ?? []) {
      const id = `${part.id}[${pin.number}]`;
      const net = netOf.get(id);
      if (net && onPath.has(net)) onPath.get(net)!.add(id);
    }
  }

  const wireNets = new Set<string>();
  const continuePins = new Set<string>();
  const continueByNet = new Map<string, Set<string>>();
  for (const [net, pins] of [...onPath].sort((a, b) => cmpStr(a[0], b[0]))) {
    const loads = drawnPins(net, defs, vc).filter((id) => !pins.has(id));
    if (loads.length === 0) wireNets.add(net);
    else { continueByNet.set(net, pins); for (const id of pins) continuePins.add(id); }
  }
  const nameOf = new Map(circuit.nets.map((n) => [n.id, n.name ?? n.id]));
  const notes = links.map((link) => `power path: ${link.part} joins ${nameOf.get(link.nets[0])} to ${nameOf.get(link.nets[1])}`);
  return { wireNets, continuePins, continueByNet, notes };
}

/** Connected pin id ("PART[pin]") to its net id. A group endpoint covers every member pin. */
function pinNets(defs: PinDefs, vc: ValidCircuit): Map<string, string> {
  const out = new Map<string, string>();
  const nc = new Set(vc.nc.map(canonical));
  for (const [netId, eps] of vc.endpoints) for (const ep of eps) {
    if (ep.kind === "terminal") out.set(canonical(ep), netId);
    else for (const p of defs[ep.part] ?? []) if (p.group === ep.group && !nc.has(`${ep.part}[${p.number}]`)) out.set(`${ep.part}[${p.number}]`, netId);
  }
  return out;
}

/** The pin that is actually drawn for each endpoint of a net. */
function drawnPins(net: string, defs: PinDefs, vc: ValidCircuit): string[] {
  const nc = new Set(vc.nc.map(canonical));
  const ids: string[] = [];
  for (const ep of vc.endpoints.get(net) ?? []) {
    if (ep.kind === "terminal") ids.push(canonical(ep));
    else {
      const num = groupRepresentative(ep.part, ep.group, defs, nc);
      if (num !== undefined) ids.push(`${ep.part}[${num}]`);
    }
  }
  return [...new Set(ids)];
}
