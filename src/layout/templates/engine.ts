// Template engine (SPEC 9.2 steps 1 and 5, 9.4): matching on the full graph, overlap
// resolution, and turning a matched template's data into orientations, pin sides, ranks,
// difference constraints and pre-routed runs. Deterministic: canonical order everywhere,
// integers only, code-point string comparison (SPEC 9.6).

import { boxesOverlap, cmpNatural, cmpStr, unionBox, xformDir, type Box, type Dir, type Orient, type Pt, type Rot } from "../../geom/geom.js";
import { netKind, type Net, type Part, type PinDef, type PinDefs } from "../../core/model.js";
import type { Side } from "../../core/intent.js";
import type { SymbolDef } from "../../symbols/library.js";
import { solveWithDrops, type Constraint, type Priority } from "../solver.js";
import type { NetPred, PinSel, Ref, Rel, Slot, SlotPin, Template, When } from "./types.js";

/** What the matcher reads: the full typed graph (SPEC 9.2 step 0). */
export interface TemplateGraph {
  parts: readonly Part[];
  defs: PinDefs;
  /** Drawn terminal "R1[2]" -> net id. */
  drawnNet: ReadonlyMap<string, string>;
  netById: ReadonlyMap<string, Net>;
  /** Nets drawn with supply or ground symbols. */
  portNet: ReadonlySet<string>;
}

/** One part bound to a slot: which of its pins each net variable uses. */
export interface Bound { part: string; vars: Map<string, string> }

export interface Region {
  /** Stable identity: template id and version, then the sorted parts. */
  key: string;
  template: Template;
  /** Block representative: the first member (its origin is the region's origin). */
  rep: string;
  members: string[];
  links: string[];
  slots: Map<string, Bound[]>;
  /** Net variable -> net id. */
  nets: Map<string, string>;
  /** Net variable -> drawn endpoint count. */
  netEndpoints: Map<string, number>;
  defs: PinDefs;
}

/** Oriented geometry of a placed part, relative to its origin. */
/** A part's pins, keep-out, envelope (with its decoupling child slots) and own envelope (without them). */
export interface Geo { pins: ReadonlyArray<{ number: string; at: Pt; dir: Dir }>; ko: Box; env: Box; own: Box }

// ---------------------------------------------------------------------------
// Step 1: matching.

interface NetInfo { kind: string; port: boolean; endpoints: number; ifaces: Set<string> }

export function matchTemplates(g: TemplateGraph, library: readonly Template[], skip: ReadonlySet<string> = new Set()): Region[] {
  const nets = new Map<string, NetInfo>();
  for (const [t, netId] of [...g.drawnNet].sort((a, b) => cmpStr(a[0], b[0]))) {
    const n = nets.get(netId) ?? { kind: netKind(g.netById.get(netId)!), port: g.portNet.has(netId), endpoints: 0, ifaces: new Set<string>() };
    n.endpoints++;
    const part = t.slice(0, t.indexOf("[")), num = t.slice(part.length + 1, -1);
    for (const i of g.defs[part]?.find((d) => d.number === num)?.iface ?? []) n.ifaces.add(i);
    nets.set(netId, n);
  }
  const found: Array<{ r: Region; order: number }> = [];
  for (const t of library) {
    if (t.status === "stub") continue;
    for (const r of matchOne(t, g, nets)) found.push({ r, order: found.length });
  }
  // Overlaps: template priority, then larger region, then lowest canonical key, then match order.
  const partsKey = (r: Region) => [...r.members, ...r.links].sort(cmpStr).join(",");
  found.sort((p, q) => p.r.template.priority - q.r.template.priority
    || (q.r.members.length + q.r.links.length) - (p.r.members.length + p.r.links.length)
    || cmpStr(partsKey(p.r), partsKey(q.r)) || p.order - q.order);
  const claimed = new Set<string>();
  const out: Region[] = [];
  for (const { r } of found) {
    if (skip.has(r.key)) continue;
    const all = [...r.members, ...r.links];
    if (all.some((p) => claimed.has(p))) continue;
    for (const p of all) claimed.add(p);
    out.push(r);
  }
  return out;
}

