// Phase 0b symbols (SPEC 7.1-7.2): every symbol passes the loader check, keeps the pin
// inventory proposed with the frozen cases, and draws in a small realistic circuit that lays
// out `valid` and passes verification layers 1 and 2, deterministically.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, pinDefsOf } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { verify } from "../src/verify/verify.js";
import { toSvg } from "../src/render/svg.js";
import { BUILTIN, checkSymbol, keepOut } from "../src/symbols/library.js";
import { headerFor } from "../src/layout/kinds.js";
import type { PinDef } from "../src/core/model.js";
import type { DrawnPin } from "../src/render/model.js";
import { SYMBOL_CIRCUITS } from "./support/symbol-circuits.js";

/**
 * Pin inventories proposed with the frozen cases (agent B), read from the real file so that
 * a drift between it and the library is caught. Read only: phase0/ is never edited.
 */
const PROPOSAL = JSON.parse(readFileSync(join(import.meta.dirname, "..", "phase0", "proposed-symbols.json"), "utf8")) as { types: Record<string, { pins: PinDef[] }> };
const PROPOSED: Record<string, PinDef[]> = Object.fromEntries(Object.entries(PROPOSAL.types).map(([t, v]) => [t, v.pins]));

describe("symbol library: loader check (SPEC 7.1)", () => {
  for (const s of Object.values(BUILTIN)) {
    it(`${s.id} passes in all 8 orientations, pins on grid and on the keep-out`, () => {
      expect(() => checkSymbol(s)).not.toThrow();
      expect(s.source).toBe("original");
      expect(s.align.every(Number.isInteger)).toBe(true);
    });
  }

  it("generated headers pass for 1 to 12 pins, short and long names", () => {
    for (let n = 1; n <= 12; n++) {
      const pins: PinDef[] = Array.from({ length: n }, (_, i) => ({ number: String(i + 1), name: i % 3 === 0 ? "GND" : `SIGNAL_${i}`, role: "passive" }));
      expect(() => checkSymbol(headerFor(pins))).not.toThrow();
    }
    expect(() => checkSymbol(headerFor([{ number: "A10", name: "A10", role: "passive" }, { number: "B2", name: "X", role: "passive" }]))).not.toThrow();
  });

  it("the loader check rejects a pin inside the keep-out", () => {
    const bad = { ...BUILTIN.npn!, pins: BUILTIN.npn!.pins.map((p) => (p.number === "B" ? { ...p, at: [1, 0] as const } : p)) };
    expect(() => checkSymbol(bad)).toThrow(/keep-out/);
  });
});

describe("symbol library: pin inventories match phase0/proposed-symbols.json", () => {
  it("the proposal lists the 15 Phase 0b types", () => expect(Object.keys(PROPOSED).length).toBe(15));

  for (const [type, pins] of Object.entries(PROPOSED)) {
    it(type, () => {
      if (type === "header") {
        // Pins come from the part, like `ic`; a pin without a role is passive unless named as a supply.
        const defs = pinDefsOf({ parts: [{ id: "J1", type: "header", pins: [{ number: "1", name: "A", role: "passive" }, { number: "2", name: "GND" } as PinDef] }], nets: [] });
        expect(defs.J1).toEqual([{ number: "1", name: "A", role: "passive" }, { number: "2", name: "GND", role: "ground" }]);
        return;
      }
      const s = BUILTIN[type];
      expect(s, `no symbol "${type}"`).toBeDefined();
      expect(s!.pins.map(({ at: _a, dir: _d, ...rest }) => rest)).toEqual(pins);
    });
  }
});

