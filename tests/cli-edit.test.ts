// `schem edit` (SPEC 11.4) and the saved layout it writes (src/io/layout-cache.ts).
//
// Calls run() directly, so no process is spawned. Every file it edits is a copy in a temporary
// folder; examples/ is never written.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { fromLayoutCache, toLayoutCache } from "../src/io/layout-cache.js";
import { loadProject, saveProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { generate } from "./support/generate.js";
import { randomEdit } from "./support/random-edits.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), "schem-edit-"));

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

let n = 0;
/** A fresh folder holding a copy of an example. */
function copyOf(example: string): { dir: string; file: string; out: string } {
  const dir = join(WORK, `t${++n}`);
  const file = join(dir, `${example}.schem.json`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "examples", `${example}.schem.json`), file);
  return { dir, file, out: join(dir, "out") };
}
function ops(dir: string, name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

const ADD_LED = { ops: [
  { op: "addPart", part: { id: "D9", type: "led", props: { color: "green" } } },
  { op: "addPart", part: { id: "R9", type: "resistor", props: { value: "330" } } },
  { op: "connect", endpoints: ["U1.IO25", "R9[1]"], name: "STATUS" },
  { op: "connect", endpoints: ["R9[2]", "D9[A]"] },
  { op: "connect", endpoints: ["D9[K]", "Q1[E]"] },
] };

describe("schem edit", () => {
  it("saves the edit, keeps the drawing, and draw shows the same drawing afterwards", () => {
    const t = copyOf("esp32-relay");
    const r = cli("edit", t.file, "--ops", ops(t.dir, "add.json", ADD_LED), "-o", t.out);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("edit saved (drawing kept)");
    expect(r.out).toContain("changed: parts D9, R9, U1");
    expect(r.out).not.toContain("warning");

    const saved = loadProject(readFileSync(t.file, "utf8")).project!;
    expect(saved.circuit.parts.map((p) => p.id)).toContain("D9");
    expect(saved.layoutCache).toBeDefined();
    const editedSvg = readFileSync(join(t.out, "esp32-relay.svg"), "utf8");

    const d = cli("draw", t.file, "-o", join(t.dir, "redraw"));
    expect(d.code).toBe(0);
    expect(d.err).toBe("");
    expect(readFileSync(join(t.dir, "redraw", "esp32-relay.svg"), "utf8")).toBe(editedSvg);
  });

  it("keeps a copy of the file before each save in .schem-history", () => {
    const t = copyOf("led");
    const original = readFileSync(t.file, "utf8");
    const setValue = (v: string) => ops(t.dir, `v${v}.json`, [{ op: "setProp", part: "R1", key: "value", value: v }]);
    expect(cli("edit", t.file, "--ops", setValue("1k"), "-o", t.out).code).toBe(0);
    expect(cli("edit", t.file, "--ops", setValue("2k"), "-o", t.out).code).toBe(0);
    const hist = join(t.dir, ".schem-history", "led.schem.json");
    expect(readdirSync(hist).sort()).toEqual(["1.schem.json", "2.schem.json"]);
    expect(readFileSync(join(hist, "1.schem.json"), "utf8")).toBe(original);
    expect(readdirSync(t.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("--dry-run checks the edit and writes nothing", () => {
    const t = copyOf("led");
    const before = readFileSync(t.file, "utf8");
    const r = cli("edit", t.file, "--ops", ops(t.dir, "v.json", [{ op: "setProp", part: "R1", key: "value", value: "1k" }]), "-o", t.out, "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("edit checked");
    expect(readFileSync(t.file, "utf8")).toBe(before);
    expect(existsSync(t.out)).toBe(false);
    expect(existsSync(join(t.dir, ".schem-history"))).toBe(false);
  });

  it("refuses an invalid operation, writes nothing and exits 1", () => {
    const t = copyOf("led");
    const before = readFileSync(t.file, "utf8");
    const r = cli("edit", t.file, "--ops", ops(t.dir, "dup.json", [{ op: "addPart", part: { id: "R1", type: "resistor" } }]), "-o", t.out);
    expect(r.code).toBe(1);
    expect(r.out).toContain("edit refused");
    expect(r.out).toContain('E250 part "R1" already exists');
    expect(readFileSync(t.file, "utf8")).toBe(before);
    expect(existsSync(t.out)).toBe(false);
  });

  it("chains edits with the revision and layout tokens, and exits 4 on a stale one", () => {
    const t = copyOf("summing-amp");
    const first = cli("edit", t.file, "--ops", ops(t.dir, "a.json", [{ op: "setProp", part: "R1", key: "value", value: "22k" }]), "-o", t.out, "--json");
    expect(first.code).toBe(0);
    const j = JSON.parse(first.out) as { saved: boolean; stable: boolean; revision: string; layoutToken: string };
    expect(j.saved).toBe(true);
    expect(j.stable).toBe(true);

    const label = ops(t.dir, "b.json", [{ op: "setLabelSide", part: "R1", side: "below" }]);
    const second = cli("edit", t.file, "--ops", label, "-o", t.out, "--expect-revision", j.revision, "--expect-layout", j.layoutToken);
    expect(second.code).toBe(0);
    // The file has moved on, so the first tokens are stale now.
    const stale = cli("edit", t.file, "--ops", label, "-o", t.out, "--expect-revision", j.revision);
    expect(stale.code).toBe(4);
    expect(stale.out).toContain("edit refused (conflict)");
  });

  it("a file changed by hand after an edit is drawn afresh, with a note", () => {
    const t = copyOf("led");
    expect(cli("edit", t.file, "--ops", ops(t.dir, "v.json", [{ op: "setProp", part: "R1", key: "value", value: "1k" }]), "-o", t.out).code).toBe(0);
    writeFileSync(t.file, readFileSync(t.file, "utf8").replace('"1k"', '"2.2k"'));
    const d = cli("draw", t.file, "-o", t.out);
    expect(d.code).toBe(0);
    expect(d.err).toContain("changed since this file's layout was saved");
  });

  it("reports missing or bad operations as input errors (exit 2)", () => {
    const t = copyOf("led");
    expect(cli("edit", t.file).code).toBe(2);
    expect(cli("edit", t.file, "--ops", join(t.dir, "none.json")).err).toContain("no such file");
    const bad = cli("edit", t.file, "--ops", ops(t.dir, "bad.json", [{ op: "explode", part: "R1" }]));
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown operation "explode"');
    expect(cli("draw", t.file, "--strict").code).toBe(2);
  });
});

describe("schem edit --strict", () => {
  // Generated circuit 50 with its random edit: the edit reroutes two nets it did not involve
  // (the limit is 6), one of the few such edits in the tests/edits.test.ts sweep.
  const unstable = () => {
    const dir = join(WORK, `strict${++n}`);
    mkdirSync(dir, { recursive: true });
    const g = generate(50, 5);
    const file = join(dir, "g50.schem.json");
    writeFileSync(file, JSON.stringify({ schema: "schem/1.0", circuit: g.circuit }));
    return { dir, file, ops: ops(dir, "e.json", randomEdit(g.circuit, 50 * 31)), out: join(dir, "out") };
  };

  it("without --strict, an edit past the stability limit is saved with a warning", () => {
    const t = unstable();
    const r = cli("edit", t.file, "--ops", t.ops, "-o", t.out);
    expect(r.code).toBe(0);
    expect(r.out).toContain("warning: this edit moves untouched parts more than the limit (routes changed on 2 nets the edit did not involve (at most 1): n5, n6)");
  });

  it("with --strict, the same edit is refused and nothing is written", () => {
    const t = unstable();
    const before = readFileSync(t.file, "utf8");
    const r = cli("edit", t.file, "--ops", t.ops, "-o", t.out, "--strict");
    expect(r.code).toBe(1);
    expect(r.out).toContain("edit refused (unstable)");
    expect(r.out).toContain("would move: routes changed on 2 nets the edit did not involve (at most 1): n5, n6");
    expect(readFileSync(t.file, "utf8")).toBe(before);
    expect(existsSync(t.out)).toBe(false);
  });

  it("with --strict, an edit within the limit is saved as usual", () => {
    const t = copyOf("esp32-relay");
    const r = cli("edit", t.file, "--ops", ops(t.dir, "add.json", ADD_LED), "-o", t.out, "--strict");
    expect(r.code).toBe(0);
    expect(r.out).toContain("edit saved (drawing kept)");
  });
});

describe("saved layout (src/io/layout-cache.ts)", () => {
  const project = loadProject(readFileSync(join(ROOT, "examples", "i2c-sensors.schem.json"), "utf8")).project!;
  const state = layout(project).state!;

  it("reads back exactly what it wrote, through a saved file", () => {
    const text = saveProject({ ...project, layoutCache: toLayoutCache(state, "abc", "canonical") });
    const again = loadProject(text).project!;
    expect(fromLayoutCache(again.layoutCache, "abc")).toEqual({ state });
    expect(saveProject(again)).toBe(text);
  });

  it("writes one part and one route per line", () => {
    const text = saveProject({ ...project, layoutCache: toLayoutCache(state, "abc", "canonical") });
    const lines = text.split("\n");
    const at = lines.indexOf('  "layout": {');
    expect(at).toBeGreaterThan(0);
    const body = lines.slice(at);
    expect(body.filter((l) => /^ {6}"U1": \{"x":/.test(l))).toHaveLength(1);
    expect(body.filter((l) => /^ {6}\{"net":/.test(l))).toHaveLength(Object.keys(state.routes).length);
  });

  it("ignores a layout made for another revision, or one it cannot read", () => {
    const cache = toLayoutCache(state, "abc", "canonical");
    expect(fromLayoutCache(cache, "xyz").state).toBeUndefined();
    expect(fromLayoutCache(cache, "xyz").note).toContain("changed since");
    expect(fromLayoutCache({ ...cache, parts: { R1: { x: "left" } } }, "abc").note).toContain("cannot be read");
    expect(fromLayoutCache(undefined, "abc")).toEqual({});
  });
});
