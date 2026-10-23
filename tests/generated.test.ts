// Verification layer 5: stress tests at scale (SPEC 13 items 5, 7 and 8). Generated
// circuits never crash and are never `valid` without passing layers 1 and 2; the same
// circuit written in another order, or with pins named another way, draws identically.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, pinDefsOf, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import type { Circuit } from "../src/core/model.js";
import { generate, rng } from "./support/generate.js";

const SEEDS = 300;

describe("generated circuits", () => {
  it(`${SEEDS} circuits: no crash, and valid only if the drawing passes layers 1 and 2`, () => {
    const problems: string[] = [];
    let drawn = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = generate(seed, 6);
      let r;
      try { r = layout({ meta: { title: g.title }, circuit: g.circuit }); } catch (e) { problems.push(`#${seed} crashed: ${(e as Error).message}`); continue; }
      if (!r.status.startsWith("valid")) continue;
      drawn++;
      const q = checkDrawing(g.circuit, r.pinDefs, r.render!);
      if (!q.valid) problems.push(`#${seed} is ${r.status} but fails: ${[...q.connections.errors.map((e) => e.code), ...q.overlaps.map((o) => o.code)].join(", ")}`);
    }
    expect(problems).toEqual([]);
    expect(drawn).toBeGreaterThan(SEEDS * 0.9);
  }, 60_000);

  it("are deterministic (byte-identical SVG on a second run)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p: Project = { circuit: generate(seed, 6).circuit };
      const a = layout(p), b = layout(p);
      if (a.render) expect(toSvg(b.render!), `#${seed}`).toBe(toSvg(a.render));
    }
  });
});

/** The same circuit with parts, nets and endpoints shuffled and pins named another way. */
function rewrite(c: Circuit, seed: number): Circuit {
  const r = rng(seed);
  const shuffle = <T>(xs: T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const defs = pinDefsOf(c);
  const respell = (ep: string): string => {
    const dot = ep.indexOf("."), part = ep.slice(0, dot), name = ep.slice(dot + 1);
    const pins = defs[part]!;
    const pin = pins.find((p) => p.name === name || (p.aliases ?? []).includes(name)) ?? pins.find((p) => p.number === name)!;
    const forms = [`${part}[${pin.number}]`];
    if (pins.filter((p) => p.name === pin.name || (p.aliases ?? []).includes(pin.name)).length === 1) forms.push(`${part}.${pin.name}`);
    for (const a of pin.aliases ?? []) if (pins.filter((p) => p.name === a || (p.aliases ?? []).includes(a)).length === 1) forms.push(`${part}.${a}`);
    return forms[Math.floor(r() * forms.length)]!;
  };
  return {
    parts: shuffle(c.parts),
    nets: shuffle(c.nets.map((n) => ({ ...n, endpoints: shuffle(n.endpoints.map((e) => (e.includes("[") ? e : respell(e)))) }))),
    ...(c.nc ? { nc: shuffle(c.nc) } : {}),
  };
}

describe("metamorphic: order and spelling do not change the drawing", () => {
  const dir = join(import.meta.dirname, "..", "cases");
  const cases = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => [f, (JSON.parse(readFileSync(join(dir, f), "utf8")) as Project).circuit] as const);
  const generated = Array.from({ length: 40 }, (_, i) => [`generated #${i + 1}`, generate(i + 1, 6).circuit] as const);
  for (const [name, circuit] of [...cases, ...generated]) {
    it(name, () => {
      const base = layout({ circuit });
      if (!base.render) return;
      for (let k = 1; k <= 3; k++) {
        const again = layout({ circuit: rewrite(circuit, k * 7919) });
        expect(again.status).toBe(base.status);
        expect(toSvg(again.render!), `rewrite ${k}`).toBe(toSvg(base.render));
      }
    });
  }
});
