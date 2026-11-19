// Prove the npm package works when installed from nothing (npm run pack:smoke).
//
// 1. npm pack (which builds dist/ through prepack) into a temporary folder outside the repo.
// 2. Install the tarball into a fresh folder that has no other dependencies.
// 3. With the installed `schem` command:
//    - --version prints the version in package.json;
//    - draw makes byte-identical SVG and PNG files to the same drawing made from the repo's
//      source (src/cli.ts), for three examples;
//    - `schem mcp` answers initialize and tools/list over stdio with the same tool list and
//      instructions as the repo's server, and schem_create then schem_render make the same SVG
//      as the repo's server does in-process.
// 4. Run the tarball through npx in an empty folder, as `npx schem` will once it is published.
// 5. Install from the clone as docs/install.md describes (npm install -g, into a temporary
//    prefix so the real global folder is untouched) and draw one example with it.
//
// It prints the tarball size and file count and exits 1 on the first failure. Keep with
// --keep to leave the temporary folder for a look at the drawings.

import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.js";
import { createSession, handleMessage, INSTRUCTIONS } from "../src/mcp/server.js";
import { TOOLS } from "../src/mcp/tools.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WIN = process.platform === "win32";
const EXAMPLES = ["led", "esp32-relay", "summing-amp"];
const keep = process.argv.includes("--keep");
const version = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;

let step = 0;
function ok(message: string): void {
  console.log(`  ok ${++step}  ${message}`);
}
function fail(message: string): never {
  console.error(`  FAIL  ${message}`);
  process.exit(1);
}

/** Quote one argument for cmd.exe when a .cmd shim has to run through the shell. */
function quote(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

/** Run a command; on Windows npm, npx and bin shims are .cmd files and need the shell. */
function exec(cmd: string, args: string[], cwd: string, input?: string): SpawnSyncReturns<string> {
  const r = WIN
    ? spawnSync([cmd, ...args].map(quote).join(" "), { cwd, shell: true, encoding: "utf8", input })
    : spawnSync(cmd, args, { cwd, encoding: "utf8", input });
  if (r.error) fail(`${cmd} ${args.join(" ")}: ${r.error.message}`);
  return r;
}

function mustRun(cmd: string, args: string[], cwd: string): string {
  const r = exec(cmd, args, cwd);
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function sameBytes(a: string, b: string, what: string): void {
  if (!existsSync(a)) fail(`${what}: ${a} was not written`);
  if (!existsSync(b)) fail(`${what}: ${b} was not written`);
  if (!readFileSync(a).equals(readFileSync(b))) fail(`${what}: ${a} and ${b} differ`);
}

/** The drawings the repo's own source makes, for comparison. */
function referenceDrawings(dir: string): void {
  for (const name of EXAMPLES) {
    const err: string[] = [];
    const code = run(["draw", path.join(ROOT, "examples", `${name}.schem.json`), "-o", dir], { out: () => {}, err: (s) => err.push(s) });
    if (code !== 0) fail(`repo draw ${name} exited ${code}: ${err.join("\n")}`);
  }
}

/** Draw every example with a `schem` command and compare with the repo's drawings. */
function checkDraws(bin: string, binArgs: string[], cwd: string, refDir: string, label: string): void {
  for (const name of EXAMPLES) {
    copyFileSync(path.join(ROOT, "examples", `${name}.schem.json`), path.join(cwd, `${name}.schem.json`));
    const out = mustRun(bin, [...binArgs, "draw", `${name}.schem.json`, "-o", "out"], cwd);
    if (!out.includes(`${name}: valid.`)) fail(`${label} draw ${name}: unexpected output: ${out}`);
    sameBytes(path.join(cwd, "out", `${name}.svg`), path.join(refDir, `${name}.svg`), `${label} ${name}.svg`);
    sameBytes(path.join(cwd, "out", `${name}.png`), path.join(refDir, `${name}.png`), `${label} ${name}.png`);
  }
  ok(`${label}: draw ${EXAMPLES.join(", ")}: SVG and PNG byte-identical to the repo's`);
}

// ---------------------------------------------------------------------------
// The MCP server over stdio

type Reply = { id?: number; result?: Record<string, unknown>; error?: { message: string } };

/** Send requests one at a time to `schem mcp` and collect the replies by id. */
async function mcpSession(bin: string, args: string[], cwd: string, messages: object[]): Promise<Map<number, Reply>> {
  const child = WIN
    ? spawn([bin, ...args].map(quote).join(" "), { cwd, shell: true, stdio: ["pipe", "pipe", "pipe"] })
    : spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const replies = new Map<number, Reply>();
  let buffer = "";
  let stderr = "";
  const waiting = new Map<number, () => void>();
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  child.stdout.setEncoding("utf8").on("data", (d: string) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let reply: Reply;
      try {
        reply = JSON.parse(line) as Reply;
      } catch {
        fail(`schem mcp wrote a line that is not JSON: ${line}\nstderr: ${stderr}`);
      }
      if (typeof reply.id === "number") {
        replies.set(reply.id, reply);
        waiting.get(reply.id)?.();
      }
    }
  });
  const exited = new Promise<number | null>((res) => child.on("close", res));
  for (const m of messages) {
    const id = (m as { id?: number }).id;
    child.stdin.write(`${JSON.stringify(m)}\n`);
    if (id === undefined) continue;
    await Promise.race([
      new Promise<void>((res) => waiting.set(id, res)),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error(`no reply to request ${id} in 60 s; stderr: ${stderr}`)), 60_000)),
    ]).catch((e: Error) => fail(e.message));
  }
  child.stdin.end();
  const code = await Promise.race([exited, new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 15_000))]);
  if (code === "timeout") {
    child.kill();
    fail(`schem mcp did not exit when stdin closed; stderr: ${stderr}`);
  }
  if (code !== 0) fail(`schem mcp exited ${code}; stderr: ${stderr}`);
  return replies;
}