function matchOne(t: Template, g: TemplateGraph, nets: Map<string, NetInfo>): Region[] {
  const single = t.slots.filter((s) => !s.many), many = t.slots.filter((s) => s.many);
  const parts = [...g.parts].sort((a, b) => cmpStr(a.id, b.id));
  const candidates = (s: Slot) => parts
    .filter((p) => s.types.includes(p.type) || (s.types.includes("ic") && (p.type === "ic" || p.type.startsWith("module:"))))
    .filter((p) => g.defs[p.id])
    .sort((a, b) => Number(prefers(s, b)) - Number(prefers(s, a)) || cmpStr(a.id, b.id));
  const netOf = (part: string, num: string) => g.drawnNet.get(`${part}[${num}]`);
  const predOk = (netId: string, p: NetPred | undefined) => {
    if (!p) return true;
    const n = nets.get(netId)!;
    if (p.kind && !p.kind.includes(n.kind as never)) return false;
    if (p.port !== undefined && p.port !== n.port) return false;
    if (p.endpoints !== undefined && n.endpoints !== p.endpoints) return false;
    if (p.minEndpoints !== undefined && n.endpoints < p.minEndpoints) return false;
    if (p.iface !== undefined) {
      const family = p.iface.slice(0, p.iface.indexOf(".") + 1);
      if (!n.ifaces.has(p.iface) || [...n.ifaces].some((i) => i !== p.iface && i.startsWith(family))) return false;
    }
    return true;
  };

  /** Ways a part fits a slot, given the nets bound so far: pin choices and new net bindings. */
  const fits = (s: Slot, part: string, bound: Map<string, string>, allowNew: boolean): Array<{ vars: Map<string, string>; add: Map<string, string> }> => {
    const defs = g.defs[part]!;
    const orders: SlotPin[][] = [s.pins];
    if (s.symmetric && s.pins.length === 2) orders.push([{ ...s.pins[0]!, pin: s.pins[1]!.pin }, { ...s.pins[1]!, pin: s.pins[0]!.pin }]);
    const out: Array<{ vars: Map<string, string>; add: Map<string, string> }> = [];
    for (const spec of orders) {
      const vars = new Map<string, string>(), add = new Map<string, string>();
      let ok = true;
      for (const sp of spec) {
        // `{ on: v }`: the part's pin on the net already bound to variable v.
        const on = typeof sp.pin === "object" && "on" in sp.pin ? (bound.get(sp.pin.on) ?? add.get(sp.pin.on)) : undefined;
        const num = typeof sp.pin === "object" && "on" in sp.pin
          ? defs.map((d) => d.number).sort(cmpNatural).find((n) => on !== undefined && netOf(part, n) === on)
          : pinsFor(defs, sp.pin)[0];
        const net = num === undefined ? undefined : netOf(part, num);
        if (num === undefined || net === undefined) { if (sp.optional) continue; ok = false; break; }
        const taken = new Set([...bound.values(), ...add.values()]);
        if (sp.net === "*") {
          if (taken.has(net) || !predOk(net, sp.pred)) { ok = false; break; }
          vars.set("*", num);
          continue;
        }
        vars.set(sp.net, num);
        const have = bound.get(sp.net) ?? add.get(sp.net);
        if (have !== undefined) { if (have !== net) { ok = false; break; } continue; }
        if (!allowNew || taken.has(net) || !predOk(net, t.nets[sp.net]) || !predOk(net, sp.pred)) { ok = false; break; }
        add.set(sp.net, net);
      }
      if (ok && !out.some((o) => [...o.vars].every(([k, v]) => vars.get(k) === v))) out.push({ vars, add });
    }
    return out;
  };

  const regions: Region[] = [];
  const seen = new Set<string>();
  const first = single[0];
  if (!first) return regions;
  for (const start of candidates(first)) {
    const used = new Set<string>();
    const slots = new Map<string, Bound[]>();
    const search = (i: number, bound: Map<string, string>): Region | undefined => {
      if (i === single.length) {
        // Many-slots: every remaining part that fits with the nets already bound.
        const all = new Map(slots);
        const extra = new Set<string>();
        for (const s of many) {
          const ms: Bound[] = [];
          if (s.follow) {
            // One member per lead member: the only other part on the lead's "*" net.
            for (const lead of all.get(s.follow.slot) ?? []) {
              const pin = lead.vars.get("*"), netId = pin === undefined ? undefined : netOf(lead.part, pin);
              const others = [...g.drawnNet].filter(([t, n]) => n === netId && !t.startsWith(`${lead.part}[`)).map(([t]) => t).sort(cmpStr);
              const part = others.length === 1 ? others[0]!.slice(0, others[0]!.indexOf("[")) : undefined;
              const p = part === undefined ? undefined : candidates(s).find((c) => c.id === part);
              if (!p || used.has(p.id) || extra.has(p.id) || ms.some((m) => m.part === p.id)) { ms.length = 0; break; }
              ms.push({ part: p.id, vars: new Map([["*", others[0]!.slice(p.id.length + 1, -1)]]) });
            }
            for (const m of ms) extra.add(m.part);
            if (ms.length < s.many!.min) return undefined;
            all.set(s.name, ms);
            continue;
          }
          for (const p of candidates(s)) {
            if (used.has(p.id) || extra.has(p.id)) continue;
            const f = fits(s, p.id, bound, false)[0];
            if (f) { ms.push({ part: p.id, vars: f.vars }); extra.add(p.id); }
          }
          if (ms.length < s.many!.min) return undefined;
          all.set(s.name, ms);
        }
        return region(t, all, bound, nets, g.defs);
      }
      const s = single[i]!;
      for (const p of i === 0 ? [start] : candidates(s)) {
        if (used.has(p.id)) continue;
        for (const f of fits(s, p.id, bound, true)) {
          used.add(p.id);
          slots.set(s.name, [{ part: p.id, vars: f.vars }]);
          const r = search(i + 1, new Map([...bound, ...f.add]));
          used.delete(p.id);
          slots.delete(s.name);
          if (r) return r;
        }
      }
      return undefined;
    };
    const r = search(0, new Map());
    if (r && !seen.has(r.key)) { seen.add(r.key); regions.push(r); }
  }
  return regions;
}

