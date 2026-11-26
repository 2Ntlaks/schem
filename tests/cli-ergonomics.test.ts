import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run, watchFile } from "../src/cli.js";
import { getInitTemplate, INIT_TEMPLATE_NAMES, INIT_TEMPLATES } from "../src/cli-templates.js";
import { compileDsl } from "../src/core/dsl.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";

const WORK = mkdtempSync(join(tmpdir(), "schem-ergonomics-"));
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

describe("schem init --template", () => {
  it("exports all six starter templates and returns undefined for unknown names", () => {
    expect([...INIT_TEMPLATE_NAMES]).toEqual(["led", "divider", "opamp", "regulator", "i2c", "bjt-amp"]);
    for (const name of INIT_TEMPLATE_NAMES) {
      expect(getInitTemplate(name)).toBe(INIT_TEMPLATES[name]);
    }
    expect(getInitTemplate("unknown")).toBeUndefined();
    expect(getInitTemplate("toString")).toBeUndefined();
  });

  for (const name of INIT_TEMPLATE_NAMES) {
    it(`initializes "${name}" and lays out valid with 0 overlaps`, () => {
      const dir = folder();
      const target = join(dir, `${name}.schem`);
      const res = cli("init", target, "--template", name, "--json");
      expect(res.code, res.out || res.err).toBe(0);
      const body = JSON.parse(res.out) as { saved: boolean; status: string; verified: boolean };
      expect(body).toMatchObject({ saved: true, status: "valid", verified: true });

      const text = readFileSync(target, "utf8");
      const compiled = compileDsl(text);
      expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
      const laid = layout(compiled.project!);
      expect(laid.status, JSON.stringify(laid.issues)).toBe("valid");
      expect(laid.render).toBeDefined();

      const quality = checkDrawing(compiled.project!.circuit, laid.pinDefs, laid.render!);
      expect(quality.valid, JSON.stringify(quality.connections.errors)).toBe(true);
      expect(quality.overlaps).toHaveLength(0);
    });
  }

  it("exits with code 2 and lists valid template names for an unknown --template", () => {
    const dir = folder();
    const target = join(dir, "bad.schem");

    const plain = cli("init", target, "--template", "not-a-template");
    expect(plain.code).toBe(2);
    expect(plain.err).toContain('Unknown template "not-a-template"');
    for (const name of INIT_TEMPLATE_NAMES) expect(plain.err).toContain(name);
    expect(existsSync(target)).toBe(false);

    const asJson = cli("init", target, "--template", "not-a-template", "--json");
    expect(asJson.code).toBe(2);
    const body = JSON.parse(asJson.out) as { status: string; error: string };
    expect(body.status).toBe("usage");
    for (const name of INIT_TEMPLATE_NAMES) expect(body.error).toContain(name);
    expect(existsSync(target)).toBe(false);
  });
});

describe("schem watch / watchFile()", () => {
  it("renders initial SVG/PNG, survives an invalid intermediate edit, redraws after a valid edit, and closes cleanly", async () => {
    const dir = folder();
    const outDir = join(dir, "out");
    const file = join(dir, "demo.schem");
    writeFileSync(file, INIT_TEMPLATES.led, "utf8");

    const out: string[] = [];
    const err: string[] = [];
    const events: Array<{ code: number; count: number }> = [];
    let waiter: ((ev: { code: number; count: number }) => void) | undefined;

    const nextDraw = (timeoutMs = 5000): Promise<{ code: number; count: number }> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          waiter = undefined;
          reject(new Error(`Timed out waiting for redraw (events so far: ${JSON.stringify(events)})`));
        }, timeoutMs);
        waiter = (ev) => {
          clearTimeout(t);
          waiter = undefined;
          resolve(ev);
        };
      });

    const handle = watchFile(file, {
      dir: outDir,
      debounceMs: 120,
      io: { out: (s) => out.push(s), err: (s) => err.push(s) },
      onDraw: (ev) => {
        events.push(ev);
        waiter?.(ev);
      },
    });

    try {
      expect(handle.drawCount).toBe(1);
      expect(events[0]).toEqual({ code: 0, count: 1 });
      const svgPath = join(outDir, "demo.svg");
      const pngPath = join(outDir, "demo.png");
      expect(existsSync(svgPath)).toBe(true);
      expect(existsSync(pngPath)).toBe(true);
      const initialSvg = readFileSync(svgPath, "utf8");
      expect(initialSvg).toContain("<svg ");
      expect(initialSvg).toContain("470");
      expect([...readFileSync(pngPath).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      // Intermediate invalid edit: prints a clear error to stderr without crashing.
      const invalidPending = nextDraw();
      writeFileSync(file, 'circuit "Broken"\npart R1 nonexistent-part\n', "utf8");
      const invalidEv = await invalidPending;
      expect(invalidEv.code).not.toBe(0);
      expect(err.join("\n")).toContain("Cannot draw");
      expect(err.join("\n")).toContain("nonexistent-part");

      // Valid recovery edit: redraws clean SVG and PNG with the new value.
      const validPending = nextDraw();
      const updated = INIT_TEMPLATES.led.replace("470", "1k");
      writeFileSync(file, updated, "utf8");
      const validEv = await validPending;
      expect(validEv.code).toBe(0);
      const updatedSvg = readFileSync(svgPath, "utf8");
      expect(updatedSvg).toContain("aria-label=\"1\u00a0k\u03a9\"");
      expect(updatedSvg).not.toBe(initialSvg);
      expect([...readFileSync(pngPath).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      // Closing stops any further redraws.
      const countAtClose = handle.drawCount;
      handle.close();
      writeFileSync(file, INIT_TEMPLATES.led.replace("470", "2.2k"), "utf8");
      await new Promise((r) => setTimeout(r, 300));
      expect(handle.drawCount).toBe(countAtClose);
    } finally {
      handle.close();
    }
  });
});
