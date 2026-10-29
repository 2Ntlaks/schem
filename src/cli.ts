// The command line (SPEC 11.4): draw a circuit file, and edit it without reshuffling the drawing.
//
//   npm run schem -- draw examples/led.schem.json
//   npm run schem -- edit examples/led.schem.json --ops ops.json
//
// `run` is exported so tests can call it without spawning a process; the bottom of this file
// calls it when the file is run directly. `draw` loads, lays out, checks and writes the drawing
// with the same calls as scripts/draw.ts, in the same order. `edit` applies an edit script through
// src/io/edit-script.ts and saves the project with its layout (src/io/layout-cache.ts), so the
// next draw or edit starts from the drawing the user has seen.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LayoutState } from "./core/intent.js";
import { layoutToken, revision } from "./edit/edit.js";
import { stabilityBreaks } from "./edit/report.js";
import { applyEditScript, parseEditScript } from "./io/edit-script.js";
import { jsonProblem, lineColumn } from "./io/json-problem.js";
import { fromLayoutCache, toLayoutCache } from "./io/layout-cache.js";
import { loadProject, saveProject, type LoadedProject, type LoadResult } from "./io/project.js";
import { layout, type LayoutResult } from "./layout/layout.js";
import { checkDrawing } from "./quality/index.js";
import { toSvg } from "./render/svg.js";
import { toPng } from "./render/png.js";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const USAGE = `schem - draw a circuit from a JSON netlist

Usage:
  npm run schem -- draw <file> [-o <dir>]
  npm run schem -- edit <file> --ops <ops.json> [-o <dir>] [--strict] [--dry-run]
                   [--expect-revision <R>] [--expect-layout <L>] [--json]
  npm run schem -- --help
  npm run schem -- --version

Example:
  npm run schem -- draw examples/led.schem.json

draw writes <dir>/<name>.svg and <dir>/<name>.png. <dir> defaults to out.

edit applies the operations in <ops.json> as one change, keeps the rest of the
drawing where it was, saves the file (the old one goes to .schem-history/) and
writes the drawing like draw. An edit that would move untouched parts more than
the limit is saved with a warning; --strict refuses it instead. --dry-run writes
nothing. Exit codes: 0 saved, 1 refused (nothing written), 2 cannot read the
input, 4 the file changed since the expected revision or layout.

The circuit file format is described in docs/netlist-format.md, and edit
operations in docs/editing.md.`;

/** A file's base name without `.schem.json` or `.json`. */
function drawingName(file: string): string {
  const base = basename(file);
  const suffix = base.endsWith(".schem.json") ? ".schem.json" : extname(base);
  return base.slice(0, base.length - suffix.length) || "drawing";
}

/** Path for messages: forward slashes, so the output looks the same on Windows and Unix. */
function showPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

// ---------------------------------------------------------------------------

function issueLine(prefix: string, message: string): string {
  return `  ${prefix}: ${message}`;
}

function printLoadErrors(result: LoadResult, io: Io): void {
  for (const e of result.errors) io.err(issueLine("error", e.message));
  for (const w of result.warnings) io.err(issueLine("warning", w.message));
  if (result.missingTypes.length > 0) {
    io.err(`  Known part types and their pins are listed in docs/parts.md.`);
  }
}

/** Read and load a project file, printing why it cannot be used. */
function readProjectFile(file: string, verb: string, io: Io): LoadedProject | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") io.err(`Cannot read ${showPath(file)}: no such file`);
    else if (code === "EISDIR") io.err(`Cannot read ${showPath(file)}: it is a directory, not a file.`);
    else if (code === "EACCES" || code === "EPERM") io.err(`Cannot read ${showPath(file)}: permission denied.`);
    else io.err(`Cannot read ${showPath(file)}: ${(e as Error).message}`);
    return undefined;
  }

  // JSON.parse is the authority; the scanner only supplies a friendlier position when it fails.
  try {
    JSON.parse(text);
  } catch {
    const problem = jsonProblem(text);
    if (problem) {
      const { line, column } = lineColumn(text, problem.index);
      io.err(`Cannot read ${showPath(file)}: bad JSON at line ${line}, column ${column}: ${problem.message}`);
    } else {
      io.err(`Cannot read ${showPath(file)}: the file is not valid JSON.`);
    }
    return undefined;
  }

  const loaded = loadProject(text);
  if (!loaded.ok || loaded.project === undefined) {
    io.err(`Cannot ${verb} ${showPath(file)}:`);
    printLoadErrors(loaded, io);
    return undefined;
  }
  for (const w of loaded.warnings) io.err(issueLine("warning", w.message));
  return loaded.project;
}

