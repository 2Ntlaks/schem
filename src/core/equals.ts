// circuitEquals (SPEC 6.9).

import { cmpStr } from "../geom/geom.js";
import { canonical, netKind, type Circuit, type PinDefs } from "./model.js";
import { parseQuantity, quantityOf, sameQuantity } from "./quantity.js";
import { resolveEndpoint } from "./validate.js";

export function circuitEquals(a: Circuit, defsA: PinDefs, b: Circuit, defsB: PinDefs = defsA): boolean {
  if (a.parts.length !== b.parts.length) return false;
  const pb = new Map(b.parts.map((p) => [p.id, p]));
  for (const p of a.parts) {
    const q = pb.get(p.id);
    if (!q || q.type !== p.type) return false;
    const keys = new Set([...Object.keys(p.props ?? {}), ...Object.keys(q.props ?? {})]);
    for (const k of keys) {
      const x = p.props?.[k], y = q.props?.[k];
      if (x === undefined || y === undefined) { if (x !== y) return false; continue; }
      const unit = quantityOf(p.type, k);
      if (unit) {
        const px = parseQuantity(x, unit), py = parseQuantity(y, unit);
        if (px.ok && py.ok) { if (!sameQuantity(px.value, py.value)) return false; continue; }
      }
      if (x !== y) return false;
    }
  }
  const netSig = (c: Circuit, defs: PinDefs) =>
    c.nets
      .map((n) => {
        const eps = n.endpoints.map((e) => { const r = resolveEndpoint(e, defs); return r.ok ? canonical(r.ep) : `?${e}`; });
        return `${netKind(n)}|${n.domain ?? ""}|${[...new Set(eps)].sort(cmpStr).join(",")}`;
      })
      .sort(cmpStr)
      .join("\n");
  if (netSig(a, defsA) !== netSig(b, defsB)) return false;
  const ncSig = (c: Circuit, defs: PinDefs) =>
    (c.nc ?? []).map((e) => { const r = resolveEndpoint(e, defs); return r.ok ? canonical(r.ep) : e; }).sort(cmpStr).join(",");
  return ncSig(a, defsA) === ncSig(b, defsB);
}
