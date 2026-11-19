// The command line (SPEC 11.4): work with JSON netlists and text schematics.
//
//   npm run schem -- draw examples/led.schem.json
//   npm run schem -- edit examples/led.schem.json --ops ops.json
//
// `run` is exported so tests can call it without spawning a process; the bottom of this file
// calls it when the file is run directly. `draw` loads, lays out, checks and writes the drawing
// with the same calls as scripts/draw.ts, in the same order. `edit` applies an edit script through
// src/io/edit-script.ts and saves the project with its layout (src/io/layout-cache.ts), so the
// next draw or edit starts from the drawing the user has seen.

import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LayoutState } from "./core/intent.js";
import { revision } from "./edit/edit.js";
import { stabilityBreaks } from "./edit/report.js";
import { applyEditScript, parseEditScript } from "./io/edit-script.js";
import { jsonProblem, lineColumn } from "./io/json-problem.js";
import { fromLayoutCache } from "./io/layout-cache.js";
import type { LoadedProject, LoadResult } from "./io/project.js";
import { layout, type LayoutResult } from "./layout/layout.js";
import { checkDrawing } from "./quality/index.js";
import { toSvg } from "./render/svg.js";
import { toPng } from "./render/png.js";
import { executeCommand, type CommandResult } from "./mcp/commands.js";
import { commitProject, formatOf, issueText, loadWithin, projectText, readWithin } from "./mcp/project-files.js";
import { insideRoot, openRoots, resolvePath, showPath, type Roots } from "./mcp/roots.js";
import { replaceWithHistory, withLock, writeOutput, WriteConflict } from "./mcp/store.js";
import { MAX_FILE, guardProject } from "./mcp/sheet.js";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const USAGE = `schem - draw a circuit from JSON or text

Usage:
  npm run schem -- init [name]
  npm run schem -- render <file> -o <output.svg|png> [--scale N | --dpi N] [--draft] [--overwrite]
  npm run schem -- check <file> [--detail brief|normal|full] [--cursor N]
  npm run schem -- preview <file> -o <output.png> [--max N] [--focus R1,U2 | --finding ID]
  npm run schem -- query <file> part|net ID
  npm run schem -- describe <file> [--table]
  npm run schem -- components [query] [--limit 20]
  npm run schem -- fmt <file> [--to dsl|json]
  npm run schem -- undo <file>
  npm run schem -- draw <file> [-o <dir>]
  npm run schem -- edit <file> --ops <ops.json> [-o <dir>] [--strict] [--dry-run]
                   [--expect-revision <R>] [--expect-layout <L>] [--json]
  npm run schem -- --help
  npm run schem -- --version

File commands accept .schem text or .json. Use --json for machine output.

Example:
  npm run schem -- draw examples/led.schem.json

draw writes <dir>/<name>.svg and <dir>/<name>.png. <dir> defaults to out.

edit applies the operations in <ops.json> as one change, keeps the rest of the
drawing where it was, saves the file (the old one goes to .schem-history/) and
writes the drawing like draw. An edit that would move untouched parts more than
the limit is saved with a warning; --strict refuses it instead. --dry-run writes
nothing. Exit codes: 0 valid, 1 invalid or input error, 2 usage, 3 internal
error, 4 conflict. The legacy plain-text JSON draw and edit forms report
unreadable input as 2.

The circuit file formats are described in docs/dsl.md and docs/netlist-format.md, and edit
operations in docs/editing.md.`;

