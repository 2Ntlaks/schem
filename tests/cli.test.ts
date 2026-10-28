// The one-command try-out (step 3): src/cli.ts.
//
// Calls run() directly, so no process is spawned. Output folders are temporary; the bad inputs
// are written here, not in tests/fixtures/ or examples/.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), "schem-cli-"));
const OUT = join(WORK, "out");

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

interface Captured {
  code: number;
  out: string;
  err: string;
  all: string;
}

function cli(...argv: string[]): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
  const o = out.join("\n");
  const e = err.join("\n");
  return { code, out: o, err: e, all: `${o}\n${e}` };
}

function badFile(name: string, text: string): string {
  const p = join(WORK, name);
  writeFileSync(p, text, "utf8");
  return p;
}

const EXAMPLES = ["led", "summing-amp", "h-bridge", "i2c-sensors", "esp32-relay"] as const;

describe("schem draw", () => {
  for (const name of EXAMPLES) {
    it(`draws examples/${name}.schem.json and says it is valid`, () => {
      const r = cli("draw", join(ROOT, "examples", `${name}.schem.json`), "-o", OUT);
      expect(r.code).toBe(0);
      expect(r.err).toBe("");
      expect(r.out).toContain(`${name}: valid.`);
      expect(r.out).toContain(`${name}.svg`);
      expect(r.out).toContain(`${name}.png`);

      const svgPath = join(OUT, `${name}.svg`);
      const pngPath = join(OUT, `${name}.png`);
      expect(existsSync(svgPath)).toBe(true);
      expect(existsSync(pngPath)).toBe(true);
      expect(statSync(svgPath).size).toBeGreaterThan(100);
      expect(statSync(pngPath).size).toBeGreaterThan(100);
      expect(readFileSync(svgPath, "utf8").startsWith("<svg ")).toBe(true);
      expect([...readFileSync(pngPath).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });
  }
});

describe("schem help and version", () => {
  it("prints usage with no arguments and with --help", () => {
    for (const argv of [[], ["--help"], ["-h"]]) {
      const r = cli(...argv);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage:");
      expect(r.out).toContain("npm run schem -- draw examples/led.schem.json");
    }
  });

  it("prints the package version", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    const r = cli("--version");
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(pkg.version);
  });
});

describe("schem wrong input", () => {
  it("reports a missing file by name", () => {
    const missing = join(WORK, "not-here.json");
    const r = cli("draw", missing);
    expect(r.code).toBe(2);
    expect(r.err).toContain(missing.replace(/\\/g, "/"));
    expect(r.err).toContain("no such file");
    expect(r.all).not.toContain("    at ");
  });

  it("reports a JSON syntax error with its line", () => {
    const file = badFile("bad.json", '{\n  "schema": "schem/1.0",\n  "circuit": {\n    "parts": []\n    "nets": []\n  }\n}\n');
    const r = cli("draw", file);
    expect(r.code).toBe(2);
    expect(r.err).toContain("bad JSON at line 5");
    expect(r.err).toContain("column");
    expect(r.all).not.toContain("    at ");
  });

  it("names an unknown part type and points at docs/parts.md", () => {
    const file = badFile("unknown-type.json", JSON.stringify({
      schema: "schem/1.0",
      circuit: { parts: [{ id: "X1", type: "flux-capacitor" }], nets: [] },
    }, null, 2));
    const r = cli("draw", file);
    expect(r.code).toBe(2);
    expect(r.err).toContain('unknown part type "flux-capacitor"');
    expect(r.err).toContain("docs/parts.md");
    expect(r.all).not.toContain("    at ");
  });

  it("names a pin that does not exist", () => {
    const file = badFile("bad-pin.json", JSON.stringify({
      schema: "schem/1.0",
      circuit: {
        parts: [{ id: "R1", type: "resistor" }],
        nets: [{ id: "n1", endpoints: ["R1[7]", "R1[1]"] }],
      },
    }, null, 2));
    const r = cli("draw", file);
    expect(r.code).toBe(2);
    expect(r.err).toContain("R1[7]");
    expect(r.err).toContain("unknown pin");
    expect(r.all).not.toContain("    at ");
  });

  it("reports bad arguments without drawing anything", () => {
    for (const argv of [["draw"], ["draw", "a.json", "b.json"], ["nonsense"], ["draw", "a.json", "-x"]]) {
      const r = cli(...argv);
      expect(r.code).toBe(2);
      expect(r.all).not.toContain("    at ");
    }
    expect(existsSync(join(WORK, "a.svg"))).toBe(false);
  });
});
