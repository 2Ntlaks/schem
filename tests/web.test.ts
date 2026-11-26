// The playground (web/): its engine side draws every example byte-identically to the command
// line, both as source and after the browser build (scripts/lib/web-bundle.ts), which swaps the
// font and module files for browser versions and stubs out node: imports.

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { draw, catalog, convertCircuit, detectFormat, tidyCircuit } from "../web/core.js";
import { highlightDsl } from "../web/highlight.js";
import { compileDsl } from "../src/core/dsl.js";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";
import { fontPath } from "../src/text/font-file.js";
import { common, ROOT } from "../scripts/lib/web-bundle.js";
import { renderDocs, SECTIONS } from "../scripts/lib/docs-page.js";

const EXAMPLES = readdirSync(join(ROOT, "examples")).filter((f) => f.endsWith(".schem.json")).sort();
const DSL_EXAMPLES = readdirSync(join(ROOT, "examples")).filter((f) => f.endsWith(".schem")).sort();
const cli = (f: string) => toSvg(layout(readProject(join(ROOT, "examples", f)).project!).render!);
const cliDsl = (f: string) => toSvg(layout(compileDsl(readFileSync(join(ROOT, "examples", f), "utf8")).project!).render!);
// realpath: on Windows the temp folder can be a short 8.3 name (RUNNER~1), which the test runner cannot load from.
const WORK = realpathSync.native(mkdtempSync(join(tmpdir(), "schem-web-")));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