function prefers(s: Slot, p: Part): boolean { return !!s.prefer && p.props?.[s.prefer.prop] === s.prefer.value; }

function region(t: Template, slots: Map<string, Bound[]>, nets: Map<string, string>, netInfo: Map<string, NetInfo>, defs: PinDefs): Region {
  const members: string[] = [], links: string[] = [];
  for (const s of t.slots) for (const b of slots.get(s.name) ?? []) (s.role === "member" ? members : links).push(b.part);
  const key = `${t.id}@${t.version}:${[...members, ...links].sort(cmpStr).join(",")}`;
  const netEndpoints = new Map([...nets].map(([v, id]) => [v, netInfo.get(id)?.endpoints ?? 0]));
  return { key, template: t, rep: members[0] ?? links[0]!, members, links, slots, nets, netEndpoints, defs };
}

/** Pin numbers a selector names on a part, in natural order. */
export function pinsFor(defs: readonly PinDef[], sel: PinSel, vars?: ReadonlyMap<string, string>): string[] {
  if (typeof sel === "string") {
    const byName = defs.find((d) => d.name === sel) ?? defs.find((d) => d.number === sel) ?? defs.find((d) => (d.aliases ?? []).includes(sel));
    return byName ? [byName.number] : [];
  }
  if ("net" in sel || "on" in sel) { const n = vars?.get("net" in sel ? sel.net : sel.on); return n === undefined ? [] : [n]; }
  const hit = "iface" in sel ? defs.filter((d) => (d.iface ?? []).includes(sel.iface)) : defs.filter((d) => d.role === sel.role);
  return hit.map((d) => d.number).sort(cmpNatural);
}

