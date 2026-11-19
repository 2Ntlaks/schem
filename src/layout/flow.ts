// Flow inference (SPEC 9.2 step 2): which column each block belongs in, so that signals run left
// to right.
//
// The block graph has two kinds of edge. A directed edge says "this block is upstream of that
// one", and comes from what the parts are: an op-amp's inputs are upstream of it and its output
// downstream, a transistor is driven at its base or gate, a regulator feeds the rail on its
// output pin. Every other connection is undirected and takes its direction from where the
// drawing starts (the seeds). Ranks are then longest paths in the resulting acyclic graph.
//
// Three kinds of block are not ranked by the graph, because their place follows from another
// block's:
// - a tap: a two-pin part from a wire to a supply or ground symbol (a pull-up, a shunt capacitor).
//   It sits half a column from the blocks on its wire.
// - a feedback part: a two-pin part from a block's output back to the same block's input. It
//   takes that block's column.
// - a floating string: two-pin parts connected only to each other and to supply or ground symbols
//   (a rail capacitor, an indicator LED with its resistor). It sits beside what feeds its rail.

import { netKind, type Net, type PinDefs } from "../core/model.js";
import { cmpStr } from "../geom/geom.js";
import { BUILTIN, HEADER } from "../symbols/library.js";
import { TRANSISTOR } from "./kinds.js";

export interface FlowGraph {
  /** Blocks in canonical order; a block is a template region or a single part. */
  blocks: readonly string[];
  members: (block: string) => readonly string[];
  blockOf: (part: string) => string;
  type: (part: string) => string;
  label: (part: string) => string | undefined;
  defs: PinDefs;
  /** Drawn terminal ("R1[1]") to net id. */
  drawnNet: ReadonlyMap<string, string>;
  net: (id: string) => Net;
  /** Nets drawn with supply or ground symbols. */
  portNet: ReadonlySet<string>;
  /** A part the file marks as where the signal starts (a source, a controller, `flow: input`). */
  isSource: (part: string) => boolean;
  /** Parts placed against a host part by another rule (decoupling slots, pin stacks). */
  attached: ReadonlyMap<string, string>;
}

export interface Flow {
  /** Whole-number rank of each block (SPEC 9.2 step 2). */
  rank: Map<string, number>;
  /** Column value of each block: its rank, or a part step for taps and floating strings. */
  col: Map<string, number>;
  /** Multi-part taps on a wire shared with exactly one other pin. */
  seriesTaps: Map<string, { entry: string; host: string }>;
  /** Blocks whose place was a guess with nothing to go on (low confidence). */
  guessed: string[];
}

type Cls = "drv" | "rcv" | "other";

const SINK_TYPES = new Set(["led", "buzzer", "motor", "relay"]);
const SINK_LABEL = /\b(out|output|load|spk|speaker)\b/i;
/** Series parts a supply current passes through on its way to a rail (SPEC 9.2 step 3). */
const PATH_TYPES = new Set(["diode", "schottky", "fuse", "spst"]);

