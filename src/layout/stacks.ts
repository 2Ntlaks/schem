// Vertical stacks (SPEC 9.1 rules 7 and 10, without a template): two-pin parts that an engineer
// draws in one vertical line, found from the netlist alone.
//
// - On a transistor: the parts between its collector or drain and the supply stand above it, the
//   parts between its emitter or source and ground hang below it. A second branch on the same pin
//   (a bypass capacitor, a flyback diode) stands beside the first.
// - A string: two-pin parts in series from a supply down to ground stand in one column, top to
//   bottom, with the points between them free for wires to the side (a 555's timing string).
// - A hanging chain: two-pin parts strictly in series that end at ground or start at a supply.
//
// This file only decides who stacks on whom. The geometry is worked out in layout.ts, which may
// still drop a member (a locked part, no room); a dropped member is laid out by the general rules.

import { netKind, railLevel, type Net } from "../core/model.js";
import { cmpStr } from "../geom/geom.js";
import { BUILTIN } from "../symbols/library.js";
import { mainPinUp, TRANSISTOR } from "./kinds.js";

export interface StackChild {
  part: string;
  /** The part it stands on: the stack's root or an earlier child. */
  parent: string;
  parentPin: string;
  /** The child's pin facing the parent. */
  pin: string;
  /** Where the child goes from the parent's pin. */
  dir: "up" | "down";
  /** 0: in line with the parent's pin. 1, 2: beside the in-line child, further each time. */
  lane: number;
  /** Grid steps from the parent's pin to the child's pin: 2, or 4 when other wires join between them. */
  gap: number;
}

export interface Stack {
  root: string;
  /** For a string or chain: the root's pin that faces up. A transistor root keeps its own orientation. */
  rootUp?: string;
  /** For a symmetric op-amp feedback bridge: [top op-amp, bottom op-amp] whose IN- pins face inward. */
  bridgeOpamps?: [string, string];
  /** Parents before their children. */
  children: StackChild[];
}

export interface StackGraph {
  parts: ReadonlyArray<{ id: string; type: string }>;
  /** Drawn terminal ("R1[1]") to net id. */
  drawnNet: ReadonlyMap<string, string>;
  net: (id: string) => Net;
  portNet: ReadonlySet<string>;
  /** The part may be turned and placed by a stack (no lock, hint or template holds it). */
  free: (part: string) => boolean;
  /** The part is in no template at all. A hanging chain takes only these: a template already draws its own. */
  loose: (part: string) => boolean;
}

/** In-line first: the load itself, then the parts usually drawn beside it. */
const LANE_ORDER: Record<string, number> = { capacitor: 1, "polarised-capacitor": 1, diode: 2, schottky: 2, zener: 2 };
/** Series diodes that pass current on (a Zener is a shunt, so it is not one). */
const RECTIFIERS = new Set(["diode", "schottky"]);
const MAX_CHAIN = 3, MAX_STRING = 5, MAX_LANES = 3;