/** The layout a file was saved with (written by edit), if it still matches the file. */
function savedLayout(project: LoadedProject, io: Io): LayoutState | undefined {
  const saved = fromLayoutCache(project.layoutCache, revision(project));
  if (saved.note) io.err(issueLine("note", saved.note));
  return saved.state;
}

/** Write the SVG and PNG of a laid-out drawing; returns their paths, or undefined after saying why not. */
function writeDrawing(result: LayoutResult, dir: string, name: string, io: Io): { svgPath: string; pngPath: string } | undefined {
  const svg = toSvg(result.render!);
  const png = toPng(svg);
  const svgPath = join(dir, `${name}.svg`);
  const pngPath = join(dir, `${name}.png`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(svgPath, svg);
    writeFileSync(pngPath, png);
  } catch (e) {
    io.err(`Cannot write to ${showPath(dir)}: ${(e as Error).message}`);
    return undefined;
  }
  return { svgPath, pngPath };
}

function draw(file: string | undefined, dir: string, io: Io): number {
  if (file === undefined) {
    io.err("draw: no file given.");
    io.err(USAGE);
    return 2;
  }
  const project = readProjectFile(file, "draw", io);
  if (project === undefined) return 2;

  const name = drawingName(file);
  const started = performance.now();
  // A file saved by edit is drawn as it was saved: an incremental layout with nothing changed
  // gives back the same drawing.
  const previous = savedLayout(project, io);
  let result = previous ? layout(project, { previous, affected: [] }) : layout(project);
  if (previous && (result.render === undefined || result.status !== "valid")) {
    io.err(issueLine("note", "the saved layout no longer draws cleanly with this version of schem, so it is drawn afresh."));
    result = layout(project);
  }
  if (result.render === undefined) {
    io.err(`${name}: could not draw it (${result.status}).`);
    for (const issue of result.issues) io.err(issueLine("issue", issue));
    for (const note of result.notes) io.err(issueLine("note", note));
    return 2;
  }

  const quality = checkDrawing(project.circuit, result.pinDefs, result.render);
  const written = writeDrawing(result, dir, name, io);
  if (written === undefined) return 2;
  const ms = performance.now() - started;

  const valid = quality.valid && result.status === "valid";
  io.out(
    `${name}: ${valid ? "valid" : "NOT valid"}. Wrote ${showPath(written.svgPath)} and ${showPath(written.pngPath)} (${Math.round(ms)} ms)`,
  );
  if (!valid) {
    for (const e of quality.connections.errors) io.out(issueLine("verifier", `${e.code} ${e.message}`));
    for (const o of quality.overlaps) io.out(issueLine("overlap", `${o.code} ${o.message}`));
    for (const issue of result.issues) io.out(issueLine("issue", issue));
    if (result.status !== "valid") io.out(issueLine("layout", result.status));
  }
  return valid ? 0 : 1;
}

// ---------------------------------------------------------------------------
// edit (SPEC 11.3, 11.4)

interface Args {
  file?: string;
  dir: string;
  ops?: string;
  strict: boolean;
  dryRun: boolean;
  json: boolean;
  expectRevision?: string;
  expectLayout?: string;
}

/** Older copies kept per file in .schem-history/ next to it (SPEC 11.3). */
const HISTORY = 20;

