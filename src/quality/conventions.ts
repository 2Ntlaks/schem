// Verification layer 3: drafting conventions (SPEC 9.1 group 2, 9.4). Each break is a
// finding (SPEC 10.2) naming the parts involved; the findings harness (src/edit/findings.ts)
// looks for a checked fix.

import { key, type Pt } from "../geom/geom.js";
import { canonical, netKind, railLevel, type Circuit, type PinDefs } from "../core/model.js";
import { groupRepresentative, validate } from "../core/validate.js";
import { BUILTIN } from "../symbols/library.js";
import type { DrawnPin, RenderModel } from "../render/model.js";
import { conductors } from "./drawing.js";

export interface Finding { id: string; severity: "error" | "warn" | "info"; message: string; parts: string[]; fix: null }

/** A decoupling capacitor further than this (Manhattan, G) from the pin it serves is a break. */
export const DECOUPLING_REACH = 8;

export function checkConventions(circuit: Circuit, pinDefs: PinDefs, m: RenderModel): Finding[] {
  const out: Finding[] = [];
  const v = validate(circuit, pinDefs);
  if (!v.valid) return out;
  const ncSet = new Set(v.valid.nc.map(canonical));
  const el = m.electrical;
  const pinOf = new Map(el.pins.map((p) => [`${p.part}[${p.number}]`, p]));
  const c = conductors(m);

  // Drawn terminal of each endpoint (group endpoints at their representative, SPEC 6.2).
  const netPins = new Map<string, DrawnPin[]>();
  const kindOfNet = new Map(circuit.nets.map((n) => [n.id, netKind(n)]));
  const negativeRails = new Set(circuit.nets.filter((n) => railLevel(n) === -1).map((n) => n.id));
  for (const [netId, eps] of v.valid.endpoints) {
    const ps: DrawnPin[] = [];
    for (const e of eps) {
      const num = e.kind === "terminal" ? e.number : groupRepresentative(e.part, e.group, pinDefs, ncSet);
      const p = num === undefined ? undefined : pinOf.get(`${e.part}[${num}]`);
      if (p) ps.push(p);
    }
    netPins.set(netId, ps);
  }
  const netOfPin = new Map<string, string>();
  for (const [n, ps] of netPins) for (const p of ps) netOfPin.set(`${p.part}[${p.number}]`, n);
  const role = (p: DrawnPin) => pinDefs[p.part]?.find((d) => d.number === p.number)?.role;
  const typeOf = new Map(circuit.parts.map((p) => [p.id, p.type]));
  const twoPin = (part: string) => (pinDefs[part]?.length ?? 0) === 2;
  // A pin whose net is drawn with supply or ground symbols, and which ends at one.
  const portAt = new Set(el.ports.filter((q) => q.kind !== "label").map((q) => key(q.at)));
  const asPort = (p: DrawnPin) => {
    const k = kindOfNet.get(netOfPin.get(`${p.part}[${p.number}]`) ?? "");
    if (k !== "power" && k !== "ground") return false;
    if (portAt.has(key(p.at))) return true;
    // A port stub: follow the pin's wire, without branches, until it ends at a port.
    let q: Pt = p.at, prev = "";
    for (let i = 0; i < 8; i++) {
      const d = c.dirs.get(key(q));
      if (!d || d.size > 2) return false;
      const next = [...d].map((x): Pt => [q[0] + (x === "right" ? 1 : x === "left" ? -1 : 0), q[1] + (x === "down" ? 1 : x === "up" ? -1 : 0)]).find((n) => key(n) !== prev);
      if (!next) return false;
      if (portAt.has(key(next))) return true;
      prev = key(q);
      q = next;
    }
    return false;
  };

  // 7: ground and negative supplies hang below their connection.
  for (const port of el.ports) {
    if (port.kind === "label") continue;
    const k = key(port.at);
    const pin = el.pins.find((p) => key(p.at) === k);
    const dirs = c.dirs.get(k);
    const below = railLevel({ kind: port.kind, name: port.text }) !== 1;
    const want = below ? "down" : "up";
    const from = below ? "up" : "down";
    const ok = pin ? pin.dir === want : dirs !== undefined && dirs.size === 1 && dirs.has(from);
    if (!ok) out.push({ id: `C7-${port.kind}-${k}`, severity: "warn", message: `${port.kind === "ground" ? "Ground" : "Supply"} symbol "${port.text}" at ${k} is not ${below ? "below" : "above"} its connection.`, parts: pin ? [pin.part] : [], fix: null });
  }

  // 7 (sources): a battery or voltage source stands vertical with "+" above "-".
  for (const part of circuit.parts) {
    if (BUILTIN[part.type]?.kind !== "source") continue;
    const plus = pinOf.get(`${part.id}[+]`), minus = pinOf.get(`${part.id}[-]`);
    if (plus && minus && !(plus.at[0] === minus.at[0] && plus.at[1] < minus.at[1])) out.push({ id: `C7-source-${part.id}`, severity: "warn", message: `Source ${part.id} is not drawn vertical with "+" at the top.`, parts: [part.id], fix: null });
  }

  for (const part of circuit.parts) {
    if (!twoPin(part.id)) continue;
    const [a, b] = pinDefs[part.id]!.map((d) => pinOf.get(`${part.id}[${d.number}]`)) as [DrawnPin | undefined, DrawnPin | undefined];
    if (!a || !b) continue;
    const ka = kindOfNet.get(netOfPin.get(`${a.part}[${a.number}]`) ?? ""), kb = kindOfNet.get(netOfPin.get(`${b.part}[${b.number}]`) ?? "");
    const vertical = a.at[0] === b.at[0];
    // 10: a two-pin part between a supply and ground is vertical, supply side up.
    if ((ka === "power" && kb === "ground") || (ka === "ground" && kb === "power")) {
      const [pw, gd] = ka === "power" ? [a, b] : [b, a];
      const negative = negativeRails.has(netOfPin.get(`${pw.part}[${pw.number}]`) ?? "");
      if (!vertical || (negative ? pw.at[1] < gd.at[1] : pw.at[1] > gd.at[1])) out.push({ id: `C10-${part.id}`, severity: "warn", message: `${part.id} sits between a supply and ground but is not drawn vertical with the supply side ${negative ? "down" : "up"}.`, parts: [part.id], fix: null });
    } else if (part.type === "resistor" && ((asPort(a) && kb === "signal") || (asPort(b) && ka === "signal"))) {
      // 9.4 pull-up / pull-down: vertical from a rail drawn as a symbol to the signal wire.
      if (!vertical) out.push({ id: `C9.4-pull-${part.id}`, severity: "warn", message: `Pull-up or pull-down ${part.id} is not drawn vertical.`, parts: [part.id], fix: null });
    }
  }

  for (const [netId, ps] of netPins) {
    const kind = kindOfNet.get(netId);
    // 11: two two-pin parts in series on a signal path, both drawn sideways, lie on one line.
    if (kind === "signal" && ps.length === 2 && ps.every((p) => twoPin(p.part)) && ps.every((p) => p.dir === "left" || p.dir === "right")) {
      const others = ps.map((p) => pinOf.get(`${p.part}[${pinDefs[p.part]!.find((d) => d.number !== p.number)!.number}]`));
      const sideways = others.every((o) => o !== undefined && o.at[1] === ps.find((p) => p.part === o.part)!.at[1]);
      if (sideways && ps[0]!.at[1] !== ps[1]!.at[1]) out.push({ id: `C11-${ps.map((p) => p.part).sort().join("-")}`, severity: "warn", message: `${ps[0]!.part} and ${ps[1]!.part} are in series but not on one line.`, parts: ps.map((p) => p.part).sort(), fix: null });
    }
    // 8: signal flows left to right: a driven input is not left of its driver.
    if (kind === "signal") {
      const drivers = ps.filter((p) => role(p) === "output" || role(p) === "power_out");
      const inputs = ps.filter((p) => role(p) === "input");
      // An input of the driver's own part is local feedback (a follower), not backwards flow.
      if (drivers.length === 1) for (const i of inputs) if (i.part !== drivers[0]!.part && i.at[0] < drivers[0]!.at[0]) out.push({ id: `C8-${i.part}[${i.number}]`, severity: "warn", message: `Signal flows right to left: input ${i.part}[${i.number}] is left of its driver ${drivers[0]!.part}[${drivers[0]!.number}].`, parts: [i.part, drivers[0]!.part], fix: null });
    }
  }

  // 13: a decoupling capacitor sits next to the IC supply pin it serves.
  for (const part of circuit.parts) {
    if (typeOf.get(part.id) !== "capacitor" || !twoPin(part.id)) continue;
    const pins = pinDefs[part.id]!.map((d) => pinOf.get(`${part.id}[${d.number}]`)).filter((p): p is DrawnPin => p !== undefined);
    const supply = pins.find((p) => kindOfNet.get(netOfPin.get(`${p.part}[${p.number}]`) ?? "") === "power");
    const ground = pins.find((p) => kindOfNet.get(netOfPin.get(`${p.part}[${p.number}]`) ?? "") === "ground");
    if (!supply || !ground) continue;
    const served = (netPins.get(netOfPin.get(`${supply.part}[${supply.number}]`)!) ?? []).filter((p) => !twoPin(p.part) && !BUILTIN[typeOf.get(p.part) ?? ""] && role(p) === "power_in");
    if (!served.length) continue;
    const d = Math.min(...served.map((p) => manhattan(p.at, supply.at)));
    if (d > DECOUPLING_REACH) out.push({ id: `C13-${part.id}`, severity: "warn", message: `Decoupling capacitor ${part.id} is ${d} G from the nearest supply pin it can serve (at most ${DECOUPLING_REACH} G).`, parts: [part.id, ...new Set(served.map((p) => p.part))], fix: null });
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function manhattan(p: Pt, q: Pt): number { return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]); }