export function findStacks(g: StackGraph): Stack[] {
  const typeOf = new Map(g.parts.map((p) => [p.id, p.type]));
  const pinsOf = new Map<string, Array<{ pin: string; net: string }>>();
  const onNet = new Map<string, Array<{ part: string; pin: string }>>();
  for (const [t, net] of g.drawnNet) {
    const part = t.slice(0, t.indexOf("[")), pin = t.slice(part.length + 1, -1);
    pinsOf.set(part, [...(pinsOf.get(part) ?? []), { pin, net }]);
    onNet.set(net, [...(onNet.get(net) ?? []), { part, pin }]);
  }
  for (const l of onNet.values()) l.sort((a, b) => cmpStr(a.part, b.part) || cmpStr(a.pin, b.pin));
  const kind = (net: string) => netKind(g.net(net));
  const wire = (net: string) => !g.portNet.has(net) && kind(net) !== "ground";
  const rail = (net: string, sense: "up" | "down") => {
    const level = railLevel(g.net(net));
    return g.portNet.has(net) && level !== undefined && (sense === "up" ? level > 0 : level <= 0);
  };
  const used = new Set<string>();
  const usable = (p: string) => BUILTIN[typeOf.get(p) ?? ""]?.kind === "two-pin" && pinsOf.get(p)?.length === 2 && !used.has(p) && g.free(p);
  const far = (p: string, pin: string) => pinsOf.get(p)!.find((x) => x.pin !== pin)!;
  const ids = g.parts.map((p) => p.id).sort(cmpStr);
  const stacks: Stack[] = [];

  /** Chains hanging from `net` towards a rail: each part in strict series with the next, the last on the rail. */
  const hangers = (net: string, sense: "up" | "down", host: string): Array<Array<{ part: string; near: string; far: string }>> => {
    const out: Array<Array<{ part: string; near: string; far: string }>> = [];
    for (const t of onNet.get(net) ?? []) {
      if (t.part === host || !usable(t.part)) continue;
      const chain: Array<{ part: string; near: string; far: string }> = [];
      let cur = t;
      for (;;) {
        const f = far(cur.part, cur.pin);
        chain.push({ part: cur.part, near: cur.pin, far: f.pin });
        if (rail(f.net, sense)) { out.push(chain); break; }
        const link = onNet.get(f.net) ?? [];
        const next = link.find((x) => x.part !== cur.part);
        if (!wire(f.net) || link.length !== 2 || !next || !usable(next.part) || chain.some((c) => c.part === next.part) || chain.length >= MAX_CHAIN) break;
        cur = next;
      }
    }
    return out.sort((a, b) => (LANE_ORDER[typeOf.get(a[0]!.part)!] ?? 0) - (LANE_ORDER[typeOf.get(b[0]!.part)!] ?? 0) || cmpStr(a[0]!.part, b[0]!.part));
  };

  // Transistors: loads above, emitter or source parts below.
  for (const q of ids) {
    const t = TRANSISTOR[typeOf.get(q) ?? ""];
    if (!t || !g.free(q)) continue;
    const net = (pin: string) => pinsOf.get(q)?.find((x) => x.pin === pin)?.net;
    const mainDirOf = (part: string) => {
      const tt = TRANSISTOR[typeOf.get(part) ?? ""];
      if (!tt) return undefined;
      return mainPinUp(tt, (pin) => {
        const n = pinsOf.get(part)?.find((x) => x.pin === pin)?.net;
        return n === undefined ? undefined : g.net(n);
      }) ? "up" : "down";
    };
    const mainDir = mainDirOf(q)!;
    const children: StackChild[] = [];
    for (const [pin, dir] of [[t.main, mainDir], [t.ref, mainDir === "up" ? "down" : "up"]] as const) {
      const n = net(pin);
      if (n === undefined || !wire(n)) continue;
      // Complementary pair (push-pull output): another transistor meets this pin from the opposite
      // vertical side, so leave loads off the vertical line between the two transistors.
      if ((onNet.get(n) ?? []).some((x) => {
        if (x.part === q) return false;
        const ot = TRANSISTOR[typeOf.get(x.part) ?? ""];
        if (!ot || (x.pin !== ot.main && x.pin !== ot.ref)) return false;
        const om = mainDirOf(x.part)!;
        const otherDir = x.pin === ot.main ? om : (om === "up" ? "down" : "up");
        return otherDir !== dir;
      })) continue;
      const chains = hangers(n, dir, q).slice(0, MAX_LANES);
      const alone = (onNet.get(n) ?? []).length === 2;
      chains.forEach((chain, lane) => chain.forEach((c, i) => {
        children.push(i === 0 ? { part: c.part, parent: q, parentPin: pin, pin: c.near, dir, lane, gap: alone ? 2 : 4 }
          : { part: c.part, parent: chain[i - 1]!.part, parentPin: chain[i - 1]!.far, pin: c.near, dir, lane: 0, gap: 2 });
        used.add(c.part);
      }));
    }
    if (children.length) { stacks.push({ root: q, children }); used.add(q); }
  }

  // Strings: from a supply down to ground, through any nets.
  const toGround = (part: string, pin: string, seen: string[]): Array<{ part: string; near: string }> | undefined => {
    const f = far(part, pin);
    const here = [...seen, part];
    if (rail(f.net, "down")) return [{ part, near: pin }];
    if (!wire(f.net) || here.length >= MAX_STRING) return undefined;
    let best: Array<{ part: string; near: string }> | undefined;
    for (const t of onNet.get(f.net) ?? []) {
      if (here.includes(t.part) || !usable(t.part)) continue;
      const rest = toGround(t.part, t.pin, here);
      if (rest && (!best || rest.length < best.length)) best = rest;
    }
    return best ? [{ part, near: pin }, ...best] : undefined;
  };
  const stackOf = (path: Array<{ part: string; near: string }>): Stack => {
    const children: StackChild[] = [];
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1]!, cur = path[i]!;
      const link = far(prev.part, prev.near);
      children.push({ part: cur.part, parent: prev.part, parentPin: link.pin, pin: cur.near, dir: "down", lane: 0, gap: (onNet.get(link.net) ?? []).length === 2 ? 2 : 4 });
    }
    for (const p of path) used.add(p.part);
    return { root: path[0]!.part, rootUp: path[0]!.near, children };
  };
  for (const p of ids) {
    if (!usable(p)) continue;
    const top = pinsOf.get(p)!.find((x) => rail(x.net, "up"));
    if (!top || !wire(far(p, top.pin).net)) continue;
    const path = toGround(p, top.pin, []);
    if (path && path.length >= 2) stacks.push(stackOf(path));
  }

  // Symmetric feedback bridge: two free op-amps each with a two-pin feedback part (OUT -> IN-),
  // linked by a two-pin gain part between their IN- pins (instrumentation-amplifier input stage).
  // Stack the three parts in one vertical column: top feedback, bridge, bottom feedback.
  const opamps = ids.filter((id) => typeOf.get(id) === "opamp" && g.free(id) && !used.has(id));
  for (let i = 0; i < opamps.length; i++) {
    const a = opamps[i]!;
    if (used.has(a)) continue;
    const aOut = pinsOf.get(a)?.find((x) => x.pin === "1")?.net;
    const aIn = pinsOf.get(a)?.find((x) => x.pin === "2")?.net;
    if (!aOut || !aIn || !wire(aOut) || !wire(aIn)) continue;
    const fbA = (onNet.get(aIn) ?? []).find((t) => usable(t.part) && far(t.part, t.pin).net === aOut);
    if (!fbA) continue;
    for (let j = i + 1; j < opamps.length; j++) {
      const b = opamps[j]!;
      if (used.has(b)) continue;
      const bOut = pinsOf.get(b)?.find((x) => x.pin === "1")?.net;
      const bIn = pinsOf.get(b)?.find((x) => x.pin === "2")?.net;
      if (!bOut || !bIn || !wire(bOut) || !wire(bIn) || bIn === aIn) continue;
      const fbB = (onNet.get(bIn) ?? []).find((t) => usable(t.part) && t.part !== fbA.part && far(t.part, t.pin).net === bOut);
      const bridge = (onNet.get(aIn) ?? []).find((t) => usable(t.part) && t.part !== fbA.part && t.part !== fbB?.part && far(t.part, t.pin).net === bIn);
      if (!fbB || !bridge) continue;
      stacks.push({
        ...stackOf([
          { part: fbA.part, near: far(fbA.part, fbA.pin).pin },
          { part: bridge.part, near: bridge.pin },
          { part: fbB.part, near: fbB.pin },
        ]),
        bridgeOpamps: [a, b],
      });
      break;
    }
  }

  // Hanging chains: strictly in series, ending at ground or starting at a supply.
  for (const p of ids) {
    if (!usable(p)) continue;
    for (const sense of ["down", "up"] as const) {
      const end = pinsOf.get(p)!.find((x) => rail(x.net, sense));
      if (!end || !usable(p) || !g.loose(p)) continue;
      // Walk away from the rail through two-endpoint nets.
      const chain = [{ part: p, railSide: end.pin }];
      for (;;) {
        const last = chain[chain.length - 1]!;
        const f = far(last.part, last.railSide);
        const link = onNet.get(f.net) ?? [];
        const next = link.find((x) => x.part !== last.part);
        if (!wire(f.net) || link.length !== 2 || !next || !usable(next.part) || !g.loose(next.part) || chain.some((c) => c.part === next.part) || chain.length >= MAX_CHAIN) break;
        chain.push({ part: next.part, railSide: next.pin });
      }
      // A capacitor at the free end is a coupling capacitor on its way to a load: it stays in the signal line.
      while (chain.length && /capacitor/.test(typeOf.get(chain[chain.length - 1]!.part) ?? "")) chain.pop();
      // So does a rectifier at the free end: it passes current along the line to its load.
      while (chain.length && RECTIFIERS.has(typeOf.get(chain[chain.length - 1]!.part) ?? "")) chain.pop();
      if (chain.length < 2) continue;
      // Top to bottom: a ground-ended chain is listed bottom-up, a supply-ended one top-down.
      const path = sense === "down"
        ? [...chain].reverse().map((c) => ({ part: c.part, near: far(c.part, c.railSide).pin }))
        : chain.map((c) => ({ part: c.part, near: c.railSide }));
      stacks.push(stackOf(path));
    }
  }
  return stacks;
}
