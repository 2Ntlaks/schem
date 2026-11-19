// The single validator for loads and edits (SPEC 6.2-6.3).

import { cmpNatural } from "../geom/geom.js";
import { canonical, type Circuit, type Endpoint, type Issue, type PinDef, type PinDefs } from "./model.js";

const TERMINAL = /^([A-Za-z][A-Za-z0-9_]*)\[([A-Za-z0-9_+\-]+)\]$/;
const GROUP = /^([A-Za-z][A-Za-z0-9_]*)\{([A-Za-z0-9_+\-]+)\}$/;
const NAMED = /^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_+\-]+)$/;

export type Resolved = { ok: true; ep: Endpoint } | { ok: false; issue: Issue };

/** Resolve one endpoint string against the pin inventory (SPEC 6.2). */
export function resolveEndpoint(text: string, pinDefs: PinDefs): Resolved {
  const fail = (code: string, message: string): Resolved => ({ ok: false, issue: { code, message, at: text } });
  let m = TERMINAL.exec(text);
  if (m) {
    const [, part, num] = m as unknown as [string, string, string];
    const pins = pinDefs[part];
    if (!Array.isArray(pins)) return fail("E251", `unknown part "${part}" in "${text}".`);
    if (!pins.some((p) => p.number === num)) return fail("E104", `unknown pin "${text}". ${part} has pins ${listPins(pins)}.`);
    return { ok: true, ep: { kind: "terminal", part, number: num } };
  }
  m = GROUP.exec(text);
  if (m) {
    const [, part, group] = m as unknown as [string, string, string];
    const pins = pinDefs[part];
    if (!Array.isArray(pins)) return fail("E251", `unknown part "${part}" in "${text}".`);
    if (!pins.some((p) => p.group === group)) return fail("E104", `${part} has no pin group "${group}".`);
    return { ok: true, ep: { kind: "group", part, group } };
  }
  m = NAMED.exec(text);
  if (m) {
    const [, part, name] = m as unknown as [string, string, string];
    const pins = pinDefs[part];
    if (!Array.isArray(pins)) return fail("E251", `unknown part "${part}" in "${text}".`);
    const hits = pins.filter((p) => p.name === name || (p.aliases ?? []).includes(name));
    if (hits.length === 0) return fail("E104", `unknown pin "${text}". ${part} has pins ${listPins(pins)}.`);
    if (hits.length === 1) return { ok: true, ep: { kind: "terminal", part, number: hits[0]!.number } };
    const g = hits[0]!.group;
    if (g !== undefined && hits.every((p) => p.group === g)) return { ok: true, ep: { kind: "group", part, group: g } };
    const nums = hits.map((p) => `${part}[${p.number}]`).sort(cmpNatural);
    return fail("E106", `"${text}" matches pins ${hits.map((p) => p.number).join(", ")} that are not grouped. Use ${nums.join(" or ")}.`);
  }
  return fail("E104", `"${text}" is not a pin reference.`);
}

function listPins(pins: PinDef[]): string {
  return pins.map((p) => (p.name === p.number ? p.number : `${p.number} (${p.name})`)).join(", ");
}

/** Equivalence class of an endpoint (SPEC 6.2): a group, or a single ungrouped terminal. */
export function classOf(ep: Endpoint, pinDefs: PinDefs): string {
  if (ep.kind === "group") return `${ep.part}{${ep.group}}`;
  const g = pinDefs[ep.part]?.find((p) => p.number === ep.number)?.group;
  return g !== undefined ? `${ep.part}{${g}}` : canonical(ep);
}

/**
 * Representative terminal of a group (SPEC 6.2, rev C.3): the member the module names as preferred,
 * if it is not marked no-connect; otherwise the lowest-numbered member not marked no-connect.
 */
export function groupRepresentative(part: string, group: string, pinDefs: PinDefs, nc: ReadonlySet<string> = new Set()): string | undefined {
  const members = (pinDefs[part] ?? []).filter((p) => p.group === group && !nc.has(`${part}[${p.number}]`));
  const preferred = members.find((p) => p.representative);
  return preferred ? preferred.number : members.map((p) => p.number).sort(cmpNatural)[0];
}

