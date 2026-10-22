// Independent verifier (SPEC 9.7). Reads only the circuit, the pin inventory and
// the drawn electrical primitives. Must not import anything from src/layout.

import { cmpNatural, cmpStr, DELTA, DIRS, edgeKey, key, opposite, step, unitEdges, type Dir, type Pt } from "../geom/geom.js";
import { edgeForbidden } from "../geom/forbidden.js";
import { canonical, netKind, type Circuit, type PinDefs } from "../core/model.js";
import { groupRepresentative, validate } from "../core/validate.js";
import type { Electrical } from "../render/model.js";

export interface VerifyIssue { code: string; message: string; at?: string }
export interface VerifyResult { valid: boolean; errors: VerifyIssue[]; warnings: VerifyIssue[] }

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) { p = this.find(p); this.parent.set(x, p); }
    else this.parent.set(x, x);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (cmpStr(ra, rb) < 0) this.parent.set(rb, ra); else this.parent.set(ra, rb);
  }
}

export function verify(circuit: Circuit, pinDefs: PinDefs, el: Electrical): VerifyResult {
  const errors: VerifyIssue[] = [];
  const warnings: VerifyIssue[] = [];
  const err = (code: string, message: string, at?: string) => errors.push(at === undefined ? { code, message } : { code, message, at });

  const v = validate(circuit, pinDefs);
  if (!v.valid) {
    for (const i of v.issues) err("invalid-circuit", `${i.code} ${i.message}`, i.at);
    return { valid: false, errors, warnings };
  }
  const { endpoints, nc } = v.valid;
  const ncSet = new Set(nc.map(canonical));

  // ---- 1. Conductors, normalised to unit edges (segmentation-independent) ----
  const edges = new Set<string>();
  const pointDirs = new Map<string, Set<Dir>>();
  for (const poly of el.wires) {
    let list: Array<[Pt, Pt]>;
    try { list = unitEdges(poly); } catch (e) { err("non-orthogonal", (e as Error).message); continue; }
    for (const [a, b] of list) {
      edges.add(edgeKey(a, b));
      addDir(pointDirs, a, dirOf(a, b));
      addDir(pointDirs, b, dirOf(b, a));
    }
  }

  const pinsAt = new Map<string, Array<{ id: string; dir: Dir }>>();
  const drawn = new Map<string, { at: Pt; dir: Dir }>();
  for (const p of el.pins) {
    const id = `${p.part}[${p.number}]`;
    if (drawn.has(id)) { err("duplicate-pin", `${id} is drawn twice.`, id); continue; }
    if (!(pinDefs[p.part] ?? []).some((d) => d.number === p.number)) { err("unknown-pin", `${id} is drawn but does not exist.`, id); continue; }
    drawn.set(id, { at: p.at, dir: p.dir });
    const k = key(p.at);
    pinsAt.set(k, [...(pinsAt.get(k) ?? []), { id, dir: p.dir }]);
  }
  const dots = new Set(el.dots.map(key));
  const portsAt = new Map<string, string[]>();
  for (const p of el.ports) {
    const k = key(p.at);
    portsAt.set(k, [...(portsAt.get(k) ?? []), portKey(p.kind, p.text, p.domain)]);
  }

  // ---- 2. Contact classification at every point of interest ----
  const uf = new UnionFind();
  const points = new Set<string>([...pointDirs.keys(), ...pinsAt.keys(), ...dots, ...portsAt.keys()]);
  for (const k of [...points].sort(cmpStr)) {
    const p = k.split(",").map(Number) as unknown as Pt;
    const dirs = pointDirs.get(k) ?? new Set<Dir>();
    const n = dirs.size;
    const pins = pinsAt.get(k) ?? [];
    const ports = portsAt.get(k) ?? [];
    const hasDot = dots.has(k);
    const e = (d: Dir) => `e:${edgeKey(p, step(p, d))}`;
    const all = [...dirs].map(e);

    if (pins.length > 0) {
      for (const pin of pins) {
        if (n >= 2) {
          if ((dirs.has("left") && dirs.has("right")) || (dirs.has("up") && dirs.has("down"))) err("pin-pass-through", `a wire passes through ${pin.id}.`, pin.id);
          else err("pin-side-entry", `a wire joins ${pin.id} from the side.`, pin.id);
        } else if (n === 1 && !dirs.has(pin.dir)) {
          err("pin-side-entry", `a wire reaches ${pin.id} from the ${[...dirs][0]} side, but the pin faces ${pin.dir}.`, pin.id);
        }
        for (const x of all) uf.union(`pin:${pin.id}`, x);
        for (const x of ports) uf.union(`pin:${pin.id}`, x);
      }
      if (pins.length > 1) err("pin-contact", `pins ${pins.map((q) => q.id).join(" and ")} sit on the same point ${k}.`, k);
      if (hasDot && n < 3) err("dot-degree", `junction dot at ${k} where ${n} wire directions meet.`, k);
      continue;
    }

    if (ports.length > 0) {
      if (n !== 1) err("port-off-wire", `a port or label at ${k} is not on a wire end or pin.`, k);
      for (const x of [...all, ...ports.slice(1)]) uf.union(ports[0]!, x);
      if (hasDot) err("dot-degree", `junction dot at ${k} on a port anchor.`, k);
      continue;
    }

    if (n === 1) err("dangling", `a wire ends at ${k} without reaching a pin or port.`, k);
    else if (n === 2) { uf.union(all[0]!, all[1]!); if (hasDot) err("dot-degree", `junction dot at ${k} where only 2 wire directions meet.`, k); }
    else if (n === 3) { for (const x of all.slice(1)) uf.union(all[0]!, x); if (!hasDot) err("ambiguous-t", `three wires meet at ${k} without a junction dot.`, k); }
    else if (n === 4) {
      if (hasDot) { for (const x of all.slice(1)) uf.union(all[0]!, x); err("four-way-junction", `four wires meet at ${k} with a dot; split it into two T junctions.`, k); }
      else { uf.union(e("left"), e("right")); uf.union(e("up"), e("down")); }
    } else if (hasDot) err("dot-degree", `junction dot at ${k} with no wires.`, k);
  }

  // ---- 3. Keep-outs: no unit edge whose midpoint lies inside or on a keep-out box ----
  const obstacles = (el.keepouts ?? []).map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h, owner: k.part }));
  const reported = new Set<string>();
  for (const ek of [...edges].sort(cmpStr)) {
    const [a, b] = ek.split("|").map((s) => s.split(",").map(Number)) as unknown as [Pt, Pt];
    const hit = edgeForbidden(a, b, obstacles);
    if (hit && !reported.has(hit.owner)) {
      reported.add(hit.owner);
      err("wire-in-keepout", `a wire runs inside or along the keep-out of ${hit.owner} near ${key(a)}.`, hit.owner);
    }
  }

  // ---- 4. Expected inventory from the circuit, not from what is visible ----
  const attached = (id: string) => {
    const pin = drawn.get(id);
    if (!pin) return false;
    const k = key(pin.at);
    return (pointDirs.get(k)?.size ?? 0) > 0 || (portsAt.get(k)?.length ?? 0) > 0 || (pinsAt.get(k)?.length ?? 0) > 1;
  };
  const expected = new Map<string, string[]>(); // net id -> drawn terminal ids that represent its endpoints
  const netOfDrawn = new Map<string, string>();
  for (const [netId, eps] of endpoints) {
    const ids: string[] = [];
    for (const ep of eps) {
      const id = ep.kind === "terminal" ? canonical(ep) : `${ep.part}[${groupRepresentative(ep.part, ep.group, pinDefs, ncSet)}]`;
      if (!drawn.has(id)) { err("hidden-connected", `${canonical(ep)} is in net ${netId} but ${id} is not drawn.`, id); continue; }
      ids.push(id);
      netOfDrawn.set(id, netId);
    }
    expected.set(netId, [...new Set(ids)]);
  }
  // Pins of one group are joined inside the part.
  const groupOf = (id: string) => {
    const m = /^(.+)\[(.+)\]$/.exec(id)!;
    const g = pinDefs[m[1]!]?.find((d) => d.number === m[2])?.group;
    return g === undefined ? undefined : `${m[1]}{${g}}`;
  };
  for (const id of drawn.keys()) { const g = groupOf(id); if (g) uf.union(`pin:${id}`, `grp:${g}`); }

  for (const [netId, ids] of expected) {
    const distinctClasses = new Set(ids.map((id) => groupOf(id) ?? id));
    if (distinctClasses.size < 2) continue;
    for (const id of ids) if (!attached(id)) err("missing-endpoint", `${id} belongs to net ${netId} but nothing is attached to it.`, id);
  }
  for (const ep of nc) {
    const id = canonical(ep);
    if (!drawn.has(id)) { err("hidden-connected", `${id} is marked no-connect but is not drawn.`, id); continue; }
    if (!el.ncMarks.some((m) => m.part === ep.part && m.number === (ep as { number: string }).number)) err("nc-not-marked", `${id} is no-connect but has no mark.`, id);
    if (attached(id)) err("nc-attached", `${id} is no-connect but something is attached.`, id);
  }
  for (const m of el.ncMarks) {
    const id = `${m.part}[${m.number}]`;
    if (!nc.some((ep) => canonical(ep) === id)) err("nc-not-in-circuit", `${id} has a no-connect mark but is not no-connect in the circuit.`, id);
    if (attached(id)) err("nc-attached", `${id} has a no-connect mark but something is attached.`, id);
  }
  for (const id of drawn.keys()) {
    if (!netOfDrawn.has(id) && !ncSet.has(id) && attached(id))
      err("unconnected-attached", `${id} is in no net, but something is attached to it.`, id);
  }

  // ---- 5. Topology: drawn groups must equal the circuit's nets exactly ----
  const rootNets = new Map<string, Set<string>>();
  for (const id of [...drawn.keys()].sort(cmpNatural)) {
    const r = uf.find(`pin:${id}`);
    // A no-connect member of a group is still joined to its group inside the part.
    const net = netOfDrawn.get(id) ?? groupNet(id) ?? (ncSet.has(id) ? `nc:${id}` : undefined);
    if (!rootNets.has(r)) rootNets.set(r, new Set());
    if (net !== undefined) rootNets.get(r)!.add(net);
    else if (attached(id)) rootNets.get(r)!.add(`unconnected:${id}`);
  }
  function groupNet(id: string): string | undefined {
    const g = groupOf(id);
    if (!g) return undefined;
    for (const [o, n] of netOfDrawn) if (groupOf(o) === g) return n;
    return undefined;
  }
  for (const [, nets] of rootNets) {
    const real = [...nets].sort(cmpStr);
    if (real.length > 1) err("topology-mismatch", `the drawing connects ${real.join(" and ")}, which the circuit keeps separate.`);
  }
  for (const [netId, ids] of expected) {
    const roots = new Set(ids.map((id) => uf.find(`pin:${id}`)));
    if (roots.size > 1) err("topology-mismatch", `net ${netId} is drawn in ${roots.size} separate pieces.`, netId);
  }
  // Ports and labels must say what their net is (rev C.1): text = name, domain = domain, class = kind.
  const netById = new Map(circuit.nets.map((n) => [n.id, n]));
  for (const port of el.ports) {
    const nets = [...(rootNets.get(uf.find(portKey(port.kind, port.text, port.domain))) ?? [])].filter((n) => netById.has(n));
    if (nets.length !== 1) continue; // shorts and orphans are reported elsewhere
    const net = netById.get(nets[0]!)!;
    const kind = netKind(net);
    const cls = kind === "ground" ? "ground" : kind === "power" ? "power" : "label";
    if (net.name === undefined) err("port-mismatch", `a ${port.kind} symbol "${port.text}" is on unnamed net ${net.id}; ports need a named net.`, net.id);
    else if (port.text !== net.name || (port.domain ?? null) !== (net.domain ?? null) || port.kind !== cls)
      err("port-mismatch", `a ${port.kind} symbol reads "${port.text}"${port.domain ? ` (${port.domain})` : ""}, but its net is ${kind} net "${net.name}"${net.domain ? ` (${net.domain})` : ""}.`, net.id);
  }

  // Wires and ports must belong to something: a piece with no pin at all is an orphan.
  const pinRoots = new Set([...drawn.keys()].map((id) => uf.find(`pin:${id}`)));
  for (const ek of edges) {
    if (!pinRoots.has(uf.find(`e:${ek}`))) { err("orphan-wire", `a wire piece near ${ek.split("|")[0]} reaches no pin.`); break; }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function portKey(kind: string, text: string, domain: string | null): string {
  return `port:${kind}|${text}|${domain ?? ""}`;
}

function addDir(m: Map<string, Set<Dir>>, p: Pt, d: Dir) {
  const k = key(p);
  if (!m.has(k)) m.set(k, new Set());
  m.get(k)!.add(d);
}

function dirOf(a: Pt, b: Pt): Dir {
  for (const d of DIRS) { const v = DELTA[d]; if (a[0] + v[0] === b[0] && a[1] + v[1] === b[1]) return d; }
  throw new Error("not a unit edge");
}