describe("playground engine (web/core.ts)", () => {
  it("draws every example exactly as the command line does", () => {
    for (const f of EXAMPLES) {
      const r = draw(readFileSync(join(ROOT, "examples", f), "utf8"));
      expect(r.verdict, f).toBe("valid");
      expect(r.svg, f).toBe(cli(f));
    }
  });

  it("reports bad JSON with its line and column, and unknown parts by name", () => {
    const bad = draw('{\n  "schema": "schem/1.0",\n  "circuit": { "parts": [], }\n}');
    expect([bad.verdict, bad.problems[0]!.line]).toEqual(["error", 3]);
    const unknown = draw(JSON.stringify({ schema: "schem/1.0", circuit: { parts: [{ id: "X1", type: "flux-capacitor" }], nets: [] } }));
    expect(unknown.verdict).toBe("error");
    expect(unknown.problems.map((p) => p.text).join(" ")).toContain("flux-capacitor");
  });

  it("lists every symbol with its artwork, and every board with its pins", () => {
    const c = catalog();
    expect(c.find((p) => p.type === "resistor")!.art!.paths.length).toBeGreaterThan(0);
    expect(c.find((p) => p.type === "module:arduino-uno-r3")!.pins.length).toBeGreaterThan(20);
  });

  it("after the browser build, still draws every example byte-identically", async () => {
    const outfile = join(WORK, "core.mjs");
    const slash = (p: string) => JSON.stringify(p.split("\\").join("/"));
    // The bundle under test: web/core.ts plus the font hand-over, exactly as the worker uses them.
    const contents = [`export * from ${slash(join(ROOT, "web/core.ts"))};`, `export { setFontBytes } from ${slash(join(ROOT, "web/shims/font-file.ts"))};`].join(" ");
    await build({ ...common, platform: "neutral", mainFields: ["module", "main"], outfile, logLevel: "silent", stdin: { contents, resolveDir: ROOT, loader: "ts", sourcefile: "entry.ts" } });
    const bundled = await import(pathToFileURL(outfile).href) as typeof import("../web/core.js") & { setFontBytes(b: Uint8Array): void };
    bundled.setFontBytes(new Uint8Array(readFileSync(fontPath())));
    for (const f of EXAMPLES) expect(bundled.draw(readFileSync(join(ROOT, "examples", f), "utf8")).svg, f).toBe(cli(f));
  }, 120_000);

  it("draws every .schem example byte-identically to the CLI and JSON counterpart", () => {
    expect(DSL_EXAMPLES).toContain("led.schem");
    for (const f of DSL_EXAMPLES) {
      const text = readFileSync(join(ROOT, "examples", f), "utf8");
      expect(detectFormat(text), f).toBe("dsl");
      const r = draw(text);
      expect(r.verdict, f).toBe("valid");
      expect(r.svg, f).toBe(cliDsl(f));
      const jsonCounterpart = `${f}.json`;
      if (EXAMPLES.includes(jsonCounterpart)) {
        expect(r.svg, `${f} vs ${jsonCounterpart}`).toBe(cli(jsonCounterpart));
      }
    }
  });

  it("after the browser build, draws .schem examples byte-identically and converts formats", async () => {
    const outfile = join(WORK, "core-dsl.mjs");
    const slash = (p: string) => JSON.stringify(p.split("\\").join("/"));
    const contents = [
      `export * from ${slash(join(ROOT, "web/core.ts"))};`,
      `export { setFontBytes } from ${slash(join(ROOT, "web/shims/font-file.ts"))};`,
      `export { EXAMPLES } from "virtual:examples";`,
    ].join(" ");
    await build({ ...common, platform: "neutral", mainFields: ["module", "main"], outfile, logLevel: "silent", stdin: { contents, resolveDir: ROOT, loader: "ts", sourcefile: "entry.ts" } });
    const bundled = await import(pathToFileURL(outfile).href) as typeof import("../web/core.js") & {
      setFontBytes(b: Uint8Array): void;
      EXAMPLES: Array<[string, string]>;
    };
    bundled.setFontBytes(new Uint8Array(readFileSync(fontPath())));
    const exampleNames = bundled.EXAMPLES.map(([f]) => f);
    expect(exampleNames).toContain("led.schem");
    expect(exampleNames).toContain("led.schem.json");
    for (const f of DSL_EXAMPLES) {
      const text = readFileSync(join(ROOT, "examples", f), "utf8");
      const r = bundled.draw(text);
      expect(r.verdict, f).toBe("valid");
      expect(r.svg, f).toBe(cliDsl(f));
      const jsonCounterpart = `${f}.json`;
      if (EXAMPLES.includes(jsonCounterpart)) expect(r.svg, `${f} vs ${jsonCounterpart}`).toBe(cli(jsonCounterpart));
    }
    // Verify bundled formatDsl works on a module circuit (uses the node:util isDeepStrictEqual shim)
    // and reports meta.created as lossy when present.
    const esp32 = JSON.parse(readFileSync(join(ROOT, "examples", "esp32-relay.schem.json"), "utf8")) as { meta?: { created?: string } };
    const lossyEsp32 = bundled.convertCircuit(JSON.stringify(esp32), "dsl");
    expect(lossyEsp32.ok).toBe(false);
    expect(lossyEsp32.lostFields).toEqual(["meta.created"]);
    delete esp32.meta?.created;
    const toDsl = bundled.convertCircuit(JSON.stringify(esp32), "dsl");
    expect(toDsl.ok).toBe(true);
    expect(bundled.draw(toDsl.text!).verdict).toBe("valid");
  }, 120_000);

  it("reports .schem syntax and semantic errors with 1-based line and column", () => {
    const syntax = draw('circuit "Bad"\npart R1 resistor 10k\nbogus statement here\n');
    expect(syntax.verdict).toBe("error");
    expect(syntax.problems[0]!.line).toBe(3);
    expect(syntax.problems[0]!.column).toBe(1);

    const semantic = draw('part R1 resistor 10k\nconnect R1.1 R1.3\n');
    expect(semantic.verdict).toBe("error");
    expect(semantic.problems[0]!.line).toBe(2);
    expect(semantic.problems[0]!.column).toBe(14);
    expect(semantic.problems[0]!.text).toContain("R1.3");

    const unknownType = draw('part X1 flux-capacitor\n');
    expect(unknownType.verdict).toBe("error");
    expect(unknownType.problems[0]!.line).toBe(1);
    expect(unknownType.problems[0]!.column).toBe(9);
    expect(unknownType.problems.map((p) => p.text).join(" ")).toContain("flux-capacitor");
  });

  it("converts .schem <-> JSON cleanly, tidies both formats, and reports lossy fields", () => {
    const ledDsl = readFileSync(join(ROOT, "examples", "led.schem"), "utf8");
    const ledSvg = draw(ledDsl).svg;

    const toJson = convertCircuit(ledDsl, "json");
    expect(toJson.ok).toBe(true);
    expect(detectFormat(toJson.text!)).toBe("json");
    expect(draw(toJson.text!).svg).toBe(ledSvg);

    const backToDsl = convertCircuit(toJson.text!, "dsl");
    expect(backToDsl.ok).toBe(true);
    expect(detectFormat(backToDsl.text!)).toBe("dsl");
    expect(draw(backToDsl.text!).svg).toBe(ledSvg);

    const tidiedDsl = tidyCircuit("  part R1 resistor 10k\npart B1 battery 9V\nnet GND = B1.- R1.2\nnet PWR = B1.+ R1.1\n");
    expect(tidiedDsl.ok).toBe(true);
    expect(draw(tidiedDsl.text!).verdict).toBe("valid");

    const tidiedJson = tidyCircuit(toJson.text!);
    expect(tidiedJson.ok).toBe(true);
    expect(draw(tidiedJson.text!).svg).toBe(ledSvg);

    const lossyJson = JSON.stringify({
      schema: "schem/1.0",
      meta: { title: "With extras", created: "2026-01-01" },
      circuit: {
        parts: [{ id: "R1", type: "resistor", props: { value: "10k" } }],
        nets: [],
      },
      ext: { author: "test" },
    });
    const lossy = convertCircuit(lossyJson, "dsl");
    expect(lossy.ok).toBe(false);
    expect(lossy.lostFields).toEqual(["ext", "meta.created"]);
    expect(lossy.error).toContain("ext");
    expect(lossy.error).toContain("meta.created");
  });

  it("highlights .schem lines without altering text characters", () => {
    const sample = [
      '# header comment',
      'circuit "LED with a \\"quote\\" & # hash"',
      'part R1 resistor 10k label="Front panel"',
      'chain B1[+] -> R1 -> D1 -> B1[-]',
      'net GND kind=ground = D1.cathode B1.-',
      'lock R1 at 10,20 rotate 90 flip',
    ].join("\n");
    const rendered = highlightDsl(sample);
    expect(rendered).toContain('class="t-com"');
    expect(rendered).toContain('class="t-key"');
    expect(rendered).toContain('class="t-str"');
    expect(rendered).toContain('class="t-ep"');
    expect(rendered).toContain('class="t-num"');
    const plain = rendered
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
    expect(plain).toBe(sample);
  });
});

