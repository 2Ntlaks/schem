// MCP server (SPEC 11.5). Calls the tools in process. Files live in a temporary folder,
// never in tests/fixtures/ or examples/. One spawned process checks that stdout stays protocol.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { layoutToken, revision } from "../src/edit/edit.js";
import { fromLayoutCache } from "../src/io/layout-cache.js";
import { loadProject } from "../src/io/project.js";
import { pageOf } from "../src/mcp/sheet.js";
import { insideRoot } from "../src/mcp/roots.js";
import { createSession, handleMessage, serverArgs, type Session } from "../src/mcp/server.js";
import { callTool, type ToolResult } from "../src/mcp/tools.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), "schem-mcp-"));
const ROOT_DIR = join(WORK, "root");
const LED = readFileSync(join(REPO, "examples", "led.schem.json"), "utf8");

mkdirSync(ROOT_DIR);

let session: Session;
let ledFile = "";
let created: Record<string, unknown> = {};

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

function textOf(r: ToolResult): Record<string, unknown> {
  const block = r.content.find((c) => c.type === "text");
  if (block === undefined || block.type !== "text") throw new Error("tool result has no text");
  return JSON.parse(block.text) as Record<string, unknown>;
}

function rpc(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

describe("protocol", () => {
  it("negotiates a known version and answers an unknown one with its own", () => {
    const s = createSession([ROOT_DIR]);
    const known = handleMessage(s, rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {} }));
    expect(known).toBeDefined();
    expect(JSON.parse(known!).result.protocolVersion).toBe("2024-11-05");
    expect(JSON.parse(known!).result.serverInfo.name).toBe("schem");

    const other = createSession([ROOT_DIR]);
    const unknown = handleMessage(other, rpc(2, "initialize", { protocolVersion: "1999-01-01", capabilities: {} }));
    expect(JSON.parse(unknown!).result.protocolVersion).toBe("2025-06-18");
  });

  it("ignores the initialized notification and rejects tools before initialize", () => {
    const s = createSession([ROOT_DIR]);
    expect(handleMessage(s, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeUndefined();
    expect(handleMessage(s, "")).toBeUndefined();
    const early = JSON.parse(handleMessage(s, rpc(3, "tools/list", {}))!);
    expect(early.error.code).toBe(-32600);

    handleMessage(s, rpc(4, "initialize", { protocolVersion: "2025-06-18", capabilities: {} }));
    const list = JSON.parse(handleMessage(s, rpc(5, "tools/list", {}))!);
    const names = (list.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(["schem_create", "schem_edit", "schem_check", "schem_preview", "schem_query", "schem_render"]);

    const undo = JSON.parse(handleMessage(s, rpc(6, "tools/call", { name: "schem_undo", arguments: { path: "x" } }))!);
    expect(undo.result.isError).toBe(true);
    expect(undo.result.content[0].text).toContain("not in this server");

    const ping = JSON.parse(handleMessage(s, rpc(7, "ping", {}))!);
    expect(ping.result).toEqual({});
    const missing = JSON.parse(handleMessage(s, rpc(8, "nope", {}))!);
    expect(missing.error.code).toBe(-32601);
    const bad = JSON.parse(handleMessage(s, "{")!);
    expect(bad.error.code).toBe(-32700);
  });

  it("parses server arguments", () => {
    expect(serverArgs(["--help"]).help).toBe(true);
    expect(serverArgs(["--root"]).error).toContain("--root");
    expect(serverArgs(["--weird"]).error).toContain("unknown argument");
    const parsed = serverArgs(["--root", ROOT_DIR, "--root", ROOT_DIR]);
    expect(parsed.roots).toEqual([ROOT_DIR, ROOT_DIR]);
  });

  it("keeps a sibling folder out of a root", () => {
    expect(insideRoot(ROOT_DIR, ROOT_DIR)).toBe(true);
    expect(insideRoot(ROOT_DIR, join(ROOT_DIR, "a.json"))).toBe(true);
    expect(insideRoot(ROOT_DIR, join(WORK, "root-other", "a.json"))).toBe(false);
  });

  it("pages with a decimal cursor", () => {
    expect(pageOf([1, 2, 3, 4, 5, 6], undefined, 5)).toEqual({ ok: true, items: [1, 2, 3, 4, 5], next: "5" });
    expect(pageOf([1, 2, 3, 4, 5, 6], "5", 5)).toEqual({ ok: true, items: [6], next: null });
    expect(pageOf([1], "nope", 5).ok).toBe(false);
  });
});

describe("stdio", () => {
  it("writes only JSON-RPC to stdout", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "mcp", "main.ts"), "--root", ROOT_DIR], {
      cwd: REPO,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => { out += s; });
    child.stderr.on("data", (s: string) => { err += s; });
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out. stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`)), 20000);
      child.stdout.on("data", () => {
        if (!out.includes("\n")) return;
        clearTimeout(timer);
        resolve();
      });
    });
    child.stdin.write(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }) + "\n");
    await done;
    child.kill();
    expect(err).toContain("schem mcp:");
    expect(out).not.toContain("schem mcp:");
    const msg = JSON.parse(out.trim().split(/\r?\n/)[0]!);
    expect(msg.result.serverInfo.name).toBe("schem");
    expect(msg.result.protocolVersion).toBe("2025-06-18");
  }, 30000);
});

describe("file roots and limits", () => {
  beforeAll(() => {
    session = createSession([ROOT_DIR]);
  });

  it("refuses a path outside the root, including one reached through a junction", () => {
    const outside = join(WORK, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.schem.json"), "{}\n");
    symlinkSync(outside, join(ROOT_DIR, "jump"), process.platform === "win32" ? "junction" : "dir");

    const direct = callTool(session.roots, "schem_create", {
      path: join(outside, "new.schem.json"), source: LED, detail: "brief",
    });
    expect(direct.isError).toBe(true);
    expect(textOf(direct).error).toContain("outside");
    expect(existsSync(join(outside, "new.schem.json"))).toBe(false);

    const jumped = callTool(session.roots, "schem_check", {
      path: join(ROOT_DIR, "jump", "secret.schem.json"), detail: "brief",
    });
    expect(jumped.isError).toBe(true);
    expect(textOf(jumped).error).toContain("outside");

    const created = callTool(session.roots, "schem_create", {
      path: join(ROOT_DIR, "jump", "made.schem.json"), source: LED, detail: "brief",
    });
    expect(created.isError).toBe(true);
    expect(textOf(created).error).toContain("outside");
    expect(existsSync(join(outside, "made.schem.json"))).toBe(false);
  });

  it("refuses to replace a file symlink when the operating system allows one", () => {
    const real = join(ROOT_DIR, "link-target.schem.json");
    writeFileSync(real, "{}\n");
    const link = join(ROOT_DIR, "link.schem.json");
    try {
      symlinkSync(real, link, "file");
    } catch (e) {
      expect(["EPERM", "ENOTSUP", "EACCES", "EINVAL"]).toContain((e as NodeJS.ErrnoException).code);
      return;
    }
    const r = callTool(session.roots, "schem_edit", { path: link, ops: [], detail: "brief" });
    expect(r.isError).toBe(true);
    expect(String(textOf(r).error)).toContain("symlink or junction");
  });

  it("refuses a source over 2 MB, a circuit over 500 parts, a long label and a huge symbol", () => {
    const big = callTool(session.roots, "schem_create", {
      path: join(ROOT_DIR, "big.schem.json"), source: "x".repeat(2 * 1024 * 1024 + 1), detail: "brief",
    });
    expect(big.isError).toBe(true);
    expect(textOf(big).error).toContain("2 MB");
    expect(existsSync(join(ROOT_DIR, "big.schem.json"))).toBe(false);

    const parts = callTool(session.roots, "schem_create", {
      path: join(ROOT_DIR, "many.schem.json"),
      source: { circuit: { parts: Array.from({ length: 501 }, () => ({})), nets: [] } },
      detail: "brief",
    });
    expect(parts.isError).toBe(true);
    expect(textOf(parts).error).toContain("500");
    expect(existsSync(join(ROOT_DIR, "many.schem.json"))).toBe(false);

    const led = JSON.parse(LED) as { circuit: { parts: Array<{ id: string; props?: Record<string, string> }> }; assets?: unknown };
    const resistor = led.circuit.parts.find((p) => p.id === "R1");
    resistor!.props = { value: "x".repeat(201) };
    const label = callTool(session.roots, "schem_create", { path: join(ROOT_DIR, "label.schem.json"), source: led, detail: "brief" });
    expect(label.isError).toBe(true);
    expect(textOf(label).error).toContain("200");
    expect(existsSync(join(ROOT_DIR, "label.schem.json"))).toBe(false);

    const symbol = JSON.parse(LED) as { assets?: unknown };
    symbol.assets = { definitions: { blob: { graphics: [{ d: "M".repeat(5001) }] } } };
    const path = callTool(session.roots, "schem_create", { path: join(ROOT_DIR, "symbol.schem.json"), source: symbol, detail: "brief" });
    expect(path.isError).toBe(true);
    expect(textOf(path).error).toContain("5000");
    expect(existsSync(join(ROOT_DIR, "symbol.schem.json"))).toBe(false);
  });
});

describe("tools on a project file", () => {
  beforeAll(() => {
    if (session === undefined) session = createSession([ROOT_DIR]);
    ledFile = join(ROOT_DIR, "led.schem.json");
    const r = callTool(session.roots, "schem_create", { path: ledFile, source: LED, detail: "brief" });
    expect(r.isError, JSON.stringify(r.content)).toBe(false);
    created = textOf(r);
  }, 120_000);

  it("creates the file and reports the same tokens the engine computes", () => {
    expect(created.status).toBe("valid");
    expect(created.verified).toBe(true);
    expect(created.saved).toBe(true);
    expect(existsSync(ledFile)).toBe(true);
    const project = loadProject(readFileSync(ledFile, "utf8")).project!;
    expect(created.revision).toBe(revision(project));
    const state = fromLayoutCache(project.layoutCache, String(created.revision)).state;
    expect(state).toBeDefined();
    expect(created.layoutToken).toBe(layoutToken(project, state!));
    const again = callTool(session.roots, "schem_create", { path: ledFile, source: LED, detail: "brief" });
    expect(again.isError).toBe(true);
    expect(textOf(again).error).toContain("already exists");
  });

  it("edits, dry-runs, and refuses a stale revision", () => {
    const original = readFileSync(ledFile, "utf8");
    const dry = callTool(session.roots, "schem_edit", {
      path: ledFile, ops: [{ op: "setProp", part: "R1", key: "value", value: "2k" }],
      expectedRevision: created.revision, dryRun: true, detail: "brief",
    });
    expect(dry.isError, JSON.stringify(textOf(dry))).toBe(false);
    expect(textOf(dry).saved).toBe(false);
    expect(textOf(dry).dryRun).toBe(true);
    expect(textOf(dry).fileRevision).toBe(created.revision);
    expect(readFileSync(ledFile, "utf8")).toBe(original);

    const edited = callTool(session.roots, "schem_edit", {
      path: ledFile, ops: [{ op: "setProp", part: "R1", key: "value", value: "1k" }],
      expectedRevision: created.revision, detail: "brief",
    });
    expect(edited.isError, JSON.stringify(textOf(edited))).toBe(false);
    const body = textOf(edited);
    expect(body.saved).toBe(true);
    expect(body.revision).not.toBe(created.revision);
    expect(loadProject(readFileSync(ledFile, "utf8")).project!.circuit.parts.find((p) => p.id === "R1")!.props!.value).toBe("1k");
    const history = join(ROOT_DIR, ".schem-history", "led.schem.json");
    expect(existsSync(history)).toBe(true);

    const conflict = callTool(session.roots, "schem_edit", {
      path: ledFile, ops: [{ op: "setProp", part: "R1", key: "value", value: "3k" }],
      expectedRevision: created.revision, detail: "brief",
    });
    expect(conflict.isError).toBe(true);
    expect(textOf(conflict).status).toBe("conflict");
    expect(loadProject(readFileSync(ledFile, "utf8")).project!.circuit.parts.find((p) => p.id === "R1")!.props!.value).toBe("1k");

    const duplicate = callTool(session.roots, "schem_edit", {
      path: ledFile, ops: [{ op: "addPart", part: { id: "R1", type: "resistor" } }], detail: "brief",
    });
    expect(duplicate.isError).toBe(true);
    expect(String(textOf(duplicate).error)).toContain("already exists");
  }, 120_000);

  it("checks, queries and refuses a bad cursor", () => {
    const checked = callTool(session.roots, "schem_check", { path: ledFile, detail: "normal" });
    expect(checked.isError, JSON.stringify(textOf(checked))).toBe(false);
    const body = textOf(checked);
    expect(body.status).toBe("valid");
    expect(Array.isArray(body.findings)).toBe(true);
    expect(body.cursor === null || typeof body.cursor === "string").toBe(true);
    const bad = callTool(session.roots, "schem_check", { path: ledFile, cursor: "nope", detail: "normal" });
    expect(bad.isError).toBe(true);
    expect(String(textOf(bad).error)).toContain("cursor");

    const part = textOf(callTool(session.roots, "schem_query", { path: ledFile, part: "R1" }));
    const view = part.part as { id: string; at: number[]; pins: Array<{ number: string; net: { id: string } | null }> };
    expect(view.id).toBe("R1");
    expect(view.at).toHaveLength(2);
    expect(view.pins.map((p) => p.number).sort()).toEqual(["1", "2"]);
    expect(view.pins.some((p) => p.net?.id === "n1")).toBe(true);

    const net = textOf(callTool(session.roots, "schem_query", { path: ledFile, net: "n3" }));
    const n3 = net.net as { name: string; kind: string };
    expect(n3.name).toBe("GND");
    expect(n3.kind).toBe("ground");

    const both = callTool(session.roots, "schem_query", { path: ledFile, part: "R1", net: "n3" });
    expect(both.isError).toBe(true);
    const missing = callTool(session.roots, "schem_query", { path: ledFile, part: "R9" });
    expect(missing.isError).toBe(true);
  }, 120_000);

  it("previews a PNG and warns when labels would be under 9 px", () => {
    const preview = callTool(session.roots, "schem_preview", { path: ledFile, maxSize: 1024 });
    expect(preview.isError, JSON.stringify(preview.content.find((c) => c.type === "text"))).toBe(false);
    const image = preview.content.find((c) => c.type === "image");
    expect(image && image.type === "image" && image.mimeType).toBe("image/png");
    const png = Buffer.from(image && image.type === "image" ? image.data : "", "base64");
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const info = textOf(preview).png as { width: number; height: number };
    expect(png.readUInt32BE(16)).toBe(info.width);
    expect(png.readUInt32BE(20)).toBe(info.height);
    expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(1024);

    const tiny = callTool(session.roots, "schem_preview", { path: ledFile, maxSize: 16 });
    expect(tiny.isError).toBe(false);
    expect(String(textOf(tiny).note)).toContain("9 px");
    expect(tiny.content.some((c) => c.type === "image")).toBe(true);

    const crop = callTool(session.roots, "schem_preview", { path: ledFile, maxSize: 256, focus: ["R1"] });
    expect(crop.isError, JSON.stringify(textOf(crop))).toBe(false);
    expect(textOf(crop).focus).toEqual(["R1"]);
    const cropImage = crop.content.find((c) => c.type === "image");
    const cropPng = Buffer.from(cropImage && cropImage.type === "image" ? cropImage.data : "", "base64");
    expect([...cropPng.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }, 120_000);

  it("renders svg and png, and refuses a double scale and an oversized png", () => {
    const svgPath = join(ROOT_DIR, "led.svg");
    const pngPath = join(ROOT_DIR, "led.png");
    const svg = callTool(session.roots, "schem_render", { path: ledFile, format: "svg", out: svgPath });
    expect(svg.isError, JSON.stringify(textOf(svg))).toBe(false);
    expect(readFileSync(svgPath, "utf8").startsWith("<svg ")).toBe(true);
    const again = callTool(session.roots, "schem_render", { path: ledFile, format: "svg", out: svgPath });
    expect(again.isError).toBe(true);
    expect(String(textOf(again).error)).toContain("already exists");
    const replaced = callTool(session.roots, "schem_render", { path: ledFile, format: "svg", out: svgPath, overwrite: true });
    expect(replaced.isError).toBe(false);

    const png = callTool(session.roots, "schem_render", { path: ledFile, format: "png", out: pngPath, dpi: 96 });
    expect(png.isError, JSON.stringify(textOf(png))).toBe(false);
    expect([...readFileSync(pngPath).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const both = callTool(session.roots, "schem_render", { path: ledFile, format: "png", out: join(ROOT_DIR, "both.png"), scale: 10, dpi: 96 });
    expect(both.isError).toBe(true);
    expect(String(textOf(both).error)).toContain("not both");
    const huge = callTool(session.roots, "schem_render", { path: ledFile, format: "png", out: join(ROOT_DIR, "huge.png"), scale: 100000 });
    expect(huge.isError).toBe(true);
    expect(String(textOf(huge).error)).toContain("8000");
    expect(existsSync(join(ROOT_DIR, "huge.png"))).toBe(false);
  }, 120_000);

  it("refuses an edit while a fresh lock is held, and takes over a stale one", () => {
    const lock = `${ledFile}.lock`;
    writeFileSync(lock, "other\n", { flag: "wx" });
    const held = callTool(session.roots, "schem_edit", {
      path: ledFile, ops: [{ op: "setProp", part: "R1", key: "value", value: "470" }], detail: "brief",
    });
    expect(held.isError).toBe(true);
    expect(String(textOf(held).error)).toContain("another writer");
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    const taken = callTool(session.roots, "schem_edit", {
      path: ledFile, ops: [{ op: "setProp", part: "R1", key: "value", value: "470" }], detail: "brief",
    });
    expect(taken.isError, JSON.stringify(textOf(taken))).toBe(false);
    expect(existsSync(lock)).toBe(false);
  }, 120_000);
});