// ---------------------------------------------------------------------------
// Per-part data for steps 2-4.

export function slotOf(r: Region, part: string): { slot: Slot; bound: Bound; index: number } | undefined {
  for (const s of r.template.slots) {
    const bs = r.slots.get(s.name) ?? [];
    const index = bs.findIndex((b) => b.part === part);
    if (index >= 0) return { slot: s, bound: bs[index]!, index };
  }
  return undefined;
}

/** The orientation the template asks for (SPEC 9.2 step 3b: "parts not placed by a template"). */
export function templateOrient(r: Region, part: string, sym: SymbolDef): Orient | undefined {
  const s = slotOf(r, part);
  const o = s?.slot.orient;
  if (!s || !o) return undefined;
  if ("rot" in o) return o;
  const num = s.bound.vars.get(o.net);
  const pin = sym.pins.find((p) => p.number === num);
  if (!pin) return undefined;
  for (const rot of [0, 90, 180, 270] as Rot[]) if (xformDir(pin.dir, { rot, flip: false }) === o.dir) return { rot, flip: false };
  return undefined;
}

export function templateLabel(r: Region, part: string): string | undefined { return slotOf(r, part)?.slot.label; }

/** Whether outside wires may attach straight to this member pin (`Template.boundary`). */
export function isBoundary(r: Region, part: string, pinNumber: string): boolean {
  if (!r.members.includes(part) || !r.template.boundary) return true;
  return r.template.boundary.some(([slot, sel]) => (r.slots.get(slot) ?? []).some((b) => b.part === part && pinsFor(r.defs[part] ?? [], sel, b.vars).includes(pinNumber)));
}

export function templateSides(r: Region, part: string): Partial<Record<Side, string[]>> | undefined {
  const s = slotOf(r, part);
  if (!s?.slot.sides) return undefined;
  const out: Partial<Record<Side, string[]>> = {};
  const used = new Set<string>();
  for (const side of ["left", "right", "top", "bottom"] as Side[]) {
    const ns = (s.slot.sides[side] ?? []).flatMap((sel) => pinsFor(r.defs[part] ?? [], sel, s.bound.vars)).filter((n) => !used.has(n) && (used.add(n), true));
    if (ns.length) out[side] = ns;
  }
  return out;
}

/**
 * Explicit ranks (SPEC 9.2 step 2, Appendix A.2): each ranked slot gets the rank the first
 * ranked slot would get on its own, plus its offset (and `step` times its member index).
 */
export function templateRanks(r: Region, natural: (part: string) => number): Map<string, number> {
  const out = new Map<string, number>();
  const ranked = r.template.slots.filter((s) => s.rank && r.slots.get(s.name)?.length);
  if (!ranked.length) return out;
  const head = ranked[0]!;
  const base = natural(r.slots.get(head.name)![0]!.part) - head.rank!.offset;
  for (const s of ranked) r.slots.get(s.name)!.forEach((b, i) => out.set(b.part, base + s.rank!.offset + (s.rank!.step ?? 0) * i));
  return out;
}

// ---------------------------------------------------------------------------
// Constraints.

const guideVar = (axis: "x" | "y", name: string) => `${axis}:@${name}`;