export function inferFlow(g: FlowGraph, fixed: ReadonlyMap<string, number>): Flow {
  const netsOf = new Map<string, Array<{ part: string; pin: string; net: string }>>(); // block -> its drawn pins
  const onNet = new Map<string, Array<{ part: string; pin: string }>>();
  for (const [t, net] of g.drawnNet) {
    const part = t.slice(0, t.indexOf("[")), pin = t.slice(part.length + 1, -1);
    const b = g.blockOf(part);
    netsOf.set(b, [...(netsOf.get(b) ?? []), { part, pin, net }]);
    onNet.set(net, [...(onNet.get(net) ?? []), { part, pin }]);
  }
  const kind = (net: string) => netKind(g.net(net));
  /** A net that carries flow as a wire: not ground, not drawn with symbols. */
  const flows = (net: string) => !g.portNet.has(net) && kind(net) !== "ground";
  const single = (b: string) => g.members(b).length === 1 && g.members(b)[0] === b;
  const twoPin = (b: string) => single(b) && BUILTIN[g.type(b)]?.kind === "two-pin";
  const explicit = (b: string) => g.members(b).some(g.isSource);

  const classOf = (part: string, pin: string): Cls => {
    const type = g.type(part), t = TRANSISTOR[type];
    if (t) {
      if (pin === t.ctrl) return "rcv";
      if (pin === t.main) return "drv";
      // The emitter or source drives its net only when the collector or drain sits on a rail (a follower).
      const main = g.drawnNet.get(`${part}[${t.main}]`);
      return main === undefined || g.portNet.has(main) ? "drv" : "other";
    }
    if (BUILTIN[type]?.kind === "source") return "drv";
    if (type === "potentiometer") {
      const ends = ["1", "3"].map((p) => g.drawnNet.get(`${part}[${p}]`));
      return pin === "2" && ends.every((n) => n !== undefined && kind(n) !== "signal") ? "drv" : "other";
    }
    const role = g.defs[part]?.find((p) => p.number === pin)?.role;
    return role === "output" || role === "power_out" ? "drv" : role === "input" ? "rcv" : "other";
  };

  // Blocks that follow another block instead of being ranked.
  const attachedBlock = (b: string) => single(b) && g.attached.has(b);
  const pinsOf = (b: string) => netsOf.get(b) ?? [];
  /** The wires a block shares with other blocks (a stack's own links do not count). */
  const outside = (b: string) => [...new Set(pinsOf(b).filter((p) => flows(p.net) && (onNet.get(p.net) ?? []).some((q) => g.blockOf(q.part) !== b)).map((p) => p.net))];
  const allTwoPin = (b: string) => g.members(b).every((m) => BUILTIN[g.type(m)]?.kind === "two-pin");
  // A tap: one two-pin part, or a stack of them, between one wire and supply or ground symbols.
  const isTapShape = (b: string) => allTwoPin(b) && !fixed.has(b) && !explicit(b) && !attachedBlock(b)
    && pinsOf(b).some((p) => g.portNet.has(p.net)) && outside(b).length === 1
    && pinsOf(b).filter((p) => flows(p.net)).every((p) => p.net === outside(b)[0] || (onNet.get(p.net) ?? []).every((q) => g.blockOf(q.part) === b));
  const wireOf = (b: string) => outside(b)[0]!;
  /** A series part on a supply's way in: its other side reaches a connector, a source or another such part. */
  const feedsRail = (b: string): string | undefined => {
    if (!single(b) || !isTapShape(b) || !PATH_TYPES.has(g.type(b))) return undefined;
    const rail = pinsOf(b).find((p) => g.portNet.has(p.net))!, wire = pinsOf(b).find((p) => flows(p.net))!;
    if (kind(rail.net) !== "power" || ((g.type(b) === "diode" || g.type(b) === "schottky") && rail.pin !== "K")) return undefined;
    const others = (onNet.get(wire.net) ?? []).filter((p) => p.part !== b);
    const supplyLike = others.some((p) => g.type(p.part) === HEADER || BUILTIN[g.type(p.part)]?.kind === "source" || PATH_TYPES.has(g.type(p.part)));
    const active = others.some((p) => TRANSISTOR[g.type(p.part)] !== undefined || classOf(p.part, p.pin) === "drv" && BUILTIN[g.type(p.part)]?.kind !== "source");
    return supplyLike && !active ? rail.net : undefined;
  };

  // Components over wires, to find the floating strings.
  const wireNeighbours = new Map(g.blocks.map((b) => [b, new Set<string>()]));
  for (const [net, pins] of onNet) if (flows(net)) {
    const bs = [...new Set(pins.map((p) => g.blockOf(p.part)))];
    for (const a of bs) for (const b of bs) if (a !== b) wireNeighbours.get(a)!.add(b);
  }
  const componentsOf = (nodes: readonly string[], adj: (b: string) => Iterable<string>): string[][] => {
    const seen = new Set<string>(), out: string[][] = [];
    const inSet = new Set(nodes);
    for (const s of nodes) {
      if (seen.has(s)) continue;
      const comp: string[] = [], queue = [s];
      seen.add(s);
      while (queue.length) {
        const u = queue.shift()!;
        comp.push(u);
        for (const w of [...adj(u)].sort(cmpStr)) if (inSet.has(w) && !seen.has(w)) { seen.add(w); queue.push(w); }
      }
      out.push(comp.sort(cmpStr));
    }
    return out;
  };
  const candidates = g.blocks.filter((b) => !attachedBlock(b));
  const floating: string[][] = [];
  const floats = new Set<string>();
  for (const comp of componentsOf(candidates, (b) => wireNeighbours.get(b)!)) {
    if (comp.length <= 4 && comp.every((b) => twoPin(b) && !fixed.has(b) && !explicit(b)) && comp.some((b) => pinsOf(b).some((p) => g.portNet.has(p.net)))) {
      floating.push(comp);
      for (const b of comp) floats.add(b);
    }
  }
  const railFeed = new Map<string, string>(); // block -> the rail it feeds
  for (const b of candidates) { const rail = floats.has(b) ? undefined : feedsRail(b); if (rail) railFeed.set(b, rail); }
  const taps = new Set(candidates.filter((b) => !floats.has(b) && isTapShape(b) && !railFeed.has(b)));

  // The ranked graph.
  const nodes = candidates.filter((b) => !floats.has(b) && !taps.has(b));
  const isNode = new Set(nodes);
  const directed = new Set<string>(), undirected = new Set<string>();
  const dkey = (a: string, b: string) => `${a}>${b}`;
  const ukey = (a: string, b: string) => (cmpStr(a, b) < 0 ? `${a}|${b}` : `${b}|${a}`);
  const railDrivers = new Map<string, string[]>(); // rail net -> blocks that feed it
  for (const [net, pins] of onNet) {
    const cls = new Map<string, Cls>();
    for (const p of pins) {
      const b = g.blockOf(p.part);
      if (!isNode.has(b)) continue;
      const c = classOf(p.part, p.pin), was = cls.get(b);
      cls.set(b, c === "drv" || was === "drv" ? "drv" : c === "rcv" || was === "rcv" ? "rcv" : "other");
    }
    const all = [...cls.keys()].sort(cmpStr);
    if (flows(net)) {
      const D = all.filter((b) => cls.get(b) === "drv"), R = all.filter((b) => cls.get(b) === "rcv"), O = all.filter((b) => cls.get(b) === "other");
      if (D.length) { for (const d of D) for (const x of [...R, ...O]) directed.add(dkey(d, x)); for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) undirected.add(ukey(D[i]!, D[j]!)); }
      else if (R.length && O.length) for (const o of O) for (const r of R) directed.add(dkey(o, r));
      else for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) undirected.add(ukey(all[i]!, all[j]!));
    } else if (g.portNet.has(net) && kind(net) === "power") {
      // A rail fed by a regulator's output or through a series part: what it feeds comes after.
      const D = all.filter((b) => railFeed.get(b) === net || pins.some((p) => g.blockOf(p.part) === b && BUILTIN[g.type(p.part)]?.kind !== "source" && g.defs[p.part]?.find((x) => x.number === p.pin)?.role === "power_out"));
      if (!D.length) continue;
      railDrivers.set(net, D);
      for (const d of D) for (const x of all) if (!D.includes(x)) directed.add(dkey(d, x));
    }
  }
  // A part from a block's output straight back to its input is that block's feedback part.
  const sibling = new Map<string, string>();
  for (const k of [...directed].sort(cmpStr)) {
    const [a, b] = k.split(">") as [string, string];
    if (!directed.has(dkey(b, a)) || !directed.has(k)) continue;
    directed.delete(k); directed.delete(dkey(b, a));
    const [passive, host] = twoPin(a) ? [a, b] : twoPin(b) ? [b, a] : [undefined, undefined];
    if (passive && host && !fixed.has(passive)) sibling.set(passive, host); else undirected.add(ukey(a, b));
  }
  const touches = (b: string) => [...directed, ...undirected].some((k) => k.split(/[>|]/).includes(b));
  for (const b of [...sibling.keys()]) if (touches(b)) sibling.delete(b); // it has other connections: rank it
  const ranked = nodes.filter((b) => !sibling.has(b));
  const out = new Map(ranked.map((b) => [b, [] as string[]])), inn = new Map(ranked.map((b) => [b, [] as string[]])), und = new Map(ranked.map((b) => [b, [] as string[]]));
  for (const k of directed) { const [a, b] = k.split(">") as [string, string]; out.get(a)!.push(b); inn.get(b)!.push(a); }
  for (const k of undirected) { const [a, b] = k.split("|") as [string, string]; und.get(a)!.push(b); und.get(b)!.push(a); }
  for (const m of [out, inn, und]) for (const l of m.values()) l.sort(cmpStr);

  // Seeds: where each connected piece of the drawing starts.
  const guessed: string[] = [];
  const sinkTap = new Set<string>();
  const sinkBlock = (b: string) => g.members(b).some((m) => SINK_TYPES.has(g.type(m)));
  for (const t of taps) if (sinkBlock(t)) for (const p of onNet.get(wireOf(t)) ?? []) sinkTap.add(g.blockOf(p.part));
  for (const comp of floating) if (comp.some((b) => SINK_TYPES.has(g.type(b)))) for (const b of comp) for (const p of pinsOf(b)) if (flows(p.net)) for (const q of onNet.get(p.net) ?? []) sinkTap.add(g.blockOf(q.part));
  const isSink = (b: string) => sinkTap.has(b) || g.members(b).some((m) => SINK_TYPES.has(g.type(m)) || (g.type(m) === HEADER && SINK_LABEL.test(g.label(m) ?? "")));
  const inputLike = (b: string) => single(b) && !isSink(b) && (g.type(b) === HEADER || (g.type(b) === "potentiometer" && classOf(b, "2") === "drv"));
  const seeds = new Set<string>();
  const comps = componentsOf(ranked, (b) => [...out.get(b)!, ...inn.get(b)!, ...und.get(b)!]);
  for (const comp of comps) {
    const pick = (f: (b: string) => boolean) => { const s = comp.filter(f); for (const b of s) seeds.add(b); return s.length > 0; };
    if (pick((b) => fixed.has(b))) { pick(explicit); continue; }
    if (pick(explicit)) continue;
    if (pick((b) => inputLike(b) && !inn.get(b)!.length)) continue;
    if (pick((b) => !inn.get(b)!.length && out.get(b)!.length > 0)) continue;
    // Nothing says where this piece starts: begin as far from its outputs as possible, or at its hub.
    const sinks = comp.filter(isSink);
    const dist = new Map(sinks.map((s) => [s, 0]));
    const queue = [...sinks];
    while (queue.length) { const u = queue.shift()!; for (const w of [...out.get(u)!, ...inn.get(u)!, ...und.get(u)!]) if (!dist.has(w)) { dist.set(w, dist.get(u)! + 1); queue.push(w); } }
    const degree = (b: string) => pinsOf(b).filter((p) => flows(p.net)).length;
    const best = [...comp].sort((a, b) => (sinks.length ? (dist.get(b) ?? 0) - (dist.get(a) ?? 0) : degree(b) - degree(a)) || cmpStr(a, b))[0]!;
    seeds.add(best);
    if (!sinks.length && comp.length > 1 && degree(best) < 3) guessed.push(best);
  }

  // Levels from the seeds give every undirected edge a direction; blocks only upstream of the
  // reached ones are then filled in backwards.
  const level = new Map<string, number>();
  let frontier = [...seeds].sort(cmpStr);
  for (const s of frontier) level.set(s, 0);
  while (frontier.length) {
    const next: string[] = [];
    for (const u of frontier) for (const w of [...new Set([...out.get(u)!, ...und.get(u)!])].sort(cmpStr)) if (!level.has(w)) { level.set(w, level.get(u)! + 1); next.push(w); }
    frontier = next;
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const u of ranked) {
      if (level.has(u)) continue;
      const reached = [...out.get(u)!, ...und.get(u)!, ...inn.get(u)!].filter((w) => level.has(w));
      if (!reached.length) continue;
      level.set(u, Math.min(...reached.map((w) => level.get(w)!)) - 1);
      changed = true;
    }
  }
  // Passive parts hanging on one block that also drives something else (a pull-up with its button,
  // a timing string) are drawn on its input side: outputs to the right, the rest to the left.
  const passive = (b: string) => !fixed.has(b) && !explicit(b) && !isSink(b) && g.members(b).every((m) => BUILTIN[g.type(m)]?.kind === "two-pin");
  const hangsOn = (b: string, host: string) => passive(b) && !out.get(b)!.length && !inn.get(b)!.length && und.get(b)!.length === 1
    && [...out.get(host)!, ...und.get(host)!].some((w) => w !== b && !hangsOn2(w, host));
  const hangsOn2 = (b: string, host: string) => passive(b) && !out.get(b)!.length && !inn.get(b)!.length && und.get(b)!.length === 1 && und.get(b)![0] === host;
  const succ = new Map(ranked.map((b) => [b, new Set(out.get(b)!)]));
  for (const k of undirected) {
    const [a, b] = k.split("|") as [string, string];
    const la = level.get(a) ?? 0, lb = level.get(b) ?? 0;
    const [from, to] = la < lb ? [a, b] : lb < la ? [b, a] : [undefined, undefined];
    if (from === undefined || to === undefined) continue;
    if (hangsOn(to, from) && !seeds.has(to)) succ.get(to)!.add(from); else succ.get(from)!.add(to);
  }
  // Break cycles (feedback loops through several blocks): depth-first from the seeds, back edges dropped.
  const state = new Map<string, 1 | 2>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const w of [...succ.get(u)!].sort(cmpStr)) {
      if (state.get(w) === 1) succ.get(u)!.delete(w);
      else if (!state.has(w)) visit(w);
    }
    state.set(u, 2);
  };
  for (const s of [...[...seeds].sort(cmpStr), ...ranked]) if (!state.has(s)) visit(s);
  const pred = new Map(ranked.map((b) => [b, [] as string[]]));
  for (const [a, ws] of succ) for (const w of ws) pred.get(w)!.push(a);

  // Longest paths, in topological order.
  const order: string[] = [];
  const left = new Map(ranked.map((b) => [b, pred.get(b)!.length]));
  const ready = ranked.filter((b) => !left.get(b));
  while (ready.length) {
    ready.sort(cmpStr);
    const u = ready.shift()!;
    order.push(u);
    for (const w of succ.get(u)!) { left.set(w, left.get(w)! - 1); if (!left.get(w)) ready.push(w); }
  }
  const rank = new Map<string, number>();
  for (const u of order) rank.set(u, fixed.get(u) ?? Math.max(0, ...pred.get(u)!.map((p) => rank.get(p)! + 1)));
  // A block that only feeds others moves up next to what it feeds.
  for (const u of [...order].reverse()) {
    if (fixed.has(u) || explicit(u) || pred.get(u)!.length || !succ.get(u)!.size) continue;
    rank.set(u, Math.min(...[...succ.get(u)!].map((w) => rank.get(w)!)) - 1);
  }
  // Separate pieces of the drawing sit side by side, the largest first.
  const big = [...comps].sort((a, b) => b.length - a.length || cmpStr(a[0]!, b[0]!))[0];
  const stays = (c: string[]) => c === big || c.length === 1 || c.some((b) => fixed.has(b));
  let next = Math.max(0, ...comps.filter(stays).flatMap((c) => c.map((b) => rank.get(b)!))) + 1;
  for (const c of comps) {
    if (stays(c)) continue;
    for (const b of c) rank.set(b, rank.get(b)! + next);
    next = Math.max(...c.map((b) => rank.get(b)!)) + 1;
  }

  const col = new Map(rank);
  for (const [b, host] of sibling) { rank.set(b, rank.get(host)!); col.set(b, col.get(host)!); }
  // Taps: half a column after the first block on their wire, or before it when they only feed inputs.
  const graphRanked = new Set(rank.keys());
  const seriesTaps: Flow["seriesTaps"] = new Map();
  for (const t of [...taps].sort(cmpStr)) {
    const others = (onNet.get(wireOf(t)) ?? []).filter((p) => graphRanked.has(g.blockOf(p.part)));
    if (!others.length) { rank.set(t, 0); col.set(t, 0); continue; }
    const lowest = Math.min(...others.map((p) => rank.get(g.blockOf(p.part))!));
    // On one block's plain pin, when that block drives something else: the input side (see above).
    const hosts = [...new Set(others.map((p) => g.blockOf(p.part)))];
    const inputSide = hosts.length === 1 && !sinkBlock(t) && others.every((p) => classOf(p.part, p.pin) === "other") && ((succ.get(hosts[0]!)?.size ?? 0) > 0 || sinkTap.has(hosts[0]!));
    const feeds = inputSide || others.every((p) => classOf(p.part, p.pin) === "rcv");
    // (a single part sits close to the pin; a stack is large and joins the column of the other feeders.)
    const back = single(t) ? 0.5 : 1;
    const endpoints = onNet.get(wireOf(t))!;
    if (!feeds && !single(t) && endpoints.length === 2 && others.length === 1) {
      const entry = endpoints.find((p) => g.blockOf(p.part) === t)!;
      const host = others[0]!;
      seriesTaps.set(t, { entry: `${entry.part}[${entry.pin}]`, host: `${host.part}[${host.pin}]` });
    }
    col.set(t, lowest + (feeds ? -back : 0.5));
    rank.set(t, feeds ? Math.ceil(lowest - back) : lowest + 1);
  }
  // Floating strings: side by side after what feeds their rail, or at the start.
  const used = new Map<number, number>();
  for (const comp of floating) {
    const rails = comp.flatMap((b) => pinsOf(b).filter((p) => g.portNet.has(p.net) && kind(p.net) === "power").map((p) => p.net));
    const feeders = rails.flatMap((n) => railDrivers.get(n) ?? []).filter((b) => rank.has(b));
    const base = feeders.length ? Math.max(...feeders.map((b) => rank.get(b)!)) : 0;
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    for (const b of comp) { rank.set(b, base); col.set(b, base + (feeders.length ? 0.5 : 0) + k / 64); }
  }
  for (const b of g.blocks) {
    if (rank.has(b)) continue;
    const host = g.attached.get(b);
    const hb = host === undefined ? undefined : g.blockOf(host);
    rank.set(b, (hb !== undefined ? rank.get(hb) : undefined) ?? 0);
    col.set(b, (hb !== undefined ? col.get(hb) : undefined) ?? 0);
  }
  return { rank, col, seriesTaps, guessed };
}
