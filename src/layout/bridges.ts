// Bridges: a two-pin part across two pins of one chip.
//
// A crystal across a microcontroller's XTAL1 and XTAL2, a resistor across two pins of a timer or
// a regulator: an engineer draws the part beside the chip, standing up between the two pins it
// joins, and puts those two pins next to each other on one side of the box. Left to the general
// rules, the two pins can land on opposite sides and the part in another column, so one of its
// wires loops round the chip.
//
// The layout uses a bridge three times:
// - flow: the part goes with the chip, like a stack child (src/layout/stacks.ts);
// - pin sides: the chip's two pins sit next to each other on the same side (`icFor`);
// - placement: the part stands beside them, its upper pin on the upper pin's wire, and moves
//   with the chip. If it does not fit, it is left to the general rules.
//
// Only a part on two wired nets counts (a supply or ground symbol already says where that pin
// goes), and only when each of those nets has exactly one pin of the chip, so the bridge is the
// one link between them. A part that a template, a stack, a decoupling slot or a placement hint
// already holds is not a bridge.

import { cmpStr, xformDir } from "../geom/geom.js";
import type { PinDefs } from "../core/model.js";
import { BUILTIN } from "../symbols/library.js";
import type { Orient } from "../geom/geom.js";

export interface Bridge {
  /** The two-pin part. */
  part: string;
  /** The chip it bridges. */
  host: string;
  /** The chip's two pins, upper first. */
  hostPins: [string, string];
  /** The part's pin on each of those two nets, in the same order: the first stands on top. */
  partPins: [string, string];
}

export interface BridgeInput {
  parts: ReadonlyArray<{ id: string; type: string }>;
  defs: PinDefs;
  /** Drawn terminal ("R1[1]") to net id. */
  drawnNet: ReadonlyMap<string, string>;
  /** Nets drawn with supply or ground symbols. */
  portNet: ReadonlySet<string>;
  /** A part no other rule holds (template, stack, decoupling slot, lock, relative or align hint). */
  free: (id: string) => boolean;
  /** A part drawn as a box whose pin sides the layout chooses (an IC or a module). */
  box: (id: string) => boolean;
  /** A fixed orientation for the part (an orientation hint), if any. */
  fixedOrient: (id: string) => Orient | undefined;
}

export function findBridges(a: BridgeInput): Bridge[] {
  const onNet = new Map<string, Array<{ part: string; pin: string }>>();
  for (const [t, net] of a.drawnNet) {
    const part = t.slice(0, t.indexOf("[")), pin = t.slice(part.length + 1, -1);
    onNet.set(net, [...(onNet.get(net) ?? []), { part, pin }]);
  }
  const found: Bridge[] = [];
  const usedPin = new Set<string>();
  for (const p of [...a.parts].sort((x, y) => cmpStr(x.id, y.id))) {
    const sym = BUILTIN[p.type];
    if (sym?.kind !== "two-pin" || !a.free(p.id)) continue;
    const pins = sym.pins.map((q) => q.number);
    if (pins.length !== 2) continue;
    const nets = pins.map((n) => a.drawnNet.get(`${p.id}[${n}]`));
    if (nets.some((n) => n === undefined || a.portNet.has(n)) || nets[0] === nets[1]) continue;
    // Chips with exactly one pin on each of the two nets.
    const hostPin = (net: string, host: string) => onNet.get(net)!.filter((e) => e.part === host);
    const hosts = [...new Set(onNet.get(nets[0]!)!.map((e) => e.part))].filter((h) => h !== p.id && a.box(h)
      && hostPin(nets[0]!, h).length === 1 && hostPin(nets[1]!, h).length === 1).sort(cmpStr);
    if (hosts.length !== 1) continue;
    const host = hosts[0]!;
    // Which of the part's pins stands on top: a fixed vertical orientation decides; otherwise pin 1.
    let top = 0;
    const o = a.fixedOrient(p.id);
    if (o) {
      const d = xformDir(sym.pins[0]!.dir, o);
      if (d !== "up" && d !== "down") continue;
      top = d === "up" ? 0 : 1;
    }
    const order = top === 0 ? [0, 1] : [1, 0];
    const hp = order.map((i) => hostPin(nets[i]!, host)[0]!.pin) as [string, string];
    if (hp.some((n) => usedPin.has(`${host}[${n}]`))) continue;
    for (const n of hp) usedPin.add(`${host}[${n}]`);
    found.push({ part: p.id, host, hostPins: hp, partPins: order.map((i) => pins[i]!) as [string, string] });
  }
  return found;
}
