// Circuit operations (SPEC 11.3) and the merge rules (SPEC 6.3).

import { cmpNatural } from "../geom/geom.js";
import { canonical, CircuitError, netKind, type Circuit, type Issue, type Net, type PinDef, type PinDefs } from "./model.js";
import { classOf, resolveEndpoint, validate } from "./validate.js";

export type CircuitOp =
  | { op: "connect"; endpoints: string[]; name?: string }
  | { op: "disconnect"; endpoint: string }
  | { op: "mergeNets"; nets: string[]; keep: string; sameSupply?: boolean }
  | { op: "renameNet"; net: string; name: string }
  | { op: "setNoConnect"; terminal: string; nc: boolean }
  | { op: "renamePart"; from: string; to: string }
  | { op: "removePart"; part: string }
  | { op: "addPart"; part: { id: string; type: string; props?: Record<string, string> }; pins?: PinDef[] }
  | { op: "setProp"; part: string; key: string; value: string | null };

/**
 * Apply operations as one transaction. Returns the new circuit and pin inventory,
 * or throws CircuitError with every issue; the inputs are never modified.
 */
export function applyOps(circuit: Circuit, pinDefs: PinDefs, ops: CircuitOp[]): { circuit: Circuit; pinDefs: PinDefs } {
  const first = validate(circuit, pinDefs);
  if (first.issues.length) throw new CircuitError(first.issues);
  let c: Circuit = structuredClone(circuit);
  let defs: PinDefs = structuredClone(pinDefs);
  for (const op of ops) [c, defs] = applyOne(c, defs, op);
  const end = validate(c, defs);
  if (end.issues.length) throw new CircuitError(end.issues);
  return { circuit: c, pinDefs: defs };
}

function fail(code: string, message: string): never { throw new CircuitError([{ code, message }]); }

function nextNetId(c: Circuit): string {
  let max = 0;
  for (const n of c.nets) { const m = /^n(\d+)$/.exec(n.id); if (m) max = Math.max(max, Number(m[1])); }
  return `n${max + 1}`;
}

