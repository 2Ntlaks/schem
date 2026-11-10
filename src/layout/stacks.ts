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

import { netKind, type Net } from "../core/model.js";
import { cmpStr } from "../geom/geom.js";
import { BUILTIN } from "../symbols/library.js";
import { TRANSISTOR } from "./kinds.js";

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
const LANE_ORDER: Record<string, number> = { capacitor: 1, "polarised-capacitor": 1, diode: 2 };
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
  const rail = (net: string, sense: "up" | "down") => g.portNet.has(net) && kind(net) === (sense === "up" ? "power" : "ground");
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
    const k = (pin: string) => { const n = net(pin); return n === undefined ? undefined : kind(n); };
    // The same test as the default orientation (kinds.ts): which of the two end pins is drawn at the top.
    const turned = t.n ? k(t.ref) === "power" || k(t.main) === "ground" : k(t.ref) === "ground" || k(t.main) === "power";
    const mainDir: "up" | "down" = t.n !== turned ? "up" : "down";
    const children: StackChild[] = [];
    for (const [pin, dir] of [[t.main, mainDir], [t.ref, mainDir === "up" ? "down" : "up"]] as const) {
      const n = net(pin);
      if (n === undefined || !wire(n)) continue;
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
