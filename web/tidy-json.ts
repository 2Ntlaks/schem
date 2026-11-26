// Formatting for JSON circuit files: one part and one net per line, everything else indented.
// Pure ES2022 so both web/core.ts and web/main.ts can use it without pulling the engine into main.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export const isJsonObj = (v: unknown): v is { [k: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function compact(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(compact).join(", ")}]`;
  if (isJsonObj(v)) return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${compact(x)}`).join(", ")} }`;
  return JSON.stringify(v);
}

export function tidyJson(doc: { [k: string]: Json }): string {
  const indent = (s: string, pad: string) => s.split("\n").join(`\n${pad}`);
  const item = (v: Json, pad: string) => {
    // A part with its own pins: the pins one per line.
    if (isJsonObj(v) && Array.isArray(v.pins) && v.pins.length) {
      const { pins, ...head } = v;
      return `${compact(head).replace(/ \}$/, ",")} "pins": [\n${(pins as Json[]).map((p) => `${pad}  ${compact(p)}`).join(",\n")}\n${pad}] }`;
    }
    return compact(v);
  };
  const out = ["{"];
  const keys = Object.keys(doc);
  keys.forEach((k, i) => {
    const end = i < keys.length - 1 ? "," : "";
    const v = doc[k]!;
    if (k === "circuit" && isJsonObj(v)) {
      out.push(`  "circuit": {`);
      const ck = Object.keys(v);
      ck.forEach((c, j) => {
        const e2 = j < ck.length - 1 ? "," : "";
        const cv = v[c]!;
        if ((c === "parts" || c === "nets") && Array.isArray(cv) && cv.length) {
          out.push(`    ${JSON.stringify(c)}: [`);
          cv.forEach((it, m) => out.push(`      ${item(it, "      ")}${m < cv.length - 1 ? "," : ""}`));
          out.push(`    ]${e2}`);
        } else out.push(`    ${JSON.stringify(c)}: ${indent(JSON.stringify(cv, null, 2), "    ")}${e2}`);
      });
      out.push(`  }${end}`);
    } else out.push(`  ${JSON.stringify(k)}: ${indent(JSON.stringify(v, null, 2), "  ")}${end}`);
  });
  out.push("}");
  return `${out.join("\n")}\n`;
}
