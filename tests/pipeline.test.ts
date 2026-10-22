// End-to-end checks on the Phase 0a cases: valid, deterministic, and the verifier
// catches every deliberate break of a finished drawing (mutation testing).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type Project } from "../src/layout/layout.js";
import { verify } from "../src/verify/verify.js";
import { toSvg } from "../src/render/svg.js";
import type { Electrical } from "../src/render/model.js";

const dir = join(import.meta.dirname, "..", "cases");
const cases = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

for (const file of cases) {
  const project = JSON.parse(readFileSync(join(dir, file), "utf8")) as Project;
  describe(file, () => {
    const r = layout(project);
    const el = r.render!.electrical;
    const check = (e: Electrical) => verify(project.circuit, r.pinDefs, e);

    it("lays out as valid and passes the verifier", () => {
      expect(r.status).toBe("valid");
      const v = check(el);
      expect(v.errors).toEqual([]);
    });

    it("is deterministic (byte-identical SVG on a second run)", () => {
      expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
    });

    it("every single wire removed is caught", () => {
      for (let i = 0; i < el.wires.length; i++) {
        const v = check({ ...el, wires: el.wires.filter((_, j) => j !== i) });
        expect(v.valid, `removing wire ${i} ${JSON.stringify(el.wires[i])} went unnoticed`).toBe(false);
      }
    });

    it("every junction dot removed is caught", () => {
      for (let i = 0; i < el.dots.length; i++) {
        const v = check({ ...el, dots: el.dots.filter((_, j) => j !== i) });
        expect(v.errors.map((e) => e.code)).toContain("ambiguous-t");
      }
    });

    it("every port relabelled is caught", () => {
      for (let i = 0; i < el.ports.length; i++) {
        const ports = el.ports.map((p, j) => (j === i ? { ...p, text: `${p.text}X` } : p));
        expect(check({ ...el, ports }).valid, `relabelling port ${i} went unnoticed`).toBe(false);
      }
    });

    it("every pin hidden is caught", () => {
      for (let i = 0; i < el.pins.length; i++) {
        const v = check({ ...el, pins: el.pins.filter((_, j) => j !== i) });
        const pin = el.pins[i]!;
        const attachedToSomething = el.wires.some((w) => w.some((p) => p[0] === pin.at[0] && p[1] === pin.at[1])) || el.ports.some((p) => p.at[0] === pin.at[0] && p.at[1] === pin.at[1]);
        if (attachedToSomething) expect(v.valid, `hiding ${pin.part}[${pin.number}] went unnoticed`).toBe(false);
      }
    });

  });
}
