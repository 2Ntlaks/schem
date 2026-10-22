// Runs the black-box fixtures in tests/fixtures (format: tests/fixtures/README.md).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonical, CircuitError, netKind, type Circuit, type PinDefs } from "../src/core/model.js";
import { applyOps, type CircuitOp } from "../src/core/ops.js";
import { validate, resolveEndpoint } from "../src/core/validate.js";
import { circuitEquals } from "../src/core/equals.js";
import { verify } from "../src/verify/verify.js";
import type { Electrical } from "../src/render/model.js";

const root = join(import.meta.dirname, "fixtures");
const load = (dir: string) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).filter((f) => f.endsWith(".json")).sort().map((f) => ({ file: f, fx: JSON.parse(readFileSync(join(root, dir, f), "utf8")) }))
    : [];

describe("verifier fixtures", () => {
  for (const { file, fx } of load("verifier")) {
    it(`${file}: ${fx.description ?? ""}`.slice(0, 160), () => {
      const el: Electrical = { pins: [], wires: [], dots: [], ports: [], ncMarks: [], ...fx.render };
      const r = verify(fx.circuit, fx.pinDefs, el);
      const codes = r.errors.map((e) => e.code);
      const detail = JSON.stringify(r.errors, null, 1);
      expect(r.valid, detail).toBe(fx.expect.valid);
      for (const code of fx.expect.errors ?? []) expect(codes, detail).toContain(code);
    });
  }
});

describe("model fixtures", () => {
  for (const { file, fx } of load("model")) {
    it(`${file}: ${fx.description ?? ""}`.slice(0, 160), () => {
      const defs: PinDefs = fx.pinDefs ?? {};
      if (fx.expect.equal !== undefined) {
        // README allows { circuitB, equal } either directly in expect or nested under expect.equal.
        const spec = typeof fx.expect.equal === "object" ? fx.expect.equal : fx.expect;
        const eq = circuitEquals(fx.circuit, defs, spec.circuitB, spec.pinDefsB ?? defs);
        expect(eq).toBe(spec.equal);
        return;
      }
      let codes: string[] = [];
      let result: { circuit: Circuit; pinDefs: PinDefs } | undefined;
      try {
        if (fx.ops?.length) result = applyOps(fx.circuit, defs, fx.ops as CircuitOp[]);
        else {
          const v = validate(fx.circuit, defs);
          codes = v.issues.map((i) => i.code);
          if (!codes.length) result = { circuit: fx.circuit, pinDefs: defs };
        }
      } catch (e) {
        if (!(e instanceof CircuitError)) throw e;
        codes = e.issues.map((i) => i.code);
      }
      expect(codes.length === 0, `issues: ${codes.join(", ")}`).toBe(fx.expect.ok);
      for (const code of fx.expect.errors ?? []) expect(codes).toContain(code);
      if (fx.expect.nets && result) {
        const got = result.circuit.nets.map((n) => ({
          id: n.id, name: n.name, kind: netKind(n), domain: n.domain ?? null,
          endpoints: n.endpoints.map((e) => { const r = resolveEndpoint(e, result!.pinDefs); return r.ok ? canonical(r.ep) : e; }).sort(),
        }));
        for (const want of fx.expect.nets) {
          const wantEps = [...want.endpoints].map((e: string) => { const r = resolveEndpoint(e, result!.pinDefs); return r.ok ? canonical(r.ep) : e; }).sort();
          const match = got.find((g) => JSON.stringify(g.endpoints) === JSON.stringify(wantEps));
          expect(match, `no net with endpoints ${wantEps.join(",")}; got ${JSON.stringify(got)}`).toBeDefined();
          for (const f of ["id", "name", "kind", "domain"] as const) if (f in want) expect(match![f] ?? null, `field ${f}`).toBe(want[f] ?? null);
        }
        expect(got.length, `net count; got ${JSON.stringify(got)}`).toBe(fx.expect.nets.length);
      }
    });
  }
});

describe("package boundaries", () => {
  it("verify does not import layout (SPEC 5: independent verifier)", () => {
    const dir = join(import.meta.dirname, "..", "src", "verify");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'][^"']*layout/);
    }
  });
});