/** Copy the file to .schem-history/<file name>/<n>.schem.json, keeping the newest HISTORY copies. */
function snapshot(file: string): void {
  const dir = join(dirname(file), ".schem-history", basename(file));
  mkdirSync(dir, { recursive: true });
  const numbers = readdirSync(dir)
    .map((f) => /^(\d+)\.schem\.json$/.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  copyFileSync(file, join(dir, `${(numbers.at(-1) ?? 0) + 1}.schem.json`));
  for (const n of numbers.slice(0, Math.max(0, numbers.length + 1 - HISTORY))) rmSync(join(dir, `${n}.schem.json`));
}

/**
 * Replace a file through a temporary file and a rename, so it is never left half-written (SPEC
 * 11.2). A rename blocked for a moment by another program (OneDrive, an editor, antivirus) is
 * retried a few times.
 */
function replaceFile(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
    }
  }
}

function edit(a: Args, io: Io): number {
  if (a.file === undefined) {
    io.err("edit: no file given.");
    io.err(USAGE);
    return 2;
  }
  if (a.ops === undefined) {
    io.err("edit: no operations given. Add --ops <ops.json>; docs/editing.md describes the operations.");
    return 2;
  }
  const project = readProjectFile(a.file, "edit", io);
  if (project === undefined) return 2;

  let opsText: string;
  try {
    opsText = readFileSync(a.ops, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    io.err(`Cannot read ${showPath(a.ops)}: ${code === "ENOENT" ? "no such file" : (e as Error).message}`);
    return 2;
  }
  const parsed = parseEditScript(opsText);
  if (!parsed.ok) {
    io.err(`Cannot use ${showPath(a.ops)}:`);
    for (const i of parsed.issues) io.err(issueLine("error", `${i.code} ${i.message}`));
    return 2;
  }
  const script = { ...parsed.script };
  if (a.expectRevision !== undefined) script.expectedRevision = a.expectRevision;
  if (a.expectLayout !== undefined) script.expectedLayout = a.expectLayout;

  const name = drawingName(a.file);
  const started = performance.now();
  // The drawing an edit keeps is the one draw shows for this file: its saved layout, or else the
  // layout made from scratch.
  const previous = savedLayout(project, io) ?? layout(project).state;
  const run = applyEditScript(project, script, previous, { strict: a.strict });
  const r = run.result;
  const breaks = r.report && r.mode !== "canonical" ? stabilityBreaks(r.report) : [];

  if (run.project === undefined || r.layout?.state === undefined || r.layout.render === undefined) {
    const code = r.status === "conflict" ? 4 : 1;
    const unstable = r.status === "unstable" && r.report ? stabilityBreaks(r.report) : [];
    if (a.json) {
      io.out(JSON.stringify({
        file: showPath(a.file), saved: false, status: r.status, issues: r.issues,
        ...(unstable.length ? { stability: unstable } : {}),
        revision: r.revision, ...(r.layoutToken ? { layoutToken: r.layoutToken } : {}),
      }, null, 2));
      return code;
    }
    io.out(`${name}: edit refused (${r.status}). Nothing was written.`);
    if (unstable.length) {
      for (const b of unstable) io.out(issueLine("would move", b));
      io.out(issueLine("hint", 'without --strict it is saved with this report; or add { "op": "relayout", "mode": "canonical" } to redraw the whole sheet.'));
    } else {
      for (const i of r.issues) io.out(issueLine("issue", i));
    }
    return code;
  }

  // The saved layout's basis is the revision of the file as it will be read back.
  const { layoutCache: _old, ...edited } = run.project;
  const reloaded = loadProject(saveProject(edited)).project!;
  const basis = revision(reloaded);
  const cache = toLayoutCache(r.layout.state, basis, r.mode ?? "canonical");
  const text = saveProject({ ...edited, layoutCache: cache });
  const token = layoutToken(reloaded, fromLayoutCache(cache, basis).state!);

  let written: { svgPath: string; pngPath: string } | undefined;
  if (!a.dryRun) {
    try {
      snapshot(a.file);
      replaceFile(a.file, text);
    } catch (e) {
      io.err(`Cannot save ${showPath(a.file)}: ${(e as Error).message}`);
      return 2;
    }
    written = writeDrawing(r.layout, a.dir, name, io);
    if (written === undefined) return 2;
  }
  const ms = performance.now() - started;

  const rep = r.report;
  if (a.json) {
    io.out(JSON.stringify({
      file: showPath(a.file), saved: !a.dryRun, status: r.status, mode: r.mode,
      affected: r.affected, removedHints: run.removedHints,
      ...(rep && r.mode !== "canonical" ? { stable: breaks.length === 0, stability: breaks, untouched: rep.untouched, otherNetsRerouted: rep.routesChanged.other } : {}),
      revision: basis, layoutToken: token,
      ...(written ? { svg: showPath(written.svgPath), png: showPath(written.pngPath) } : {}),
    }, null, 2));
    return 0;
  }
  const files = written ? `Wrote ${showPath(a.file)}, ${showPath(written.svgPath)} and ${showPath(written.pngPath)}` : "Dry run, nothing written";
  const how = r.mode === "canonical" ? "whole sheet redrawn" : "drawing kept";
  io.out(`${name}: edit ${a.dryRun ? "checked" : "saved"} (${how}). ${files} (${Math.round(ms)} ms)`);
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  io.out(issueLine("changed", `parts ${list(r.affected.parts)}; nets ${list(r.affected.nets)}`));
  if (run.removedHints.length) io.out(issueLine("removed hints", run.removedHints.join(", ")));
  if (rep && r.mode !== "canonical") {
    io.out(issueLine("untouched", `${rep.untouched.count} parts moved ${rep.untouched.meanMove} G on average and ${rep.untouched.maxMove} G at most; other nets rerouted: ${list(rep.routesChanged.other)}`));
  }
  if (breaks.length) {
    io.out(issueLine("warning", `this edit moves untouched parts more than the limit (${breaks.join("; ")}). It is saved anyway; --strict refuses such edits.`));
  }
  if (r.mode === "canonical" && previous && !script.ops.some((o) => o.op === "setSpacing" || (o.op === "relayout" && o.mode === "canonical"))) {
    io.out(issueLine("note", "no layout could keep the drawing, so the whole sheet was redrawn."));
  }
  io.out(issueLine("revision", basis));
  io.out(issueLine("layout", token));
  return 0;
}

function dispatch(argv: string[], io: Io): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    io.out(packageVersion());
    return 0;
  }
  if (command !== "draw" && command !== "edit") {
    io.err(`Unknown command "${command}".`);
    io.err(USAGE);
    return 2;
  }

  const a: Args = { dir: "out", strict: false, dryRun: false, json: false };
  // Options that take a value, and flags, per command.
  const valued: Record<string, (v: string) => void> = { "-o": (v) => (a.dir = v), "--out": (v) => (a.dir = v) };
  const flags: Record<string, () => void> = {};
  if (command === "edit") {
    valued["--ops"] = (v) => (a.ops = v);
    valued["--expect-revision"] = (v) => (a.expectRevision = v);
    valued["--expect-layout"] = (v) => (a.expectLayout = v);
    flags["--strict"] = () => (a.strict = true);
    flags["--dry-run"] = () => (a.dryRun = true);
    flags["--json"] = () => (a.json = true);
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (valued[arg]) {
      const next = rest[i + 1];
      if (next === undefined) {
        io.err(`${arg}: no ${arg === "-o" || arg === "--out" ? "folder" : "value"} given.`);
        return 2;
      }
      valued[arg]!(next);
      i++;
    } else if (flags[arg]) {
      flags[arg]!();
    } else if (arg.startsWith("-") && arg !== "-") {
      io.err(`Unknown option "${arg}".`);
      io.err(USAGE);
      return 2;
    } else if (a.file === undefined) {
      a.file = arg;
    } else {
      io.err(`${command}: more than one file given ("${a.file}" and "${arg}").`);
      return 2;
    }
  }
  return command === "draw" ? draw(a.file, a.dir, io) : edit(a, io);
}

/** Run the CLI with arguments and output sinks; returns the process exit code. */
export function run(argv: string[], io: Io): number {
  try {
    return dispatch(argv, io);
  } catch (e) {
    io.err("Internal error, please report it:");
    io.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 2;
  }
}

function isEntryPoint(): boolean {
  const arg = process.argv[1];
  if (arg === undefined) return false;
  return resolve(fileURLToPath(import.meta.url)) === resolve(arg);
}

if (isEntryPoint()) {
  process.exitCode = run(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  });
}
