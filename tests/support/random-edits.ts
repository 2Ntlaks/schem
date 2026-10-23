// Random edits of the SPEC 15 kinds on a generated circuit, for the layer 5 stability tests.

import type { Circuit } from "../../src/core/model.js";
import type { EditOp } from "../../src/edit/edit.js";
import { rng } from "./generate.js";

export function randomEdit(c: Circuit, seed: number): { kind: string; ops: EditOp[] } {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const kinds = ["longer value", "add part", "remove part", ...(c.parts.some((p) => p.type === "ic") ? ["pin sides"] : [])];
  const kind = pick(kinds);
  if (kind === "longer value") {
    const p = pick(c.parts.filter((x) => x.props));
    if (!p) return { kind: "none", ops: [] };
    const k = Object.keys(p.props!)[0]!;
    return { kind, ops: [{ op: "setProp", part: p.id, key: k, value: `${p.props![k]} ${"x".repeat(2 * p.props![k]!.length)}` }] };
  }
  if (kind === "add part") {
    const nets = c.nets.filter((n) => n.endpoints.length >= 2);
    const a = pick(nets), b = pick(nets.filter((n) => n !== a));
    if (!a || !b) return { kind: "none", ops: [] };
    return { kind, ops: [
      { op: "addPart", part: { id: "RX1", type: "resistor", props: { value: "1k" } } },
      { op: "connect", endpoints: ["RX1.1", a.endpoints[0]!] }, { op: "connect", endpoints: ["RX1.2", b.endpoints[0]!] },
    ] };
  }
  if (kind === "remove part") return { kind, ops: [{ op: "removePart", part: pick(c.parts).id }] };
  const ic = pick(c.parts.filter((p) => p.type === "ic"));
  return { kind, ops: [{ op: "setPinSides", part: ic.id, left: ["SDA", "SCL"] }] };
}