/** Expand a template relation into solver constraints on `x:<part>` / `y:<part>` variables. */
function expand(rel: Rel, r: Region, geo: (id: string) => Geo, priority: Priority, label: string): Constraint[] {
  const out: Constraint[] = [];
  for (const [ia, ib] of pairsOf(rel, r)) {
    const ta = term(rel.a, rel.axis, r, geo, ia), tb = term(rel.b, rel.axis, r, geo, ib);
    if (!ta || !tb || ta.v === tb.v) continue;
    const k = rel.c - ta.off + tb.off;
    const why = `${label}: ${rel.why}`;
    if (rel.op === ">=" || rel.op === "=") out.push({ a: ta.v, b: tb.v, c: k, priority, why });
    if (rel.op === "<=" || rel.op === "=") out.push({ a: tb.v, b: ta.v, c: -k, priority, why });
  }
  return out;
}

function whenOk(when: When | undefined, r: Region): boolean {
  if (!when) return true;
  if ("slot" in when) {
    const n = r.slots.get(when.slot)?.length ?? 0;
    return (when.min === undefined || n >= when.min) && (when.max === undefined || n <= when.max);
  }
  const n = r.netEndpoints.get(when.net) ?? 0;
  return (when.minEndpoints === undefined || n >= when.minEndpoints) && (when.maxEndpoints === undefined || n <= when.maxEndpoints);
}

/** Member indices a relation uses for its `a` and `b` refs (see `Rel.each`). */
function pairsOf(rel: Rel, r: Region): Array<[number, number]> {
  if (!whenOk(rel.when, r)) return [];
  const manyOf = (ref: Ref) => { const s = refSlot(ref); return s && r.template.slots.find((x) => x.name === s)?.many ? s : undefined; };
  const ma = manyOf(rel.a), mb = manyOf(rel.b);
  const slotName = ma ?? mb;
  if (!slotName) return [[0, 0]];
  const n = r.slots.get(slotName)!.length;
  const pairs: Array<[number, number]> = [];
  const each = rel.each ?? "all";
  if (n === 0) return pairs;
  if (each === "first") pairs.push([0, 0]);
  else if (each === "last") pairs.push([ma ? n - 1 : 0, mb ? n - 1 : 0]);
  else if (each === "chain") for (let i = 0; i + 1 < n; i++) pairs.push([ma ? i + 1 : 0, mb ? i : 0]);
  else for (let i = 0; i < n; i++) pairs.push([ma ? i : 0, mb ? i : 0]);
  return pairs;
}

/** Pairs of parts that a template keeps apart sideways (`Rel.apart`): no need to stack them. */
export function apartPairs(r: Region): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const rel of [...(r.template.interior ?? []), ...(r.template.link ?? [])]) if (rel.apart) for (const [ia, ib] of pairsOf(rel, r)) {
    const a = r.slots.get(refSlot(rel.a) ?? "")?.[ia]?.part, b = r.slots.get(refSlot(rel.b) ?? "")?.[ib]?.part;
    if (a && b && a !== b) out.push([a, b]);
  }
  return out;
}

function refSlot(ref: Ref): string | undefined {
  return "pin" in ref ? ref.pin[0] : "box" in ref ? ref.box[0] : "env" in ref ? ref.env[0] : "own" in ref ? ref.own[0] : undefined;
}

function term(ref: Ref, axis: "x" | "y", r: Region, geo: (id: string) => Geo, i: number): { v: string; off: number } | undefined {
  if ("guide" in ref) return { v: guideVar(axis, ref.guide), off: 0 };
  const b = r.slots.get(refSlot(ref)!)?.[i];
  if (!b) return undefined;
  const G = geo(b.part);
  const v = `${axis}:${b.part}`;
  if ("pin" in ref) {
    const num = pinsFor(r.defs[b.part] ?? [], ref.pin[1], b.vars)[0];
    const p = G.pins.find((q) => q.number === num);
    return p ? { v, off: p.at[axis === "x" ? 0 : 1] } : undefined;
  }
  const [, edge] = "box" in ref ? ref.box : "own" in ref ? ref.own : ref.env;
  const box = "box" in ref ? G.ko : "own" in ref ? G.own : G.env;
  if ((edge === "left" || edge === "right") !== (axis === "x")) throw new Error(`template ${r.template.id}: edge ${edge} used on axis ${axis}`);
  return { v, off: edge === "left" ? box.x : edge === "right" ? box.x + box.w : edge === "top" ? box.y : box.y + box.h };
}

