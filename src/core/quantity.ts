// Values and quantities (SPEC 6.7).

export type Unit = "ohm" | "farad" | "henry" | "volt" | "amp" | "hertz";

const UNIT_TEXT: Record<Unit, string[]> = {
  ohm: ["Ω", "ohm", "ohms"], farad: ["F"], henry: ["H"], volt: ["V"], amp: ["A"], hertz: ["Hz"],
};
const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, meg: 1e6, MEG: 1e6 };

/** Which quantity a property holds, by part type. Strings for everything else. */
export function quantityOf(type: string, key: string): Unit | undefined {
  if (key !== "value") return undefined;
  if (/^(resistor|potentiometer)$/.test(type)) return "ohm";
  if (/^(capacitor|polarized-capacitor|polarised-capacitor)$/.test(type)) return "farad";
  if (type === "inductor") return "henry";
  if (/^(battery|vsource|dc-source|ac-source)$/.test(type)) return "volt";
  if (/^(isource|current-source|fuse)$/.test(type)) return "amp";
  if (type === "crystal") return "hertz";
  return undefined;
}

export type Parsed = { ok: true; value: number } | { ok: false; code: string; message: string };

/** Parse a raw value as a quantity of `unit`. Never guesses: anything doubtful is an error. */
export function parseQuantity(raw: string, unit: Unit): Parsed {
  const s = raw.trim().replace(/\s+/g, "");
  if (/\d,\d/.test(s)) return { ok: false, code: "E310", message: `"${raw}" is not a number. Did you mean "${raw.replace(",", ".")}"?` };
  // Strip a trailing unit word; reject a different known unit.
  let body = s;
  for (const [u, texts] of Object.entries(UNIT_TEXT) as Array<[Unit, string[]]>) {
    for (const t of texts.sort((a, b) => b.length - a.length)) {
      if (body.endsWith(t) && body.length > t.length && /[\dpnuµμmkKMG]$/.test(body.slice(0, -t.length))) {
        if (u !== unit) return { ok: false, code: "E311", message: `"${raw}" has unit ${t}, but this value is in ${UNIT_TEXT[unit][0]}.` };
        body = body.slice(0, -t.length);
      }
    }
  }
  // RKM notation: 4k7, 2R2, 4u7, 3V3
  let m = /^(\d+)([pnuµμmkKMGR]|V)(\d+)$/.exec(body);
  if (m) {
    const [, a, p, b] = m as unknown as [string, string, string, string];
    const mult = p === "R" || p === "V" ? 1 : PREFIX[p]!;
    return { ok: true, value: Number(`${a}.${b}`) * mult };
  }
  m = /^(\d+(?:\.\d+)?|\.\d+)(meg|MEG|[pnuµμmkKMG])?$/.exec(body);
  if (m) {
    const [, num, p] = m as unknown as [string, string, string | undefined];
    return { ok: true, value: Number(num) * (p ? PREFIX[p]! : 1) };
  }
  return { ok: false, code: "W320", message: `"${raw}" is not a recognised ${UNIT_TEXT[unit][0]} value; shown as written.` };
}

/** Relative comparison that is robust to 4.7e3 vs 4700 floating-point noise. */
export function sameQuantity(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}