export interface ValidCircuit {
  circuit: Circuit;
  /** Canonical endpoints per net id, in the net's order. */
  endpoints: Map<string, Endpoint[]>;
  /** Equivalence class -> net id. */
  classNet: Map<string, string>;
  nc: Endpoint[];
}

/** Check every invariant of SPEC 6.3 and resolve endpoints. Returns issues (empty = valid). */
export function validate(circuit: Circuit, pinDefs: PinDefs): { issues: Issue[]; valid?: ValidCircuit } {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  for (const p of circuit.parts) {
    if (ids.has(p.id)) issues.push({ code: "E250", message: `duplicate part id "${p.id}".`, at: p.id });
    ids.add(p.id);
  }
  const names = new Map<string, string>();
  const endpoints = new Map<string, Endpoint[]>();
  const classNet = new Map<string, string>();
  const classFirst = new Map<string, string>(); // class -> canonical endpoint text that claimed it first
  const terminalNet = new Map<string, string>();
  for (const net of circuit.nets) {
    if (net.name !== undefined) {
      const prev = names.get(net.name);
      if (prev !== undefined) issues.push({ code: "E240", message: `net name "${net.name}" is used by nets ${prev} and ${net.id}.`, at: net.id });
      else names.set(net.name, net.id);
    }
    if (net.endpoints.length === 0) issues.push({ code: "E241", message: `net ${net.id} has no endpoints.`, at: net.id });
    const eps: Endpoint[] = [];
    for (const text of net.endpoints) {
      const r = resolveEndpoint(text, pinDefs);
      if (!r.ok) { issues.push(r.issue); continue; }
      if (!ids.has(r.ep.part)) { issues.push({ code: "E251", message: `unknown part "${r.ep.part}".`, at: text }); continue; }
      const c = classOf(r.ep, pinDefs);
      const owner = classNet.get(c);
      const canon = canonical(r.ep);
      if (owner !== undefined && owner !== net.id) {
        const isGroup = c.includes("{");
        const first = classFirst.get(c)!;
        if (isGroup && first !== canon) {
          issues.push({ code: "E222", message: `${canon} is connected inside ${r.ep.part} to ${first}, which is in net ${owner}. Putting it in net ${net.id} would short them.`, at: text });
        } else {
          issues.push({ code: "E220", message: `${canon} is already in net ${owner}. A pin can be in one net only.`, at: text });
        }
        continue;
      }
      classNet.set(c, net.id);
      if (!classFirst.has(c)) classFirst.set(c, canon);
      if (r.ep.kind === "terminal") terminalNet.set(canon, net.id);
      eps.push(r.ep);
    }
    endpoints.set(net.id, eps);
  }
  const nc: Endpoint[] = [];
  for (const text of circuit.nc ?? []) {
    const r = resolveEndpoint(text, pinDefs);
    if (!r.ok) { issues.push(r.issue); continue; }
    if (r.ep.kind === "group") { issues.push({ code: "E224", message: `no-connect must name a terminal, not the group ${canonical(r.ep)}.`, at: text }); continue; }
    const canon = canonical(r.ep);
    const inNet = terminalNet.get(canon) ?? (classOf(r.ep, pinDefs) === canon ? classNet.get(canon) : undefined);
    if (inNet !== undefined) { issues.push({ code: "E223", message: `${canon} is marked no-connect but is in net ${inNet}.`, at: text }); continue; }
    nc.push(r.ep);
  }
  const ncSet = new Set(nc.map(canonical));
  for (const [netId, eps] of endpoints) for (const ep of eps) {
    if (ep.kind === "group" && groupRepresentative(ep.part, ep.group, pinDefs, ncSet) === undefined)
      issues.push({ code: "E225", message: `every pin of group ${canonical(ep)} is marked no-connect, so net ${netId} cannot use it.`, at: canonical(ep) });
  }
  if (issues.length) return { issues };
  return { issues, valid: { circuit, endpoints, classNet, nc } };
}