export interface Interior {
  /** Member origin relative to the representative's origin. */
  offsets: Map<string, Pt>;
  /** Guides relative to the representative's origin (an axis a guide is not used on is 0). */
  guides: Map<string, Pt>;
  /** Region envelope relative to the representative's origin. */
  env: Box;
}

/**
 * Step 5: solve the region interior with the same difference-constraint solver. A contradiction
 * is proven infeasibility for this template and these sizes; overlapping members are refused too.
 */
export function solveInterior(r: Region, geo: (id: string) => Geo): Interior | { failed: string } {
  const vars = r.members.flatMap((m) => [`x:${m}`, `y:${m}`]);
  const cons = (r.template.interior ?? []).flatMap((rel) => expand(rel, r, geo, "structural", r.template.id));
  for (const k of cons) for (const v of [k.a, k.b]) if (!vars.includes(v)) vars.push(v);
  const sol = solveWithDrops(vars, cons, 0);
  if (!sol.ok) return { failed: `interior constraints contradict (${sol.cycle.map((k) => k.why).join("; ")})` };
  const rx = sol.value.get(`x:${r.rep}`)!, ry = sol.value.get(`y:${r.rep}`)!;
  const offsets = new Map<string, Pt>(r.members.map((m) => [m, [sol.value.get(`x:${m}`)! - rx, sol.value.get(`y:${m}`)! - ry]]));
  const guides = new Map<string, Pt>();
  for (const v of vars) if (v.includes(":@")) {
    const name = v.slice(3), g = guides.get(name) ?? [0, 0];
    guides.set(name, v.startsWith("x") ? [sol.value.get(v)! - rx, g[1]] : [g[0], sol.value.get(v)! - ry]);
  }
  const envs = r.members.map((m) => { const e = geo(m).env, o = offsets.get(m)!; return { m, box: { x: e.x + o[0], y: e.y + o[1], w: e.w, h: e.h } }; });
  for (let i = 0; i < envs.length; i++) for (let j = i + 1; j < envs.length; j++) {
    if (boxesOverlap(envs[i]!.box, envs[j]!.box)) return { failed: `${envs[i]!.m} and ${envs[j]!.m} overlap inside the region` };
  }
  let env = envs.map((e) => e.box).reduce((a, b) => unionBox(a, b));
  // Reserved columns (`Template.reserve`) widen the envelope; its height stays the members' own.
  for (const name of r.template.reserve ?? []) {
    const g = guides.get(name);
    if (g) env = unionBox(env, { x: g[0], y: env.y, w: 0, h: env.h });
  }
  return { offsets, guides, env };
}

/**
 * Rows of a template's horizontal runs that leave the region's own block (a bus trunk from the
 * controller to the peripherals): the part whose pin sets the row, the row as an offset from that
 * part's origin, and every part at either end of the run. Rows set by a guide are left out.
 */
export function trunkRows(r: Region, geo: (id: string) => Geo): Array<{ net: string; part: string; off: number; ends: string[] }> {
  const out: Array<{ net: string; part: string; off: number; ends: string[] }> = [];
  const parts = (ref: Ref | Ref[]) => (Array.isArray(ref) ? ref : [ref]).flatMap((x) => { const s = refSlot(x); return s ? (r.slots.get(s) ?? []).map((b) => b.part) : []; });
  for (const tr of r.template.trunks ?? []) {
    if (!whenOk(tr.when, r)) continue;
    const netId = r.nets.get(tr.net);
    if (!netId) continue;
    for (let i = 0; i + 1 < tr.points.length; i++) {
      const [p, q] = [tr.points[i]!, tr.points[i + 1]!];
      if (Array.isArray(p.y) || JSON.stringify(p.y) !== JSON.stringify(q.y) || (p.dy ?? 0) !== (q.dy ?? 0)) continue;
      const t = term(p.y, "y", r, geo, 0);
      const owner = refSlot(p.y) && r.slots.get(refSlot(p.y)!)?.[0]?.part;
      if (!t || !owner) continue;
      out.push({ net: netId, part: owner, off: t.off + (p.dy ?? 0), ends: [...new Set([...parts(p.x), ...parts(q.x)])] });
    }
  }
  return out;
}