describe("docs page (scripts/lib/docs-page.ts)", () => {
  const page = renderDocs(ROOT);
  const html = page.toc + page.body;

  it("every link within the page has a target, and repository links go to GitHub", () => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(10);
    expect(anchors.filter((a) => !ids.has(a))).toEqual([]);
    for (const m of html.matchAll(/href="([^"#][^"]*)"/g)) expect(m[1], m[1]).toMatch(/^https:\/\//);
  });

  it("leaves out notes for maintainers and the generated-file line", () => {
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("Generated by");
  });

  it("every circuit it offers to open in the playground draws valid", () => {
    expect(page.circuits.length).toBeGreaterThan(0);
    for (const c of page.circuits) expect(draw(c).verdict).toBe("valid");
  });

  it("includes DSL, templates and install docs, and offers both JSON and .schem circuits", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toContain("dsl");
    expect(ids).toContain("templates");
    expect(ids).toContain("install");
    const jsonCircuits = page.circuits.filter((c) => detectFormat(c) === "json");
    const dslCircuits = page.circuits.filter((c) => detectFormat(c) === "dsl");
    expect(jsonCircuits.length).toBeGreaterThan(0);
    expect(dslCircuits.length).toBeGreaterThanOrEqual(2);
    for (const c of [...jsonCircuits, ...dslCircuits]) {
      expect(draw(c).verdict).toBe("valid");
    }
  });
});
