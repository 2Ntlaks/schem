import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { openRoots } from "../src/mcp/roots.js";
import { callTool } from "../src/mcp/tools.js";

const root = mkdtempSync(join(tmpdir(), "schem-text-cli-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const led = readFileSync(new URL("./dsl-corpus/validation/case01-led.schem", import.meta.url), "utf8");
function folder(): string { return mkdtempSync(join(root, "case-")); }
function save(dir: string, name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source);
  return path;
}

function cli(...args: string[]): { code: number; body: Record<string, unknown>; stderr: string } {
  const stdout: string[] = [], stderr: string[] = [];
  const code = run([...args, "--json"], { out: (line) => stdout.push(line), err: (line) => stderr.push(line) });
  const output = stdout.join("\n");
  expect(output).not.toBe("");
  return { code, body: JSON.parse(output) as Record<string, unknown>, stderr: stderr.join("\n") };
}

describe("text schematics at the command line", () => {
  it("initialises an editable text template and refuses to overwrite", () => {
    const dir = folder(), file = join(dir, "starter.schem");
    expect(cli("init", join(dir, "starter"))).toMatchObject({ code: 0, body: { saved: true, verified: true } });
    const contents = readFileSync(file, "utf8");
    expect(contents).toContain("circuit");
    expect(contents).toContain("# schem-layout: ");
    expect(cli("init", file)).toMatchObject({ code: 1, body: { error: expect.stringContaining("already exists") } });
    expect(readFileSync(file, "utf8")).toBe(contents);
    expect(cli("check", file)).toMatchObject({ code: 0, body: { metrics: { crossings: 0 }, layoutToken: expect.any(String) } });
    const json = join(dir, "starter-json.schem.json");
    expect(cli("init", json).code).toBe(0);
    expect(JSON.parse(readFileSync(json, "utf8")).circuit.parts).toHaveLength(3);
  });

  it("renders both formats identically and writes DPI metadata in PNG exports", () => {
    const dir = folder(), dsl = save(dir, "led.schem", led);
    const json = join(dir, "led.schem.json");
    expect(cli("fmt", dsl, "--to", "json").code).toBe(0);
    const vec1 = join(dir, "dsl.svg"), vec2 = join(dir, "json.svg");
    expect(cli("render", dsl, "-o", vec1).code).toBe(0);
    expect(cli("render", json, "-o", vec2).code).toBe(0);
    expect(readFileSync(vec1)).toEqual(readFileSync(vec2));
    expect(cli("render", dsl, "-o", vec1).code).toBe(1);
    expect(cli("render", dsl, "-o", vec1, "--overwrite").code).toBe(0);
    const png = join(dir, "led.png");
    expect(cli("render", dsl, "--dpi", "300", "-o", png)).toMatchObject({ code: 0, body: { png: { dpi: 300, pxPerGrid: 30 } } });
    const bytes = readFileSync(png);
    expect(bytes.toString("ascii", 37, 41)).toBe("pHYs");
    expect(bytes.readUInt32BE(41)).toBe(Math.round(300 / 0.0254));
    expect(bytes.readUInt32BE(45)).toBe(Math.round(300 / 0.0254));
    expect(bytes[49]).toBe(1);
  });

  it("formats in place idempotently and reports lossy JSON fields", () => {
    const dir = folder(), source = "# current draft\n" + led;
    const dsl = save(dir, "part.schem", source);
    expect(cli("fmt", dsl)).toMatchObject({ code: 0, body: { saved: true, format: "dsl" } });
    const canonical = readFileSync(dsl, "utf8");
    expect(canonical).not.toContain("# current draft");
    expect(cli("fmt", dsl)).toMatchObject({ code: 0, body: { saved: false, format: "dsl" } });
    expect(readFileSync(dsl, "utf8")).toBe(canonical);
    expect(cli("undo", dsl).code).toBe(0);
    expect(readFileSync(dsl, "utf8")).toBe(source);
    const json = save(dir, "dated.json", JSON.stringify({
      meta: { created: "2026-11-19" }, circuit: { parts: [{ id: "R1", type: "resistor" }], nets: [] },
    }));
    expect(cli("fmt", json, "--to", "dsl")).toMatchObject({ code: 1, body: { fields: ["meta.created"] } });
    expect(existsSync(join(dir, "dated.schem"))).toBe(false);
  });

  it("edits and undoes text files with durable layout tokens after net renumbering", () => {
    const dir = folder(), source = "# preserve this in the snapshot\n" + led;
    const dsl = save(dir, "led.schem", source), out = join(dir, "figures");
    const initial = cli("check", dsl).body;
    const ops = save(dir, "rename.json", JSON.stringify([{ op: "renamePart", from: "R1", to: "A1" }]));
    const editArgs = ["edit", dsl, "--ops", ops, "--expect-revision", String(initial.revision), "-o", out];
    expect(cli(...editArgs, "--dry-run")).toMatchObject({ code: 0, body: { saved: false } });
    expect(existsSync(out)).toBe(false);
    expect(readFileSync(dsl, "utf8")).toBe(source);
    const saved = cli(...editArgs);
    expect(saved).toMatchObject({ code: 0, body: { saved: true, status: "valid" } });
    expect(readFileSync(dsl, "utf8")).toContain("part A1 resistor");
    expect(cli("check", dsl).body).toMatchObject({ revision: saved.body.revision, layoutToken: saved.body.layoutToken });
    expect(cli("query", dsl, "net", "n2").body).toMatchObject({ net: { endpoints: ["A1[2]", "D1[A]"] } });
    expect(cli(...editArgs)).toMatchObject({ code: 4, body: { status: "conflict" } });
    expect(cli("undo", dsl)).toMatchObject({ code: 0, body: { revision: initial.revision, saved: true } });
    expect(readFileSync(dsl, "utf8")).toBe(source);
    expect(cli("undo", dsl).code).toBe(1);
  });

  it("checks, queries and describes the verified drawing and previews a focused crop", () => {
    const dir = folder(), dsl = save(dir, "led.schem", led);
    const checked = cli("check", dsl);
    expect(checked).toMatchObject({ code: 0, body: { status: "valid", counts: { parts: 3, nets: 3 } } });
    expect(cli("query", dsl, "part", "R1")).toMatchObject({
      code: 0, body: { part: { id: "R1", pins: [{ number: "1" }, { number: "2" }] } },
    });
    expect(cli("query", dsl, "net", "PWR").body).toMatchObject({ net: { name: "PWR" } });
    expect(cli("describe", dsl, "--table")).toMatchObject({
      code: 0, body: { description: expect.stringContaining("R1 (resistor)"), table: expect.arrayContaining([expect.objectContaining({ name: "PWR" })]) },
    });
    const crop = join(dir, "focus.png"), preview = cli("preview", dsl, "-o", crop, "--focus", "D1", "--max", "160");
    expect(preview).toMatchObject({ code: 0, body: { focus: ["D1"] } });
    const bytes = readFileSync(crop);
    expect(Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20))).toBeLessThanOrEqual(160);
    expect(cli("components", "resistor", "--limit", "1")).toMatchObject({
      code: 0, body: { components: [{ id: "resistor", pins: expect.any(Array) }] },
    });
    expect(cli("component", "led")).toMatchObject({
      code: 0, body: { id: "led", refPrefix: "D", pins: expect.arrayContaining([expect.objectContaining({ number: "A", aliases: expect.arrayContaining(["anode".slice(0, 1)]) })]) },
    });
    expect(cli("component", "resister")).toMatchObject({
      code: 1, body: { error: expect.stringContaining("resistor"), suggestions: expect.arrayContaining(["resistor"]) },
    });
  });

  it("previews a drawing finding by id", () => {
    const dir = folder(), source = readFileSync(new URL("./dsl-corpus/bench/differentiator.schem", import.meta.url), "utf8");
    const dsl = save(dir, "filter.schem", source);
    const findings = cli("check", dsl).body.findings as Array<{ id: string }>;
    expect(findings.length).toBeGreaterThan(0);
    const id = findings[0]!.id, out = join(dir, "finding.png");
    expect(cli("preview", dsl, "--finding", id, "-o", out)).toMatchObject({ code: 0, body: { finding: id } });
    expect(existsSync(out)).toBe(true);
  });

  it("reports parser spans, usage errors and live write-lock conflicts", () => {
    const dir = folder(), bad = save(dir, "bad.schem", "part R1 resistor\nnet A = R1.3");
    const fail = cli("check", bad);
    expect(fail).toMatchObject({ code: 1, body: { issues: [{ code: "E104", at: "2:9-2:13" }] } });
    expect(cli("render", bad, "-o", join(dir, "bad.png"), "--scale", "1", "--dpi", "300")).toMatchObject({ code: 2, body: { status: "usage" } });
    const dsl = save(dir, "led.schem", led), ops = save(dir, "ops.json", "[]");
    save(dir, "led.schem.lock", "other writer\n");
    expect(cli("edit", dsl, "--ops", ops)).toMatchObject({ code: 4, body: { status: "conflict" } });
    expect(readFileSync(dsl, "utf8")).toBe(led);
  });
});

it.each(["led.schem", "led.schem.json"])("MCP create accepts text DSL source for %s", (name) => {
  const dir = folder(), roots = openRoots([dir]), path = join(dir, name);
  const created = callTool(roots, "schem_create", { path, source: led, detail: "brief" });
  expect(created.isError, JSON.stringify(created.content)).toBe(false);
  expect(callTool(roots, "schem_check", { path, detail: "brief" }).isError).toBe(false);
  const data = readFileSync(path, "utf8");
  expect(data.startsWith(name.endsWith(".json") ? "{" : 'circuit "')).toBe(true);
});
