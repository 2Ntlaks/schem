import { CAPACITOR_TYPES, type Hint } from "../core/intent.js";
import { canonical, netKind, type Circuit, type PinDefs } from "../core/model.js";
import { parseQuantity } from "../core/quantity.js";
import { groupRepresentative, resolveEndpoint, type ValidCircuit } from "../core/validate.js";
import { cmpStr } from "../geom/geom.js";

export interface DecouplingMatch { part: string; host: string; pin: string; supplyPin: string }

/** Port-presented decouplers. Explicit targets win; inference requires an unambiguous IC. */
export function decouplingMatches(
  circuit: Circuit, defs: PinDefs, vc: ValidCircuit, drawnNet: ReadonlyMap<string, string>,
  portNets: ReadonlySet<string>, hints: readonly Hint[],
): DecouplingMatch[] {
  const nets = new Map(circuit.nets.map((n) => [n.id, n]));
  const nc = new Set(vc.nc.map(canonical));
  const hosts = new Set(circuit.parts.filter((p) => p.type === "ic" || p.type.startsWith("module:")).map((p) => p.id));
  const out: DecouplingMatch[] = [];
  for (const cap of circuit.parts) {
    if (!CAPACITOR_TYPES.has(cap.type) || defs[cap.id]?.length !== 2) continue;
    const pins = defs[cap.id]!.map((p) => ({ pin: p.number, net: drawnNet.get(`${cap.id}[${p.number}]`) }));
    const supply = pins.find((p) => p.net && netKind(nets.get(p.net)!) === "power");
    const ground = pins.find((p) => p.net && netKind(nets.get(p.net)!) === "ground");
    if (!supply?.net || !ground?.net || !portNets.has(supply.net) || !portNets.has(ground.net)) continue;
    const candidates = [...drawnNet].flatMap(([terminal, net]) => {
      if (net !== supply.net) return [];
      const host = terminal.slice(0, terminal.indexOf("["));
      const pin = terminal.slice(host.length + 1, -1);
      return hosts.has(host) && defs[host]!.some((p) => p.number === pin && p.role === "power_in") ? [{ host, pin }] : [];
    }).sort((a, b) => cmpStr(`${a.host}[${a.pin}]`, `${b.host}[${b.pin}]`));
    const explicit = hints.filter((h) => h.type === "decouples" && h.part === cap.id);
    let target: { host: string; pin: string } | undefined;
    if (explicit.length) {
      const targets = explicit.flatMap((h) => {
        if (h.type !== "decouples") return [];
        const r = resolveEndpoint(h.pin, defs);
        if (!r.ok) return [];
        const pin = r.ep.kind === "terminal" ? r.ep.number : groupRepresentative(r.ep.part, r.ep.group, defs, nc);
        return candidates.filter((p) => p.host === r.ep.part && p.pin === pin);
      });
      if (targets.length === explicit.length && new Set(targets.map((p) => `${p.host}[${p.pin}]`)).size === 1) target = targets[0];
    } else if (new Set(candidates.map((p) => p.host)).size === 1) target = candidates[0];
    if (target) out.push({ part: cap.id, ...target, supplyPin: supply.pin });
  }
  // Smallest capacitance first within a pin's slot, independent of file/net storage order.
  const value = (id: string) => parseQuantity(circuit.parts.find((p) => p.id === id)!.props?.value ?? "", "farad");
  return out.sort((a, b) => {
    const slot = cmpStr(`${a.host}[${a.pin}]`, `${b.host}[${b.pin}]`);
    if (slot) return slot;
    const av = value(a.part), bv = value(b.part);
    return (av.ok && bv.ok ? av.value - bv.value : av.ok ? -1 : bv.ok ? 1 : 0) || cmpStr(a.part, b.part);
  });
}