/** Step 6: constraints linking the region to its link slots, at priority `template`. */
export function linkConstraints(r: Region, geo: (id: string) => Geo, priority: Priority = "template"): Constraint[] {
  return (r.template.link ?? []).flatMap((rel) => expand(rel, r, geo, priority, r.template.id));
}

/**
 * Step 7: the template's pre-routed runs, in sheet coordinates, by net id. `at` gives a part's
 * origin. A run is left out when a required pin faces another way or a point is missing.
 */
export function trunkRuns(r: Region, geo: (id: string) => Geo, at: (id: string) => Pt, interior: Interior | undefined): Map<string, Pt[][]> {
  const out = new Map<string, Pt[][]>();
  const abs = (ref: Ref, axis: 0 | 1, agg: "min" | "max"): number | undefined => {
    if ("guide" in ref) { const g = interior?.guides.get(ref.guide); return g === undefined ? undefined : at(r.rep)[axis] + g[axis]; }
    const vals: number[] = [];
    for (const b of r.slots.get(refSlot(ref)!) ?? []) {
      const G = geo(b.part), o = at(b.part);
      if ("pin" in ref) {
        const num = pinsFor(r.defs[b.part] ?? [], ref.pin[1], b.vars)[0];
        const p = G.pins.find((q) => q.number === num);
        if (p) vals.push(o[axis] + p.at[axis]);
      } else {
        const [, edge] = "box" in ref ? ref.box : "own" in ref ? ref.own : ref.env;
        const box = "box" in ref ? G.ko : "own" in ref ? G.own : G.env;
        vals.push(o[axis] + (edge === "left" ? box.x : edge === "right" ? box.x + box.w : edge === "top" ? box.y : box.y + box.h));
      }
    }
    if (!vals.length) return undefined;
    return (ref.agg ?? agg) === "min" ? Math.min(...vals) : Math.max(...vals);
  };
  for (const tr of r.template.trunks ?? []) {
    if (!whenOk(tr.when, r)) continue;
    const netId = r.nets.get(tr.net);
    if (!netId) continue;
    const ok = (tr.require ?? []).every((q) => (r.slots.get(q.pin[0]) ?? []).every((b) => {
      const num = pinsFor(r.defs[b.part] ?? [], q.pin[1], b.vars)[0];
      return geo(b.part).pins.find((p) => p.number === num)?.dir === q.dir;
    }));
    if (!ok) continue;
    const pts: Pt[] = [];
    for (const p of tr.points) {
      const agg = p.agg ?? "max";
      const coord = (refs: Ref | Ref[], axis: 0 | 1) => {
        const vs = (Array.isArray(refs) ? refs : [refs]).map((x) => abs(x, axis, agg));
        return vs.some((v) => v === undefined) ? undefined : agg === "min" ? Math.min(...(vs as number[])) : Math.max(...(vs as number[]));
      };
      const x = coord(p.x, 0), y = coord(p.y, 1);
      if (x === undefined || y === undefined) { pts.length = 0; break; }
      pts.push([x + (p.dx ?? 0), y + (p.dy ?? 0)]);
    }
    const straight = pts.every((p, i) => i === 0 || p[0] === pts[i - 1]![0] || p[1] === pts[i - 1]![1]);
    const long = pts.some((p, i) => i > 0 && (p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1]));
    if (pts.length >= 2 && straight && long) out.set(netId, [...(out.get(netId) ?? []), pts]);
  }
  return out;
}
