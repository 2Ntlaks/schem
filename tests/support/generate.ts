// Seeded circuit generator for verification layer 5 (SPEC 13 item 7): circuits built from
// the patterns real schematics use, with the Phase 0a symbol library.

import type { Circuit, Net, Part, PinDef } from "../../src/core/model.js";

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  parts: Part[] = [];
  nets = new Map<string, string[]>();
  private count = new Map<string, number>();
  private signals: string[] = [];
  controller?: string;
  bus = false;
  ics: string[] = [];
  constructor(readonly r: () => number) {}

  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.r() * xs.length)]!; }
  id(prefix: string): string { const n = (this.count.get(prefix) ?? 0) + 1; this.count.set(prefix, n); return `${prefix}${n}`; }
  part(prefix: string, type: string, props?: Record<string, string>, pins?: PinDef[]): string {
    const id = this.id(prefix);
    this.parts.push({ id, type, ...(props ? { props } : {}), ...(pins ? { pins } : {}) });
    return id;
  }
  connect(net: string, ...eps: string[]): void { this.nets.set(net, [...(this.nets.get(net) ?? []), ...eps]); }
  signal(): string { const n = this.id("S"); this.signals.push(n); return n; }
  existingSignal(): string | undefined { return this.signals.length ? this.pick(this.signals) : undefined; }
  value(kind: "r" | "c"): string { return kind === "r" ? this.pick(["220", "1k", "4.7k", "10k", "47k", "100k"]) : this.pick(["100n", "1u", "10u", "22p"]); }
}

const PATTERNS: Array<(b: Builder) => void> = [
  // Voltage divider from the supply, tap as a new signal.
  (b) => {
    const tap = b.signal();
    const r1 = b.part("R", "resistor", { value: b.value("r") }), r2 = b.part("R", "resistor", { value: b.value("r") });
    b.connect("VCC", `${r1}.1`); b.connect(tap, `${r1}.2`, `${r2}.1`); b.connect("GND", `${r2}.2`);
  },
  // Source, series resistor and LED.
  (b) => {
    const v = b.part("V", "vsource", { value: b.pick(["3.3V", "5V", "9V"]) });
    const r = b.part("R", "resistor", { value: b.value("r") }), d = b.part("D", "led", { color: b.pick(["red", "green"]) });
    const a = b.signal(), k = b.signal();
    b.connect(a, `${v}.+`, `${r}.1`); b.connect(k, `${r}.2`, `${d}.anode`); b.connect("GND", `${d}.cathode`, `${v}.-`);
  },
  // RC low-pass from an existing signal (or a new source).
  (b) => {
    let from = b.existingSignal();
    if (!from) { from = b.signal(); const v = b.part("V", "vsource", { value: "1V" }); b.connect(from, `${v}.+`); b.connect("GND", `${v}.-`); }
    const out = b.signal();
    const r = b.part("R", "resistor", { value: b.value("r") }), c = b.part("C", "capacitor", { value: b.value("c") });
    b.connect(from, `${r}.1`); b.connect(out, `${r}.2`, `${c}.1`); b.connect("GND", `${c}.2`);
  },
  // Inverting op-amp stage.
  (b) => {
    let from = b.existingSignal();
    if (!from) { from = b.signal(); const v = b.part("V", "vsource", { value: "1V" }); b.connect(from, `${v}.+`); b.connect("GND", `${v}.-`); }
    const u = b.part("U", "opamp"), rin = b.part("R", "resistor", { value: b.value("r") }), rf = b.part("R", "resistor", { value: b.value("r") });
    const sum = b.signal(), out = b.signal();
    b.connect(from, `${rin}.1`); b.connect(sum, `${rin}.2`, `${u}.IN-`, `${rf}.1`); b.connect(out, `${u}.OUT`, `${rf}.2`); b.connect("GND", `${u}.IN+`);
  },
  // An I2C peripheral on a shared bus, with the controller and pull-ups made on first use.
  (b) => {
    const chip = (label: string, extra: Record<string, string>) => b.part("U", "ic", { label, ...extra }, [
      { number: "1", name: "VCC", role: "power_in" }, { number: "2", name: "GND", role: "ground" },
      { number: "3", name: "SDA", role: "bidir", iface: ["i2c.sda"] }, { number: "4", name: "SCL", role: "bidir", iface: ["i2c.scl"] },
    ]);
    if (!b.bus) {
      b.bus = true;
      b.controller = chip("MCU", { controller: "true" });
      const p1 = b.part("R", "resistor", { value: "4.7k" }), p2 = b.part("R", "resistor", { value: "4.7k" });
      b.connect("VCC", `${b.controller}.VCC`, `${p1}.1`, `${p2}.1`); b.connect("GND", `${b.controller}.GND`);
      b.connect("SDA", `${b.controller}.SDA`, `${p1}.2`); b.connect("SCL", `${b.controller}.SCL`, `${p2}.2`);
      b.ics.push(b.controller);
    }
    const u = chip(b.pick(["BME280", "SHT31", "MPU6050", "INA219"]), {});
    b.connect("VCC", `${u}.VCC`); b.connect("GND", `${u}.GND`); b.connect("SDA", `${u}.SDA`); b.connect("SCL", `${u}.SCL`);
    b.ics.push(u);
  },
  // A decoupling capacitor on the supply (only once something uses the supply).
  (b) => {
    if (!b.nets.has("VCC")) return;
    const c = b.part("C", "capacitor", { value: "100n" });
    b.connect("VCC", `${c}.1`); b.connect("GND", `${c}.2`);
  },
];

/** A circuit of 1 to `maxPatterns` patterns; the same seed always gives the same circuit. */
export function generate(seed: number, maxPatterns = 4): { title: string; circuit: Circuit } {
  const b = new Builder(rng(seed));
  const n = 1 + Math.floor(b.r() * maxPatterns);
  for (let i = 0; i < n; i++) b.pick(PATTERNS)(b);
  const nets: Net[] = [];
  let k = 0;
  for (const [name, eps] of b.nets) {
    if (eps.length < 2) continue; // single-endpoint nets are a warning case, kept out of the generator
    k++;
    nets.push(name.startsWith("S") ? { id: `n${k}`, endpoints: eps } : { id: `n${k}`, name, endpoints: eps });
  }
  const used = new Set(nets.flatMap((x) => x.endpoints.map((e) => e.slice(0, e.indexOf(".")))));
  return { title: `generated #${seed}`, circuit: { parts: b.parts.filter((p) => used.has(p.id)), nets } };
}
