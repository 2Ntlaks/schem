import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { compileDsl } from "../src/core/dsl.js";
import { layout } from "../src/layout/layout.js";
import { openRoots } from "../src/mcp/roots.js";
import { callTool, type ToolResult } from "../src/mcp/tools.js";
import { toSvg } from "../src/render/svg.js";
import { THEMES } from "../src/render/themes.js";

const WORK = mkdtempSync(join(tmpdir(), "schem-sprint-"));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

function folder(): string {
  return mkdtempSync(join(WORK, "case-"));
}

function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function toolJson(res: ToolResult): Record<string, unknown> {
  const block = res.content.find((c) => c.type === "text");
  if (!block || block.type !== "text") throw new Error("missing text result");
  return JSON.parse(block.text) as Record<string, unknown>;
}

/** Decode the top-left corner pixel [r, g, b, a] from an uncompressed or filtered PNG. */
function topLeftAlpha(png: Buffer): { colorType: number; alpha: number } {
  const colorType = png[25]!;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  // First scanline byte 0 is filter type; for top-left pixel only left/above exist (both 0).
  // Even with Average/Paeth filter on top-left corner, all neighbor terms are 0.
  const alpha = colorType === 6 ? raw[4]! : 255;
  return { colorType, alpha };
}

describe("usability sprint end-to-end integration", () => {
  it("supports CLI render --theme --transparent and draw --theme across SVG and PNG", () => {
    const dir = folder();
    const src = join(dir, "led.schem");
    expect(cli("init", src).code).toBe(0);

    const svgOut = join(dir, "dark-clear.svg");
    const rSvg = cli("render", src, "-o", svgOut, "--theme", "dark", "--transparent", "--json");
    expect(rSvg.code).toBe(0);
    const svg = readFileSync(svgOut, "utf8");
    expect(svg).not.toContain("<rect ");
    expect(svg).toContain(`stroke="${THEMES.dark.stroke}"`);

    const pngOut = join(dir, "dark-clear.png");
    const rPng = cli("render", src, "-o", pngOut, "--theme", "dark", "--transparent", "--json");
    expect(rPng.code).toBe(0);
    const png = readFileSync(pngOut);
    expect(topLeftAlpha(png)).toEqual({ colorType: 6, alpha: 0 });

    const badTheme = cli("render", src, "-o", join(dir, "bad.svg"), "--theme", "neon-pink", "--json");
    expect(badTheme.code).toBe(1);
    expect(JSON.parse(badTheme.out).error).toContain("Unknown theme");

    const drawDir = join(dir, "drawn");
    const drawn = cli("draw", src, "-o", drawDir, "--theme", "blueprint", "--json");
    expect(drawn.code).toBe(0);
    const drawnSvg = readFileSync(join(drawDir, "led.svg"), "utf8");
    expect(drawnSvg).toContain(`fill="${THEMES.blueprint.background}"`);
  });

  it("supports MCP schem_render with theme and transparent and rejects unknown themes", () => {
    const dir = folder();
    const roots = openRoots([dir]);
    const path = join(dir, "led.schem");
    const dsl = [
      'circuit "MCP Theme Test"',
      "part B1 battery 9V",
      "part R1 resistor 470",
      "part D1 led color=red",
      "net PWR = B1[+] R1[1]",
      "connect R1[2] D1[A]",
      "net GND = D1[K] B1[-]",
      "",
    ].join("\n");
    expect(callTool(roots, "schem_create", { path, source: dsl }).isError).toBe(false);

    const svgOut = join(dir, "textbook.svg");
    const resSvg = callTool(roots, "schem_render", { path, format: "svg", out: svgOut, theme: "textbook" });
    expect(resSvg.isError, JSON.stringify(resSvg.content)).toBe(false);
    expect(readFileSync(svgOut, "utf8")).toContain(`fill="${THEMES.textbook.background}"`);

    const pngOut = join(dir, "dark-transparent.png");
    const resPng = callTool(roots, "schem_render", { path, format: "png", out: pngOut, theme: "dark", transparent: true });
    expect(resPng.isError, JSON.stringify(resPng.content)).toBe(false);
    expect(topLeftAlpha(readFileSync(pngOut))).toEqual({ colorType: 6, alpha: 0 });

    const bad = callTool(roots, "schem_render", { path, format: "svg", out: join(dir, "bad.svg"), theme: "nope" });
    expect(bad.isError).toBe(true);
    expect(String(toolJson(bad).error)).toContain("Unknown theme");
  });

  it("propagates style theme=dark through layout(), toSvg(), and CLI draw", () => {
    const dir = folder();
    const dsl = [
      'circuit "Dark Style Sheet"',
      "style theme=dark",
      "part B1 battery 9V",
      "part R1 resistor 1k",
      "part D1 led color=red",
      "net PWR = B1[+] R1[1]",
      "connect R1[2] D1[A]",
      "net GND = D1[K] B1[-]",
      "",
    ].join("\n");
    const compiled = compileDsl(dsl);
    expect(compiled.ok).toBe(true);
    const laid = layout(compiled.project!);
    expect(laid.status).toBe("valid");
    expect(laid.render?.meta.theme).toBe("dark");
    const expectedSvg = toSvg(laid.render!);
    expect(expectedSvg).toContain(`fill="${THEMES.dark.background}"`);

    const file = join(dir, "dark.schem");
    writeFileSync(file, dsl, "utf8");
    const outDir = join(dir, "out");
    expect(cli("draw", file, "-o", outDir).code).toBe(0);
    expect(readFileSync(join(outDir, "dark.svg"), "utf8")).toBe(expectedSvg);
  });

  it("imports SPICE netlists via CLI, protects existing files, and passes check and render", () => {
    const dir = folder();
    const cir = join(dir, "rc.cir");
    writeFileSync(cir, [
      "RC Low-Pass Filter",
      "V1 in 0 AC 1",
      "R1 in out 1k",
      "C1 out 0 100n",
      ".tran 1m 10m",
      ".end",
      "",
    ].join("\n"), "utf8");

    const outSchem = join(dir, "rc.schem");
    const imp = cli("import", cir, "-o", outSchem, "--json");
    expect(imp.code).toBe(0);
    const impJson = JSON.parse(imp.out) as { ok: boolean; parts: number; nets: number; out: string };
    expect(impJson.ok).toBe(true);
    expect(impJson.parts).toBe(3);
    expect(impJson.nets).toBe(3);
    expect(existsSync(outSchem)).toBe(true);

    const refused = cli("import", cir, "-o", outSchem, "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.out).ok).toBe(false);

    const overwritten = cli("import", cir, "-o", outSchem, "--overwrite", "--json");
    expect(overwritten.code).toBe(0);

    const checked = cli("check", outSchem, "--json");
    expect(checked.code).toBe(0);
    expect(JSON.parse(checked.out).status).toBe("valid");

    const svgOut = join(dir, "rc.svg");
    expect(cli("render", outSchem, "-o", svgOut).code).toBe(0);
    expect(readFileSync(svgOut, "utf8")).toContain("<svg ");
  });

  it("returns verified altText from both CLI describe and MCP schem_describe", () => {
    const dir = folder();
    const roots = openRoots([dir]);
    const path = join(dir, "led.schem");
    const source = [
      'circuit "Status Indicator"',
      "part B1 battery 9V",
      "part R1 resistor 470",
      "part D1 led color=red",
      "net PWR = B1[+] R1[1]",
      "connect R1[2] D1[A]",
      "net GND = D1[K] B1[-]",
      "",
    ].join("\n");
    expect(callTool(roots, "schem_create", { path, source }).isError).toBe(false);

    const mcp = toolJson(callTool(roots, "schem_describe", { path, table: true }));
    expect(typeof mcp.altText).toBe("string");
    expect(String(mcp.altText)).toContain("Status Indicator");
    expect(String(mcp.altText)).toContain("3 parts");

    const cliJson = cli("describe", path, "--table", "--json");
    expect(cliJson.code).toBe(0);
    const parsed = JSON.parse(cliJson.out) as { altText: string };
    expect(parsed.altText).toBe(mcp.altText);

    const cliText = cli("describe", path);
    expect(cliText.code).toBe(0);
    expect(cliText.out).toContain(`Alt text: ${parsed.altText}`);
  });

  it("formats current-source shorthand 10m as 10 mA", () => {
    const dsl = [
      'circuit "Current Source Formatting"',
      "part I1 current-source 10m",
      "part R1 resistor 1k",
      "net OUT = I1[+] R1[1]",
      "net GND = I1[-] R1[2]",
      "",
    ].join("\n");
    const compiled = compileDsl(dsl);
    expect(compiled.ok).toBe(true);
    const laid = layout(compiled.project!);
    expect(laid.status).toBe("valid");
    const svg = toSvg(laid.render!);
    expect(svg).toContain('aria-label="10\u00a0mA"');
  });
});