/** The requests both servers get; paths are absolute, inside `root`. */
function mcpMessages(root: string): object[] {
  const netlist = JSON.parse(readFileSync(path.join(ROOT, "examples", "led.schem.json"), "utf8")) as unknown;
  return [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pack-smoke", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "schem_create", arguments: { path: path.join(root, "smoke.schem.json"), source: netlist, detail: "brief" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "schem_render", arguments: { path: path.join(root, "smoke.schem.json"), format: "svg", out: path.join(root, "smoke.svg") } } },
  ];
}

/** The same calls on the repo's server, in-process, in its own root. */
function repoMcp(root: string): Map<number, Reply> {
  const session = createSession([root]);
  const replies = new Map<number, Reply>();
  for (const m of mcpMessages(root)) {
    const line = handleMessage(session, JSON.stringify(m));
    if (line !== undefined) {
      const r = JSON.parse(line) as Reply;
      if (typeof r.id === "number") replies.set(r.id, r);
    }
  }
  return replies;
}

function toolText(r: Reply | undefined, what: string): Record<string, unknown> {
  if (r?.result === undefined) fail(`${what}: no result (${r?.error?.message ?? "no reply"})`);
  const res = r.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  if (res.isError) fail(`${what}: the tool reported an error: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

async function checkMcp(bin: string, binArgs: string[], cwd: string, repoRoot: string, label: string): Promise<void> {
  const installed = await mcpSession(bin, [...binArgs, "mcp", "--root", cwd], cwd, mcpMessages(cwd));
  const repo = repoMcp(repoRoot);

  const init = installed.get(1)?.result as { serverInfo?: { name: string; version: string }; instructions?: string } | undefined;
  if (init?.serverInfo?.name !== "schem" || init.serverInfo.version !== version) fail(`${label} initialize: serverInfo ${JSON.stringify(init?.serverInfo)}`);
  if (init.instructions !== INSTRUCTIONS) fail(`${label} initialize: instructions differ from the repo's server`);
  ok(`${label}: mcp initialize: serverInfo schem ${version}, same instructions as the repo`);

  const tools = (installed.get(2)?.result as { tools?: unknown } | undefined)?.tools;
  if (JSON.stringify(tools) !== JSON.stringify(TOOLS)) fail(`${label} tools/list differs from the repo's TOOLS`);
  ok(`${label}: mcp tools/list: ${TOOLS.map((t) => t.name).join(", ")}, identical to the repo`);

  const created = toolText(installed.get(3), `${label} schem_create`);
  const repoCreated = toolText(repo.get(3), "repo schem_create");
  if (created.status !== "valid") fail(`${label} schem_create: status ${String(created.status)}`);
  if (created.revision !== repoCreated.revision || created.layoutToken !== repoCreated.layoutToken) {
    fail(`${label} schem_create: revision or layoutToken differ from the repo (${String(created.revision)} vs ${String(repoCreated.revision)})`);
  }
  toolText(installed.get(4), `${label} schem_render`);
  toolText(repo.get(4), "repo schem_render");
  sameBytes(path.join(cwd, "smoke.svg"), path.join(repoRoot, "smoke.svg"), `${label} schem_render smoke.svg`);
  ok(`${label}: mcp schem_create (status valid, same revision and layoutToken) then schem_render: SVG byte-identical to the repo's server`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const work = realpathSync(mkdtempSync(path.join(tmpdir(), "schem-smoke-")));
  if (work.toLowerCase().startsWith(ROOT.toLowerCase())) fail(`temporary folder ${work} is inside the repo`);
  console.log(`pack:smoke in ${work}`);
  try {
    const npm = WIN ? "npm.cmd" : "npm";
    const npx = WIN ? "npx.cmd" : "npx";

    // 1. Pack.
    const packDir = path.join(work, "pack");
    mkdirSync(packDir);
    const packOut = mustRun(npm, ["pack", "--json", "--pack-destination", packDir], ROOT);
    const packJson = packOut.slice(packOut.indexOf("["));
    const info = (JSON.parse(packJson) as Array<{ filename: string; size: number; unpackedSize: number; entryCount: number; files: Array<{ path: string; size: number }> }>)[0]!;
    const tarball = path.join(packDir, info.filename);
    ok(`npm pack: ${info.filename}, ${(info.size / 1024).toFixed(1)} kB packed, ${(info.unpackedSize / 1024).toFixed(1)} kB unpacked, ${info.entryCount} files`);
    for (const f of info.files) console.log(`        ${String(f.size).padStart(8)}  ${f.path}`);
    for (const need of ["dist/schem.js", "dist/fonts/DejaVuSans.ttf", "package.json"]) {
      if (!info.files.some((f) => f.path === need)) fail(`the tarball has no ${need}`);
    }
    if (info.files.some((f) => /^(src|tests|phase0|baselines|bench|scripts)\//.test(f.path))) fail("the tarball carries source or test folders");

    // Reference drawings from the repo's source.
    const refDir = path.join(work, "ref");
    referenceDrawings(refDir);

    // 2. Install into an empty project.
    const app = path.join(work, "app");
    mkdirSync(app);
    writeFileSync(path.join(app, "package.json"), `${JSON.stringify({ name: "smoke-app", private: true }, null, 2)}\n`);
    mustRun(npm, ["install", tarball, "--no-audit", "--no-fund", "--loglevel=error"], app);
    const installedPkg = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    if (Object.keys(installedPkg.dependencies ?? {}).join() !== "schem") fail(`the app has other dependencies: ${Object.keys(installedPkg.dependencies ?? {}).join(", ")}`);
    const bin = path.join(app, "node_modules", ".bin", WIN ? "schem.cmd" : "schem");
    if (!existsSync(bin)) fail(`npm install made no ${bin}`);
    ok("npm install <tarball> into an empty project: node_modules/.bin/schem exists");

    // 3. The installed command.
    const v = mustRun(bin, ["--version"], app).trim();
    if (v !== version) fail(`schem --version printed "${v}", expected "${version}"`);
    ok(`schem --version: ${v}`);
    checkDraws(bin, [], app, refDir, "installed");
    const repoRoot = path.join(work, "repo-mcp");
    mkdirSync(repoRoot);
    await checkMcp(bin, [], app, repoRoot, "installed");

    // 4. npx with the tarball in an empty folder (no package.json, no node_modules).
    const empty = path.join(work, "empty");
    mkdirSync(empty);
    const npxArgs = ["--yes", "--package", tarball, "--", "schem"];
    const nv = mustRun(npx, [...npxArgs, "--version"], empty).trim();
    if (nv !== version) fail(`npx schem --version printed "${nv}"`);
    ok(`npx --package <tarball> schem --version in an empty folder: ${nv}`);
    checkDraws(npx, npxArgs, empty, refDir, "npx");
    const repoRoot2 = path.join(work, "repo-mcp-2");
    mkdirSync(repoRoot2);
    await checkMcp(npx, npxArgs, empty, repoRoot2, "npx");

    // 5. Install from the clone, into a temporary global prefix.
    const prefix = path.join(work, "prefix");
    mkdirSync(prefix);
    mustRun(npm, ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", "--loglevel=error", ROOT], work);
    const globalBin = WIN ? path.join(prefix, "schem.cmd") : path.join(prefix, "bin", "schem");
    if (!existsSync(globalBin)) fail(`npm install -g from the clone made no ${globalBin}`);
    const clone = path.join(work, "clone");
    mkdirSync(clone);
    const gv = mustRun(globalBin, ["--version"], clone).trim();
    if (gv !== version) fail(`clone install: schem --version printed "${gv}"`);
    ok(`npm install -g . from the clone (temporary prefix): schem --version ${gv}`);
    checkDraws(globalBin, [], clone, refDir, "clone install (npm install -g .)");
    // The global package is a link to this repo: remove the link with npm before the temporary
    // folder is deleted, so the delete cannot reach the repo through it.
    mustRun(npm, ["uninstall", "--global", "--prefix", prefix, "--loglevel=error", "schem"], work);
    if (existsSync(globalBin)) fail(`npm uninstall -g left ${globalBin}`);

    console.log(`pack:smoke passed: ${info.filename}, ${(info.size / 1024).toFixed(1)} kB, ${info.entryCount} files`);
  } finally {
    if (keep) console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!existsSync(path.join(ROOT, "package.json"))) fail("the repo's package.json is gone after cleanup");
  }
}

await main();