function applyOne(c: Circuit, defs: PinDefs, op: CircuitOp): [Circuit, PinDefs] {
  switch (op.op) {
    case "connect": {
      const resolved = op.endpoints.map((t) => {
        const r = resolveEndpoint(t, defs);
        if (!r.ok) throw new CircuitError([r.issue]);
        return r.ep;
      });
      const classOfNet = classIndex(c, defs);
      const hit = new Set<string>();
      for (const ep of resolved) { const n = classOfNet.get(classOf(ep, defs)); if (n) hit.add(n); }
      let target: Net;
      if (hit.size === 0) {
        target = { id: nextNetId(c), endpoints: [] };
        if (op.name !== undefined) target.name = op.name;
        c.nets.push(target);
      } else {
        const nets = c.nets.filter((n) => hit.has(n.id));
        target = merge(c, nets, undefined, false);
        if (op.name !== undefined) {
          if (target.name !== undefined && target.name !== op.name) fail("E233", `connect names the net "${op.name}" but it merges into "${target.name}". Use mergeNets with keep.`);
          target.name = op.name;
        }
      }
      for (const ep of resolved) {
        const t = canonical(ep);
        if (!target.endpoints.includes(t)) target.endpoints.push(t);
      }
      return [c, defs];
    }
    case "mergeNets": {
      const nets = op.nets.map((id) => c.nets.find((n) => n.id === id || n.name === id) ?? fail("E241", `unknown net "${id}".`));
      merge(c, nets, op.keep, op.sameSupply ?? false);
      return [c, defs];
    }
    case "disconnect": {
      const r = resolveEndpoint(op.endpoint, defs);
      if (!r.ok) throw new CircuitError([r.issue]);
      const t = canonical(r.ep);
      const net = c.nets.find((n) => n.endpoints.some((e) => canonicalText(e, defs) === t));
      if (!net) fail("E104", `${t} is not in any net.`);
      net.endpoints = net.endpoints.filter((e) => canonicalText(e, defs) !== t);
      if (net.endpoints.length === 0) c.nets = c.nets.filter((n) => n !== net);
      return [c, defs];
    }
    case "renameNet": {
      const net = c.nets.find((n) => n.id === op.net) ?? fail("E241", `unknown net "${op.net}".`);
      if (c.nets.some((n) => n !== net && n.name === op.name)) fail("E240", `net name "${op.name}" is already used.`);
      net.name = op.name;
      return [c, defs];
    }
    case "setNoConnect": {
      const r = resolveEndpoint(op.terminal, defs);
      if (!r.ok) throw new CircuitError([r.issue]);
      if (r.ep.kind === "group") fail("E224", `no-connect must name a terminal, not the group ${canonical(r.ep)}.`);
      const t = canonical(r.ep);
      const rest = (c.nc ?? []).filter((e) => canonicalText(e, defs) !== t);
      c.nc = op.nc ? [...rest, t] : rest;
      return [c, defs];
    }
    case "renamePart": {
      if (!c.parts.some((p) => p.id === op.from)) fail("E251", `unknown part "${op.from}".`);
      if (c.parts.some((p) => p.id === op.to)) fail("E250", `part "${op.to}" already exists.`);
      const re = (e: string) => (e.startsWith(op.from) && /^[[{.]/.test(e.slice(op.from.length)) ? op.to + e.slice(op.from.length) : e);
      for (const p of c.parts) if (p.id === op.from) p.id = op.to;
      for (const n of c.nets) n.endpoints = n.endpoints.map(re);
      c.nc = (c.nc ?? []).map(re);
      const d = defs[op.from]!;
      defs = { ...defs, [op.to]: d };
      delete defs[op.from];
      return [c, defs];
    }
    case "removePart": {
      if (!c.parts.some((p) => p.id === op.part)) fail("E251", `unknown part "${op.part}".`);
      const mine = (e: string) => e.startsWith(op.part) && /^[[{.]/.test(e.slice(op.part.length));
      c.parts = c.parts.filter((p) => p.id !== op.part);
      for (const n of c.nets) n.endpoints = n.endpoints.filter((e) => !mine(e));
      c.nets = c.nets.filter((n) => n.endpoints.length > 0);
      c.nc = (c.nc ?? []).filter((e) => !mine(e));
      defs = { ...defs };
      delete defs[op.part];
      return [c, defs];
    }
    case "addPart": {
      if (c.parts.some((p) => p.id === op.part.id)) fail("E250", `part "${op.part.id}" already exists.`);
      c.parts.push(structuredClone(op.pins ? { ...op.part, pins: op.pins } : op.part)); // pins kept on the part, as in the file
      defs = { ...defs, [op.part.id]: structuredClone(op.pins ?? defs[op.part.id] ?? []) };
      return [c, defs];
    }
    case "setProp": {
      const p = c.parts.find((x) => x.id === op.part);
      if (!p) fail("E251", `unknown part "${op.part}".`);
      const props = { ...(p.props ?? {}) };
      if (op.value === null) delete props[op.key]; else props[op.key] = op.value;
      if (Object.keys(props).length) p.props = props; else delete p.props;
      return [c, defs];
    }
  }
}

function canonicalText(e: string, defs: PinDefs): string {
  const r = resolveEndpoint(e, defs);
  return r.ok ? canonical(r.ep) : e;
}

function classIndex(c: Circuit, defs: PinDefs): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of c.nets) for (const e of n.endpoints) {
    const r = resolveEndpoint(e, defs);
    if (r.ok) m.set(classOf(r.ep, defs), n.id);
  }
  return m;
}

/** SPEC 6.3 merge rules 1-6, in order. Mutates `c`; returns the surviving net. */
function merge(c: Circuit, nets: Net[], keep: string | undefined, sameSupply: boolean): Net {
  const uniq = [...new Map(nets.map((n) => [n.id, n])).values()];
  if (uniq.length === 1) return uniq[0]!;
  const kinds = uniq.map(netKind);
  const issues: Issue[] = [];
  const label = (n: Net) => (n.name ? `${n.name} (${n.id})` : n.id);
  if (kinds.includes("power") && kinds.includes("ground"))
    fail("E230", `cannot merge power and ground nets: ${uniq.map(label).join(", ")}.`);
  const domains = [...new Set(uniq.map((n) => n.domain).filter((d): d is string => !!d))];
  if (domains.length > 1) fail("E231", `cannot merge nets of different domains (${domains.join(", ")}).`);
  const named = uniq.filter((n) => n.name !== undefined);
  const names = [...new Set(named.map((n) => n.name!))];
  const powerNamed = [...new Set(uniq.filter((n) => netKind(n) === "power" && n.name !== undefined).map((n) => n.name!))];
  const keepNet = keep === undefined ? undefined : uniq.find((n) => n.id === keep || n.name === keep);
  if (keep !== undefined && !keepNet) fail("E233", `keep "${keep}" is not one of the nets being merged.`);
  if (powerNamed.length > 1 && !(keepNet && sameSupply))
    fail("E232", `merging different supplies ${powerNamed.join(" and ")} needs mergeNets with keep and sameSupply: true.`);
  if (names.length > 1 && !keepNet) fail("E233", `merging nets named ${names.join(" and ")} needs mergeNets with keep.`);
  if (issues.length) throw new CircuitError(issues);
  const survivor = keepNet ?? (named.length === 1 ? named[0]! : [...uniq].sort((a, b) => cmpNatural(a.id, b.id))[0]!);
  const kind = kinds.includes("ground") ? "ground" : kinds.includes("power") ? "power" : "signal";
  const endpoints: string[] = [];
  for (const n of [survivor, ...uniq.filter((n) => n !== survivor)]) for (const e of n.endpoints) if (!endpoints.includes(e)) endpoints.push(e);
  survivor.endpoints = endpoints;
  if (kind !== "signal" || survivor.kind) survivor.kind = kind;
  if (domains[0]) survivor.domain = domains[0];
  c.nets = c.nets.filter((n) => n === survivor || !uniq.includes(n));
  return survivor;
}