describe("symbol library: one small circuit per symbol", () => {
  const covered = new Set(Object.values(SYMBOL_CIRCUITS).flatMap((c) => c.covers));
  it("covers every proposed type", () => expect(Object.keys(PROPOSED).filter((t) => !covered.has(t))).toEqual([]));

  for (const [name, { covers, project }] of Object.entries(SYMBOL_CIRCUITS)) {
    describe(`${name} (${covers.join(", ")})`, () => {
      const r = layout(project);
      const el = r.render!.electrical;
      const pinAt = (id: string): DrawnPin => el.pins.find((p) => `${p.part}[${p.number}]` === id)!;

      it("lays out as valid and passes verification layers 1 and 2", () => {
        expect(r.issues).toEqual([]);
        expect(r.status).toBe("valid");
        const q = checkDrawing(project.circuit, r.pinDefs, r.render!);
        expect(q.connections.errors).toEqual([]);
        expect(q.overlaps).toEqual([]);
      });

      it("is deterministic (byte-identical SVG on a second run)", () => {
        expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
      });

      it("every single wire removed is caught", () => {
        for (let i = 0; i < el.wires.length; i++) {
          expect(verify(project.circuit, r.pinDefs, { ...el, wires: el.wires.filter((_, j) => j !== i) }).valid, `wire ${i}`).toBe(false);
        }
      });

      it("keeps the drawing conventions of its symbols", () => {
        for (const p of project.circuit.parts) {
          const at = (n: string) => pinAt(`${p.id}[${n}]`).at;
          // N types: emitter or source below the collector or drain; P types: above (SPEC 9.2 step 3b).
          if (p.type === "npn") expect(at("E")[1], p.id).toBeGreaterThan(at("C")[1]);
          if (p.type === "nmos") expect(at("S")[1], p.id).toBeGreaterThan(at("D")[1]);
          if (p.type === "pnp") expect(at("E")[1], p.id).toBeLessThan(at("C")[1]);
          if (p.type === "pmos") expect(at("S")[1], p.id).toBeLessThan(at("D")[1]);
          // Sources stand vertical, pin 1 up.
          if (p.type === "ac-source") expect(at("1")[0] === at("2")[0] && at("1")[1] < at("2")[1], p.id).toBe(true);
          // Relay coil A1 above A2; common contact 11 below 12 and 14.
          if (p.type === "relay") {
            expect(at("A1")[1]).toBeLessThan(at("A2")[1]);
            expect(at("11")[1]).toBeGreaterThan(at("12")[1]);
          }
          // A potentiometer across a supply stands vertical, wiper to the side.
          if (p.type === "potentiometer") {
            expect(at("1")[0]).toBe(at("3")[0]);
            expect(at("2")[0]).not.toBe(at("1")[0]);
          }
        }
        // A flyback diode stands with its cathode towards the supply.
        if (name === "relay-driver" || name === "nmos-motor-driver") expect(pinAt("D1[K]").at[1]).toBeLessThan(pinAt("D1[A]").at[1]);
        // Zener shunt: anode to ground. Schottky feeds the load, anode on the left.
        if (name === "zener-shunt") {
          expect(pinAt("D1[K]").at[1]).toBeLessThan(pinAt("D1[A]").at[1]);
          expect(pinAt("D2[A]").at[0]).toBeLessThan(pinAt("D2[K]").at[0]);
        }
        // The crystal stands with pin 1 up, between the two clock pins.
        if (name === "mcu-crystal") {
          expect(pinAt("Y1[1]").at[0]).toBe(pinAt("Y1[2]").at[0]);
          expect(pinAt("Y1[1]").at[1]).toBeLessThan(pinAt("Y1[2]").at[1]);
        }
      });

      it("headers draw every pin, with its name and number", () => {
        for (const p of project.circuit.parts.filter((x) => x.type === "header")) {
          for (const d of p.pins!) {
            expect(el.pins.some((q) => q.part === p.id && q.number === d.number), `${p.id}[${d.number}] drawn`).toBe(true);
            const texts = r.render!.art.flatMap((a) => (a.t === "text" && a.owner === `pin:${p.id}[${d.number}]` ? [a.text] : []));
            expect(texts.sort()).toEqual([d.name, d.number].sort());
          }
        }
      });
    });
  }
});

describe("symbol library: geometry", () => {
  it("every symbol's artwork lies inside its keep-out, which is at most 8 G", () => {
    for (const s of Object.values(BUILTIN)) {
      const k = keepOut(s);
      expect(Math.max(k.w, k.h), s.id).toBeLessThanOrEqual(8);
      expect(s.art.x >= k.x && s.art.y >= k.y && s.art.x + s.art.w <= k.x + k.w && s.art.y + s.art.h <= k.y + k.h, s.id).toBe(true);
    }
  });
});