/** A file's base name without `.schem.json` or `.json`. */
function drawingName(file: string): string {
  const base = basename(file);
  const suffix = base.endsWith(".schem.json") ? ".schem.json" : extname(base);
  return base.slice(0, base.length - suffix.length) || "drawing";
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

function rootsFor(file?: string): Roots {
  const cwd = process.cwd(), root = openRoots([cwd]);
  if (!file || insideRoot(cwd, resolve(file))) return root;
  const parent = existingParent(dirname(resolve(file)));
  return existsSync(parent) ? openRoots([cwd, parent]) : root;
}

function existingParent(dir: string): string {
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

// The legacy -o directory option explicitly configures an additional export root.
function withLegacyOutput(roots: Roots, dir: string): Roots {
  const absolute = resolve(dir);
  if (roots.real.some((root) => insideRoot(root, absolute))) return roots;
  const output = openRoots([existingParent(absolute)]);
  return { real: [...roots.real, ...output.real] };
}

// ---------------------------------------------------------------------------

function issueLine(prefix: string, message: string): string {
  return `  ${prefix}: ${message}`;
}

function printLoadErrors(result: LoadResult, io: Io): void {
  for (const e of result.errors) io.err(issueLine("error", "span" in e ? issueText(e) : e.message));
  for (const w of result.warnings) io.err(issueLine("warning", "span" in w ? issueText(w) : w.message));
  if (result.missingTypes.length > 0) {
    io.err(`  Known part types and their pins are listed in docs/parts.md.`);
  }
}

/** Read and load a project file, printing why it cannot be used. */
function readProjectFile(file: string, verb: string, roots: Roots, io: Io): LoadedProject | undefined {
  const opened = readWithin(roots, file);
  if (!opened.ok) {
    io.err(`Cannot read ${showPath(file)}. ${opened.message}`);
    return undefined;
  }

  // JSON.parse is the authority; the scanner only supplies a friendlier position when it fails.
  const format = formatOf(file), text = opened.text.replace(/^\uFEFF/, "");
  if (format === "json") {
    try { JSON.parse(text); }
    catch {
      const problem = jsonProblem(text);
      if (problem) {
        const { line, column } = lineColumn(text, problem.index);
        io.err(`Cannot read ${showPath(file)}: bad JSON at line ${line}, column ${column}: ${problem.message}`);
      } else {
        io.err(`Cannot read ${showPath(file)}: the file is not valid JSON.`);
      }
      return undefined;
    }
  }

  const loaded = projectText(text, format);
  if (!loaded.ok || loaded.project === undefined) {
    io.err(`Cannot ${verb} ${showPath(file)}:`);
    printLoadErrors(loaded, io);
    return undefined;
  }
  const guards = guardProject(loaded.project);
  if (guards.length) { for (const guard of guards) io.err(guard); return undefined; }
  for (const w of loaded.warnings) io.err(issueLine("warning", "span" in w ? issueText(w) : w.message));
  return loaded.project;
}

function openProjectForCli(file: string, verb: string, json: boolean, io: Io):
  { ok: true; project: LoadedProject; real: string; roots: Roots } | { ok: false; code: number } {
  const roots = rootsFor(file);
  if (json) {
    const input = loadWithin(roots, file);
    if (!input.ok) return { ok: false, code: emit({ isError: true, body: { error: input.message, issues: input.issues } }, true, io) };
    return { ...input, roots };
  }
  const project = readProjectFile(file, verb, roots, io);
  if (!project) return { ok: false, code: formatOf(file) === "dsl" ? 1 : 2 };
  return { ok: true, project, real: realpathSync(file), roots };
}

function legacyFailure(json: boolean, file: string, message: string, io: Io): number {
  if (json) return emit({ isError: true, body: { error: message } }, true, io);
  io.err(message);
  return formatOf(file) === "dsl" ? 1 : 2;
}

/** The layout a file was saved with (written by edit), if it still matches the file. */
function savedLayout(project: LoadedProject, io: Io): LayoutState | undefined {
  const saved = fromLayoutCache(project.layoutCache, revision(project));
  if (saved.note) io.err(issueLine("note", saved.note));
  return saved.state;
}

/** Write the SVG and PNG of a laid-out drawing; returns their paths, or undefined after saying why not. */
function writeDrawing(result: LayoutResult, dir: string, name: string, file: string, roots: Roots, io: Io): { svgPath: string; pngPath: string } | undefined {
  const svg = toSvg(result.render!);
  const png = toPng(svg);
  const svgPath = join(dir, `${name}.svg`);
  const pngPath = join(dir, `${name}.png`);
  try {
    const parent = realpathSync(existingParent(resolve(dir)));
    if (!roots.real.some((root) => insideRoot(root, parent))) throw new Error("The output folder is outside the configured roots.");
    mkdirSync(dir, { recursive: true });
    writeOutput(roots, svgPath, file, svg, true);
    writeOutput(roots, pngPath, file, png, true);
  } catch (e) {
    io.err(`Cannot write to ${showPath(dir)}: ${(e as Error).message}`);
    return undefined;
  }
  return { svgPath, pngPath };
}

function draw(file: string | undefined, dir: string, json: boolean, io: Io): number {
  if (file === undefined) {
    return usageError("draw: no file given.", json, io);
  }
  const input = openProjectForCli(file, "draw", json, io);
  if (!input.ok) return input.code;
  const { project, roots, real } = input;

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
    if (json) return emit({ isError: true, body: { error: "The circuit could not be drawn.", status: result.status, issues: result.issues } }, true, io);
    io.err(`${name}: could not draw it (${result.status}).`);
    for (const issue of result.issues) io.err(issueLine("issue", issue));
    for (const note of result.notes) io.err(issueLine("note", note));
    return formatOf(file) === "dsl" ? 1 : 2;
  }

  const quality = checkDrawing(project.circuit, result.pinDefs, result.render);
  const written = writeDrawing(result, dir, name, real, withLegacyOutput(roots, dir), io);
  if (written === undefined) return json ? emit({ isError: true, body: { error: "Could not write the drawings." } }, true, io) : 2;
  const ms = performance.now() - started;

  const valid = quality.valid && result.status === "valid";
  if (json) return emit({ isError: !valid, body: { status: result.status, verified: quality.valid, svg: showPath(written.svgPath), png: showPath(written.pngPath), metrics: quality.metrics } }, true, io);
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

function edit(a: Args, io: Io): number {
  if (a.file === undefined) {
    return usageError("edit: no file given.", a.json, io);
  }
  if (a.ops === undefined) {
    return usageError("edit: no operations given. Add --ops <ops.json>.", a.json, io);
  }
  const roots = rootsFor(a.file), target = resolvePath(roots, a.file, "overwrite");
  if (!target.ok) return legacyFailure(a.json, a.file, target.message, io);
  try {
    return withLock(target.real, () => editLocked({ ...a, file: a.file!, ops: a.ops! }, target.real, roots, io));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof WriteConflict)
      return emit({ isError: true, body: { status: "conflict", error: message } }, a.json, io);
    return legacyFailure(a.json, a.file, message, io);
  }
}

function editLocked(a: Args & { file: string; ops: string }, real: string, roots: Roots, io: Io): number {
  const input = openProjectForCli(a.file, "edit", a.json, io);
  if (!input.ok) return input.code;
  const { project } = input;
  const ops = readWithin(roots, a.ops);
  if (!ops.ok) return legacyFailure(a.json, a.file, ops.message, io);
  const opsText = ops.text;
  const parsed = parseEditScript(opsText);
  if (!parsed.ok) {
    if (a.json) return emit({ isError: true, body: { error: "Invalid edit operations.", issues: parsed.issues } }, true, io);
    io.err(`Cannot use ${showPath(a.ops)}:`);
    for (const i of parsed.issues) io.err(issueLine("error", `${i.code} ${i.message}`));
    return formatOf(a.file) === "dsl" ? 1 : 2;
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

  const { text, revision: basis, layoutToken: token } = commitProject(run.project, r.layout.state, r.mode ?? "canonical", formatOf(a.file));
  if (Buffer.byteLength(text) > MAX_FILE) return legacyFailure(a.json, a.file, "The saved project would be over 2 MB.", io);
  let written: { svgPath: string; pngPath: string } | undefined;
  if (!a.dryRun) {
    replaceWithHistory(real, text);
    written = writeDrawing(r.layout, a.dir, name, real, withLegacyOutput(roots, a.dir), io);
    if (written === undefined) {
      const error = "The edit was saved, but the drawing export failed.";
      if (a.json) return emit({ isError: true, body: { error, saved: true, revision: basis, layoutToken: token } }, true, io);
      io.err(error);
      return 1;
    }
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


const SHARED = {
  init: { values: [], flags: [] },
  check: { values: ["detail", "cursor"], flags: [] },
  render: { values: ["out", "scale", "dpi"], flags: ["draft", "overwrite"] },
  preview: { values: ["out", "max", "focus", "finding"], flags: [] },
  query: { values: [], flags: [] },
  undo: { values: [], flags: [] },
  fmt: { values: ["to"], flags: [] },
  describe: { values: [], flags: ["table"] },
  components: { values: ["limit", "cursor"], flags: [] },
} satisfies Record<string, { values: string[]; flags: string[] }>;

const STARTER = [
  'circuit "LED indicator"',
  "part B1 battery 9V",
  "part R1 resistor 470",
  "part D1 led color=red",
  "net PWR = B1[+] R1[1]",
  "connect R1[2] D1[A]",
  "net GND = D1[K] B1[-]",
  "",
].join("\n");

type SharedVerb = keyof typeof SHARED;

function usageError(message: string, json: boolean, io: Io): number {
  if (json) io.out(JSON.stringify({ error: message, status: "usage" }, null, 2));
  else { io.err(message); io.err(USAGE); }
  return 2;
}

function shared(verb: SharedVerb, argv: string[], io: Io): number {
  const json = argv.includes("--json");
  const spec: { values: readonly string[]; flags: readonly string[] } = SHARED[verb];
  const positional: string[] = [], options = new Map<string, string | true>();
  const usage = (message: string) => usageError(message, json, io);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") continue;
    if (!arg.startsWith("-")) { positional.push(arg); continue; }
    const opt = arg === "-o" ? "out" : arg.startsWith("--") ? arg.slice(2) : "";
    if (options.has(opt)) return usage(`Option "${arg}" is already set.`);
    if (spec.flags.includes(opt)) options.set(opt, true);
    else if (spec.values.includes(opt)) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--") || value === "-o") return usage(`${arg} needs a value.`);
      options.set(opt, value);
      i++;
    } else return usage(`Unknown option "${arg}".`);
  }

  const [file, subject, id] = positional;
  const noFile = verb === "components" || verb === "init";
  const count = verb === "query" ? 3 : 1;
  if (positional.length > count || (!noFile && positional.length !== count))
    return usage(verb === "query" ? "query needs a file, part or net, and an id." : `Check the arguments for ${verb}.`);
  const args: Record<string, unknown> = Object.fromEntries(options);
  if (verb === "components") args.query = file;
  else if (verb === "init") {
    const name = file ?? "circuit";
    args.path = /\.(?:schem|json)$/i.test(name) ? name : `${name}.schem`;
    args.source = STARTER;
  } else args.path = file;

  if (verb === "query") {
    if (subject !== "part" && subject !== "net") return usage("query needs part or net.");
    args[subject] = id;
  }
  if (verb === "preview" || verb === "render") {
    const out = options.get("out");
    if (typeof out !== "string") return usage(`${verb} needs -o and an output file.`);
    const format = extname(out).slice(1).toLowerCase();
    if (verb === "preview" && format !== "png") return usage("preview needs a .png output.");
    if (verb === "render" && format !== "svg" && format !== "png") return usage("render needs a .svg or .png output.");
    args.format = format;
  }
  if (verb === "render") {
    if (options.has("scale") && options.has("dpi")) return usage("Give --scale or --dpi.");
    if (args.format === "svg" && (options.has("scale") || options.has("dpi"))) return usage("--scale and --dpi are for PNG.");
    args.requireValid = !options.has("draft");
  }
  if (verb === "preview" && options.has("finding") && options.has("focus")) return usage("Give --focus or --finding.");
  if (verb === "fmt" && args.to !== undefined && args.to !== "dsl" && args.to !== "json") return usage("--to is dsl or json.");
  if (verb === "check" && args.detail !== undefined && !["brief", "normal", "full"].includes(String(args.detail)))
    return usage("--detail is brief, normal or full.");
  if (verb === "check" && args.detail === undefined) args.detail = "full";
  for (const [flag, key] of [["scale", "scale"], ["dpi", "dpi"], ["max", "maxSize"], ["limit", "limit"]] as const) {
    const value = options.get(flag);
    if (value === undefined) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || (flag === "limit" && !Number.isSafeInteger(number)))
      return usage(`--${flag} needs a positive ${flag === "limit" ? "integer" : "number"}.`);
    args[key] = number;
  }
  const roots = rootsFor(typeof args.path === "string" ? args.path : undefined);
  const name = verb === "init" ? "schem_create" : `schem_${verb}`;
  return emit(executeCommand(roots, name, args), json, io);
}

function emit(result: CommandResult, json: boolean, io: Io): number {
  const { body } = result;
  if (json) io.out(JSON.stringify(body, null, 2));
  else if (result.isError) io.err(String(body.error ?? body.status ?? "The command failed."));
  else if (typeof body.description === "string") {
    io.out(body.description);
    if (Array.isArray(body.table)) {
      io.out("\nNet | Presentation | Pins\n--- | --- | ---");
      for (const row of body.table) io.out(`${row.name} | ${row.presentation} | ${row.pins.join(", ")}`);
    }
  } else if (typeof body.out === "string") io.out(`Wrote ${body.out}.`);
  else if (Array.isArray(body.components)) {
    for (const entry of body.components) io.out(`${entry.id}  ${entry.pins.map((pin: { name: string }) => pin.name).join(", ")}`.trimEnd());
  } else if (body.part || body.net) io.out(JSON.stringify(body.part ?? body.net, null, 2));
  else {
    io.out([body.path, body.status].filter(Boolean).join("  "));
    if (body.metrics) io.out(JSON.stringify(body.metrics));
    if (Array.isArray(body.findings)) for (const finding of body.findings) io.out(`${finding.id}  ${finding.message}`);
    if (Array.isArray(body.warnings)) for (const warning of body.warnings) io.out(`Warning: ${warning}`);
  }
  if (body.status === "conflict") return 4;
  return result.isError || (typeof body.status === "string" && body.status !== "valid") || body.verified === false ? 1 : 0;
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
  if (Object.hasOwn(SHARED, command)) return shared(command as SharedVerb, rest, io);
  if (command !== "draw" && command !== "edit") {
    return usageError(`Unknown command "${command}".`, rest.includes("--json"), io);
  }

  const a: Args = { dir: "out", strict: false, dryRun: false, json: rest.includes("--json") };
  // Options that take a value, and flags, per command.
  const valued: Record<string, (v: string) => void> = { "-o": (v) => (a.dir = v), "--out": (v) => (a.dir = v) };
  const flags: Record<string, () => void> = { "--json": () => (a.json = true) };
  if (command === "edit") {
    valued["--ops"] = (v) => (a.ops = v);
    valued["--expect-revision"] = (v) => (a.expectRevision = v);
    valued["--expect-layout"] = (v) => (a.expectLayout = v);
    flags["--strict"] = () => (a.strict = true);
    flags["--dry-run"] = () => (a.dryRun = true);
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (valued[arg]) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--"))
        return usageError(`${arg}: no ${arg === "-o" || arg === "--out" ? "folder" : "value"} given.`, a.json, io);
      valued[arg]!(next);
      i++;
    } else if (flags[arg]) {
      flags[arg]!();
    } else if (arg.startsWith("-") && arg !== "-") {
      return usageError(`Unknown option "${arg}".`, a.json, io);
    } else if (a.file === undefined) {
      a.file = arg;
    } else {
      return usageError(`${command}: more than one file given ("${a.file}" and "${arg}").`, a.json, io);
    }
  }
  return command === "draw" ? draw(a.file, a.dir, a.json, io) : edit(a, io);
}

/** Run the CLI with arguments and output sinks; returns the process exit code. */
export function run(argv: string[], io: Io): number {
  try {
    return dispatch(argv, io);
  } catch (e) {
    if (argv.includes("--json")) io.out(JSON.stringify({ status: "internal_error", error: e instanceof Error ? e.message : String(e) }));
    else io.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 3;
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
