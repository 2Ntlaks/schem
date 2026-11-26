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

import { existsSync, mkdirSync, readFileSync, realpathSync, watch as fsWatch } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitTemplate, INIT_TEMPLATE_NAMES } from "./cli-templates.js";
import {
  closest, colorWanted, COMMAND_NAMES, commandHelp, createStyle, fitList, mainHelp, num, pairs, plural, point, bytes, table, usageLine,
  type Style,
} from "./cli-ui.js";
import type { LayoutState } from "./core/intent.js";
import { revision } from "./edit/edit.js";
import { stabilityBreaks } from "./edit/report.js";
import { applyEditScript, parseEditScript } from "./io/edit-script.js";
import { jsonProblem, lineColumn } from "./io/json-problem.js";
import { fromLayoutCache } from "./io/layout-cache.js";
import type { LoadedProject, LoadResult } from "./io/project.js";
import { importSpice } from "./io/spice.js";
import { layout, type LayoutResult } from "./layout/layout.js";
import { checkDrawing } from "./quality/index.js";
import { toSvg, type SvgOptions } from "./render/svg.js";
import { toPng } from "./render/png.js";
import { resolveTheme } from "./render/themes.js";
import { executeCommand, type CommandResult } from "./mcp/commands.js";
import { commitProject, formatOf, issueText, loadWithin, projectText, readWithin } from "./mcp/project-files.js";
import { main as mcpMain } from "./mcp/main.js";
import { insideRoot, openRoots, resolvePath, showPath, type Roots } from "./mcp/roots.js";
import { HELP as MCP_HELP } from "./mcp/server.js";
import { replaceWithHistory, withLock, writeOutput, WriteConflict } from "./mcp/store.js";
import { MAX_FILE, guardProject } from "./mcp/sheet.js";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Style text written to `out` with ANSI codes. Off unless set; src/bin.ts sets it for a terminal. */
  color?: boolean;
  /** Style text written to `err`. Defaults to `color`. */
  errColor?: boolean;
  /** Terminal width used to fit long lists. Defaults to 80. */
  columns?: number;
}

/** Styles for text written to `out`. */
function outStyle(io: Io): Style {
  return createStyle(io.color === true);
}

/** Styles for text written to `err`. */
function errStyle(io: Io): Style {
  return createStyle((io.errColor ?? io.color) === true);
}

/** A path for people: relative to the current folder when inside it, else as given. */
function displayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? showPath(rel) : showPath(p);
}

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

const ISSUE_PAINT: Record<string, keyof Omit<Style, "on">> = {
  error: "red", verifier: "red", overlap: "red", issue: "red", layout: "dim",
  warning: "yellow", "would move": "yellow",
  note: "cyan", hint: "cyan",
};

/** "  prefix: message", with the prefix coloured by kind when `style` is on. */
function issueLine(prefix: string, message: string, style?: Style): string {
  const paint = style?.on ? style[ISSUE_PAINT[prefix] ?? "dim"] : (t: string) => t;
  return `  ${paint(prefix)}: ${message}`;
}

function printLoadErrors(result: LoadResult, io: Io): void {
  for (const e of result.errors) io.err(issueLine("error", "span" in e ? issueText(e) : e.message, errStyle(io)));
  for (const w of result.warnings) io.err(issueLine("warning", "span" in w ? issueText(w) : w.message, errStyle(io)));
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
  for (const w of loaded.warnings) io.err(issueLine("warning", "span" in w ? issueText(w) : w.message, errStyle(io)));
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
  if (saved.note) io.err(issueLine("note", saved.note, errStyle(io)));
  return saved.state;
}

/** Write the SVG and PNG of a laid-out drawing; returns their paths, or undefined after saying why not. */
function writeDrawing(result: LayoutResult, dir: string, name: string, file: string, roots: Roots, io: Io, svgOpts?: SvgOptions): { svgPath: string; pngPath: string } | undefined {
  const svg = toSvg(result.render!, svgOpts);
  const png = svgOpts?.transparent ? toPng(svg, 10, { transparent: true }) : toPng(svg);
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

function draw(file: string | undefined, dir: string, json: boolean, io: Io, svgOpts?: SvgOptions): number {
  if (file === undefined) {
    return usageError("draw: no file given.", json, io, "draw");
  }
  if (svgOpts?.theme !== undefined) {
    try { resolveTheme(svgOpts.theme); }
    catch (e) { return usageError((e as Error).message, json, io, "draw"); }
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
    io.err(issueLine("note", "the saved layout no longer draws cleanly with this version of schem, so it is drawn afresh.", errStyle(io)));
    result = layout(project);
  }
  if (result.render === undefined) {
    if (json) return emit({ isError: true, body: { error: "The circuit could not be drawn.", status: result.status, issues: result.issues } }, true, io);
    io.err(`${name}: ${errStyle(io).red("could not draw it")} (${result.status}).`);
    for (const issue of result.issues) io.err(issueLine("issue", issue, errStyle(io)));
    for (const note of result.notes) io.err(issueLine("note", note, errStyle(io)));
    return formatOf(file) === "dsl" ? 1 : 2;
  }

  const quality = checkDrawing(project.circuit, result.pinDefs, result.render);
  const written = writeDrawing(result, dir, name, real, withLegacyOutput(roots, dir), io, svgOpts);
  if (written === undefined) return json ? emit({ isError: true, body: { error: "Could not write the drawings." } }, true, io) : 2;
  const ms = performance.now() - started;

  const valid = quality.valid && result.status === "valid";
  if (json) return emit({ isError: !valid, body: { status: result.status, verified: quality.valid, svg: showPath(written.svgPath), png: showPath(written.pngPath), metrics: quality.metrics } }, true, io);
  const s = outStyle(io);
  io.out(
    `${s.bold(name)}: ${valid ? s.green("valid") : s.bold(s.red("NOT valid"))}. Wrote ${s.cyan(showPath(written.svgPath))} and ${s.cyan(showPath(written.pngPath))} ${s.dim(`(${Math.round(ms)} ms)`)}`,
  );
  if (!valid) {
    for (const e of quality.connections.errors) io.out(issueLine("verifier", `${e.code} ${e.message}`, outStyle(io)));
    for (const o of quality.overlaps) io.out(issueLine("overlap", `${o.code} ${o.message}`, outStyle(io)));
    for (const issue of result.issues) io.out(issueLine("issue", issue, outStyle(io)));
    if (result.status !== "valid") io.out(issueLine("layout", result.status, outStyle(io)));
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
  theme?: string;
  transparent: boolean;
}

function edit(a: Args, io: Io): number {
  if (a.file === undefined) {
    return usageError("edit: no file given.", a.json, io, "edit");
  }
  if (a.ops === undefined) {
    return usageError("edit: no operations given. Add --ops <ops.json>.", a.json, io, "edit");
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
    for (const i of parsed.issues) io.err(issueLine("error", `${i.code} ${i.message}`, errStyle(io)));
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
    const s = outStyle(io);
    io.out(`${s.bold(name)}: edit ${s.red("refused")} (${r.status}). Nothing was written.`);
    if (unstable.length) {
      for (const b of unstable) io.out(issueLine("would move", b, outStyle(io)));
      io.out(issueLine("hint", 'without --strict it is saved with this report; or add { "op": "relayout", "mode": "canonical" } to redraw the whole sheet.', outStyle(io)));
    } else {
      for (const i of r.issues) io.out(issueLine("issue", i, outStyle(io)));
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
  const s = outStyle(io);
  const files = written ? `Wrote ${s.cyan(showPath(a.file))}, ${s.cyan(showPath(written.svgPath))} and ${s.cyan(showPath(written.pngPath))}` : "Dry run, nothing written";
  const how = r.mode === "canonical" ? "whole sheet redrawn" : "drawing kept";
  io.out(`${s.bold(name)}: edit ${s.green(a.dryRun ? "checked" : "saved")} (${how}). ${files} ${s.dim(`(${Math.round(ms)} ms)`)}`);
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  io.out(issueLine("changed", `parts ${list(r.affected.parts)}; nets ${list(r.affected.nets)}`, outStyle(io)));
  if (run.removedHints.length) io.out(issueLine("removed hints", run.removedHints.join(", "), outStyle(io)));
  if (rep && r.mode !== "canonical") {
    io.out(issueLine("untouched", `${rep.untouched.count} parts moved ${rep.untouched.meanMove} G on average and ${rep.untouched.maxMove} G at most; other nets rerouted: ${list(rep.routesChanged.other)}`, outStyle(io)));
  }
  if (breaks.length) {
    io.out(issueLine("warning", `this edit moves untouched parts more than the limit (${breaks.join("; ")}). It is saved anyway; --strict refuses such edits.`, outStyle(io)));
  }
  if (r.mode === "canonical" && previous && !script.ops.some((o) => o.op === "setSpacing" || (o.op === "relayout" && o.mode === "canonical"))) {
    io.out(issueLine("note", "no layout could keep the drawing, so the whole sheet was redrawn.", outStyle(io)));
  }
  io.out(issueLine("revision", basis, outStyle(io)));
  io.out(issueLine("layout", token, outStyle(io)));
  return 0;
}


const SHARED = {
  init: { values: ["template"], flags: [] },
  check: { values: ["detail", "cursor"], flags: [] },
  render: { values: ["out", "scale", "dpi", "theme"], flags: ["draft", "overwrite", "transparent"] },
  preview: { values: ["out", "max", "focus", "finding"], flags: [] },
  query: { values: [], flags: [] },
  undo: { values: [], flags: [] },
  fmt: { values: ["to"], flags: [] },
  describe: { values: [], flags: ["table", "alt-text"] },
  components: { values: ["limit", "cursor"], flags: [] },
  component: { values: [], flags: [] },
} satisfies Record<string, { values: string[]; flags: string[] }>;

type SharedVerb = keyof typeof SHARED;

/** Options a command accepts, written as on the command line, for typo suggestions. */
function optionNames(verb: SharedVerb): string[] {
  const spec: { values: readonly string[]; flags: readonly string[] } = SHARED[verb];
  return [...spec.values, ...spec.flags].map((o) => `--${o}`).concat(spec.values.includes("out") ? ["-o"] : [], ["--json", "--help"]);
}

/** `Unknown option "--them". Did you mean "--theme"?` */
function unknownOption(arg: string, known: readonly string[]): string {
  const near = closest(arg, known);
  return `Unknown option "${arg}".${near ? ` Did you mean "${near}"?` : ""}`;
}

/**
 * Report a usage mistake and return exit code 2. People get the message, the command's usage
 * line and where to find more; --json gets one JSON object.
 */
function usageError(message: string, json: boolean, io: Io, verb?: string): number {
  if (json) {
    io.out(JSON.stringify({ error: message, status: "usage" }, null, 2));
    return 2;
  }
  const e = errStyle(io);
  io.err(`${e.red("error:")} ${message}`);
  const line = verb === undefined ? undefined : usageLine(verb);
  if (line !== undefined) io.err(line);
  io.err(e.dim(verb !== undefined && line !== undefined ? `Run "schem ${verb} --help" for options and examples.` : `Run "schem --help" for commands.`));
  return 2;
}

function shared(verb: SharedVerb, argv: string[], io: Io): number {
  const json = argv.includes("--json");
  const spec: { values: readonly string[]; flags: readonly string[] } = SHARED[verb];
  const positional: string[] = [], options = new Map<string, string | true>();
  const usage = (message: string) => usageError(message, json, io, verb);
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
    } else return usage(unknownOption(arg, optionNames(verb)));
  }

  const [file, subject, id] = positional;
  const noFile = verb === "components" || verb === "init";
  const count = verb === "query" ? 3 : 1;
  if (positional.length > count || (!noFile && positional.length !== count))
    return usage(verb === "query" ? "query needs a file, part or net, and an id." : `Check the arguments for ${verb}.`);
  const args: Record<string, unknown> = Object.fromEntries(options);
  if (verb === "components") args.query = file;
  else if (verb === "component") args.type = file;
  else if (verb === "init") {
    const templateName = typeof args.template === "string" ? args.template : "led";
    const source = getInitTemplate(templateName);
    if (source === undefined) {
      return usage(`Unknown template "${templateName}". Valid templates: ${INIT_TEMPLATE_NAMES.join(", ")}.`);
    }
    delete args.template;
    const name = file ?? "circuit";
    args.path = /\.(?:schem|json)$/i.test(name) ? name : `${name}.schem`;
    args.source = source;
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
  const altTextOnly = verb === "describe" && options.has("alt-text");
  if (altTextOnly) delete args["alt-text"];
  const roots = rootsFor(typeof args.path === "string" ? args.path : undefined);
  const name = verb === "init" ? "schem_create" : `schem_${verb}`;
  return emit(executeCommand(roots, name, args), json, io, { verb, altTextOnly, args: { ...args, ...(typeof file === "string" ? { typed: file } : {}) } });
}

interface EmitContext {
  /** The CLI command, which picks the human format. */
  verb?: string;
  /** describe --alt-text: print the alt text line and nothing else. */
  altTextOnly?: boolean;
  /** The arguments the command ran with, for hints such as the next-page command. */
  args?: Record<string, unknown>;
}

function emit(result: CommandResult, json: boolean, io: Io, ctx: EmitContext = {}): number {
  const { body } = result;
  if (json) io.out(JSON.stringify(body, null, 2));
  else if (result.isError) printFailure(body, io);
  else if (ctx.altTextOnly && typeof body.altText === "string") io.out(body.altText);
  else for (const line of humanLines(body, ctx, outStyle(io), io.columns ?? 80)) io.out(line);
  if (body.status === "conflict") return 4;
  return result.isError || (typeof body.status === "string" && body.status !== "valid") || body.verified === false ? 1 : 0;
}

/** A failed command: its message, then any further issues it carries. */
function printFailure(body: Record<string, unknown>, io: Io): void {
  const e = errStyle(io);
  const message = String(body.error ?? body.status ?? "The command failed.");
  io.err(e.on ? `${e.red("error:")} ${message}` : message);
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues.slice(1) as Array<{ code?: string; at?: string; message?: string } | string>) {
      const text = typeof issue === "string" ? issue : [issue.code, issue.at, issue.message].filter(Boolean).join(" ");
      io.err(issueLine("error", text, e));
    }
  }
}

// ---------------------------------------------------------------------------
// Human output, one formatter per command. --json output never comes through here.

type Body = Record<string, unknown>;

function isValid(body: Body): boolean {
  return body.status === "valid" && body.verified !== false;
}

/** "valid" in green, or "NOT valid (why)" in red. */
function badge(body: Body, s: Style): string {
  if (isValid(body)) return s.bold(s.green("valid"));
  const why = typeof body.status === "string" && body.status !== "valid" ? body.status : "not verified";
  return s.bold(s.red(`NOT valid (${why})`));
}

/** The path the user typed when there is one, else the path the command reports. */
function pathOf(body: Body, ctx: EmitContext): string {
  const typed = ctx.args?.typed;
  if (typeof body.path === "string") return displayPath(body.path);
  return typeof typed === "string" ? showPath(typed) : "";
}

/** "6 parts, 6 nets. 0 errors, 0 warnings, 0 notes." with non-zero problems coloured. */
function countsLine(body: Body, s: Style): string | undefined {
  const c = body.counts as Record<string, number> | undefined;
  if (c === undefined) return undefined;
  const count = (n: number | undefined, word: string, paint: (t: string) => string) =>
    (n ?? 0) > 0 ? paint(plural(n!, word)) : plural(n ?? 0, word);
  return `  ${plural(c.parts ?? 0, "part")}, ${plural(c.nets ?? 0, "net")}. ` +
    `${count(c.errors, "error", s.red)}, ${count(c.warnings, "warning", s.yellow)}, ${count(c.notes, "note", s.cyan)}.`;
}

/** Notes, load warnings and layout issues the engine attached to a sheet. */
function sheetNotes(body: Body, s: Style): string[] {
  const lines: string[] = [];
  if (typeof body.note === "string") lines.push(issueLine("note", body.note, s));
  for (const w of (Array.isArray(body.warnings) ? body.warnings : []) as unknown[]) lines.push(issueLine("warning", String(w), s));
  for (const i of (Array.isArray(body.issues) ? body.issues : []) as unknown[]) lines.push(issueLine("issue", String(i), s));
  for (const n of (Array.isArray(body.layoutNotes) ? body.layoutNotes : []) as unknown[]) lines.push(issueLine("note", String(n), s));
  return lines;
}

function section(title: string, s: Style): string {
  return s.bold(s.cyan(title));
}

/** Labels, units and rounding for the drawing metrics of check. Unknown metrics are shown too. */
const METRICS: Array<[key: string, label: string, show: (v: unknown) => string]> = [
  ["sheet", "Sheet", (v) => (Array.isArray(v) ? `${num(v[0])} x ${num(v[1])} G` : num(v))],
  ["wireLength", "Wire length", (v) => `${num(v)} G`],
  ["crossings", "Crossings", (v) => num(v)],
  ["bends", "Bends", (v) => num(v)],
  ["dots", "Dots", (v) => num(v)],
  ["jogs", "Jogs", (v) => num(v)],
  ["squeezedRuns", "Squeezed runs", (v) => num(v)],
  ["farLabels", "Far labels", (v) => num(v)],
  ["minDotSpacing", "Min dot spacing", (v) => (typeof v === "number" ? `${num(v, 1)} G` : "none")],
  ["minCrossingToDot", "Min crossing to dot", (v) => (typeof v === "number" ? `${num(v, 1)} G` : "none")],
  ["aspectError", "Aspect error", (v) => num(v, 2)],
  ["marginImbalance", "Margin imbalance", (v) => num(v, 2)],
];

function metricLines(metrics: Body, s: Style): string[] {
  const known = new Set(METRICS.map(([k]) => k).concat("where"));
  const cells: Array<[string, string]> = METRICS.filter(([k]) => k in metrics).map(([k, label, show]) => [label, show(metrics[k])]);
  for (const [k, v] of Object.entries(metrics)) {
    if (known.has(k) || (typeof v === "object" && v !== null && !Array.isArray(v))) continue;
    const label = k.replace(/([A-Z])/g, " $1").toLowerCase();
    cells.push([label.charAt(0).toUpperCase() + label.slice(1), Array.isArray(v) ? v.map((x) => num(x, 2)).join(" x ") : num(v, 2)]);
  }
  // Two label and value pairs per row: twelve metrics in six lines.
  const half = Math.ceil(cells.length / 2);
  const rows = cells.slice(0, half).map((left, i) => {
    const right = cells[half + i];
    // The empty cell widens the gap between the two pairs.
    return right ? [s.dim(left[0]), left[1], "", s.dim(right[0]), right[1]] : [s.dim(left[0]), left[1]];
  });
  return table(rows, { style: s });
}

const SEVERITY: Record<string, (s: Style) => (t: string) => string> = {
  error: (s) => s.red, warn: (s) => s.yellow, info: (s) => s.cyan,
};

function findingLines(body: Body, ctx: EmitContext, s: Style): string[] {
  if (!Array.isArray(body.findings)) return [];
  const findings = body.findings as Array<{ id: string; severity: string; message: string; fix?: { ops?: Array<{ op?: string }> } | null }>;
  const total = typeof body.findingsTotal === "number" ? body.findingsTotal : findings.length;
  if (total === 0) return ["", `${section("Findings", s)}  none`];
  const lines = ["", section(findings.length < total ? `Findings (${findings.length} of ${total})` : `Findings (${total})`, s)];
  const width = Math.max(...findings.map((f) => f.severity.length));
  const pad = " ".repeat(2 + width + 2);
  for (const f of findings) {
    const paint = (SEVERITY[f.severity] ?? (() => s.dim))(s);
    lines.push(`  ${paint(f.severity.padEnd(width))}  ${s.bold(f.id)}`);
    lines.push(`${pad}${f.message}`);
    const ops = f.fix?.ops?.map((o) => o.op).filter((o): o is string => typeof o === "string") ?? [];
    if (ops.length) lines.push(`${pad}${s.dim("fix:")} ${ops.join(", ")} ${s.dim("(--json shows the edit; apply it with schem edit)")}`);
  }
  if (typeof body.cursor === "string") {
    lines.push("", s.dim(`More findings: schem check ${pathOf(body, ctx)} --cursor ${body.cursor}`));
  }
  return lines;
}

function checkLines(body: Body, ctx: EmitContext, s: Style): string[] {
  const lines = [`${s.bold(pathOf(body, ctx))}  ${badge(body, s)}`];
  const counts = countsLine(body, s);
  if (counts) lines.push(counts);
  lines.push(...sheetNotes(body, s));
  if (body.metrics && typeof body.metrics === "object") lines.push("", section("Drawing", s), ...metricLines(body.metrics as Body, s));
  lines.push(...findingLines(body, ctx, s));
  return lines;
}

/** init and undo: what happened to the file, then the same summary as check. */
function savedSheetLines(verb: "init" | "undo", body: Body, ctx: EmitContext, s: Style): string[] {
  const path = pathOf(body, ctx);
  const head = verb === "init" ? `Created ${s.bold(path)}` : `Restored the previous version of ${s.bold(path)}`;
  const lines = [`${head}  ${badge(body, s)}`];
  const counts = countsLine(body, s);
  if (counts) lines.push(counts);
  lines.push(...sheetNotes(body, s));
  if (Array.isArray(body.findings) && body.findings.length) lines.push(...findingLines(body, ctx, s));
  if (verb === "init") lines.push("", s.dim(`Next: schem draw ${path}`));
  return lines;
}

function writtenLines(verb: "render" | "preview", body: Body, ctx: EmitContext, s: Style): string[] {
  const out = typeof body.out === "string" ? displayPath(body.out) : "";
  const details: string[] = [];
  const png = body.png as { width?: number; height?: number; pxPerGrid?: number; dpi?: number } | undefined;
  if (png) {
    details.push(`PNG ${png.width} x ${png.height} px`);
    if (verb === "render" && png.pxPerGrid !== undefined) details.push(`${num(png.pxPerGrid, 2)} px per G`);
    if (png.dpi !== undefined) details.push(`${num(png.dpi)} dpi`);
  } else if (body.format === "svg") {
    const grid = body.grid as number[] | undefined;
    details.push(grid ? `SVG ${num(grid[0])} x ${num(grid[1])} G` : "SVG");
  }
  if (typeof body.bytes === "number") details.push(bytes(body.bytes));
  if (Array.isArray(body.focus)) details.push(`focus ${body.focus.join(", ")}`);
  if (typeof body.finding === "string") details.push(`finding ${body.finding}`);
  const lines = [`Wrote ${s.cyan(out)}${details.length ? `  ${s.dim(details.join(", "))}` : ""}`];
  if (!isValid(body)) lines.push(`  ${badge(body, s)}${ctx.args?.requireValid === false ? ". Written because of --draft." : ""}`);
  lines.push(...sheetNotes(body, s));
  return lines;
}

function fmtLines(body: Body, ctx: EmitContext, s: Style): string[] {
  const path = pathOf(body, ctx);
  const kind = body.format === "json" ? ".schem.json" : ".schem text";
  if (typeof body.out === "string") return [`Converted ${s.bold(path)} to ${s.cyan(displayPath(body.out))} ${s.dim(`(${kind})`)}`];
  if (body.saved === false) return [`${s.bold(path)} is already formatted ${s.dim(`(${kind})`)}`];
  return [`Formatted ${s.bold(path)} ${s.dim(`(${kind}; the old copy is in .schem-history/)`)}`];
}

function describeLines(body: Body, s: Style): string[] {
  const lines = [section("Description", s), ...String(body.description).split("\n").map((l) => `  ${l}`)];
  if (!isValid(body) && typeof body.status === "string") lines.push(`  ${badge(body, s)}`);
  if (typeof body.altText === "string") lines.push("", `${s.bold("Alt text:")} ${body.altText}`);
  if (Array.isArray(body.table)) {
    const rows = body.table as Array<{ name: string; presentation: string; pins: string[] }>;
    lines.push("", section(`Nets (${rows.length})`, s));
    lines.push(...table(rows.map((r) => [s.bold(r.name), r.presentation, r.pins.join(", ")]), { header: ["Net", "Drawn as", "Pins"], style: s }));
  }
  return lines;
}

interface ComponentEntry { id: string; kind: string; name?: string; inlinePins?: boolean; pins: Array<{ name: string }> }

function componentsLines(body: Body, ctx: EmitContext, s: Style, columns: number): string[] {
  const entries = body.components as ComponentEntry[];
  const query = typeof ctx.args?.query === "string" ? ctx.args.query : undefined;
  if (entries.length === 0) return [query ? `No part types match "${query}". Try a shorter query, or schem components.` : "No part types."];
  const idWidth = Math.max(4, ...entries.map((e) => e.id.length));
  const kindWidth = Math.max(4, ...entries.map((e) => e.kind.length));
  const room = Math.max(20, columns - 2 - idWidth - 2 - kindWidth - 2);
  const details = (e: ComponentEntry): string => {
    if (e.inlinePins) return s.dim("pins declared on the part");
    if (e.kind === "module") return fitList([`${e.name ?? e.id} (${plural(e.pins.length, "pin")})`], room);
    return fitList(e.pins.map((p) => p.name), room);
  };
  const lines = table(entries.map((e) => [s.bold(e.id), e.kind, details(e)]), { header: ["Type", "Kind", "Pins / Details"], style: s });
  const total = typeof body.total === "number" ? body.total : entries.length;
  const start = Number(ctx.args?.cursor ?? 0) || 0;
  if (typeof body.cursor === "string") {
    const parts = ["schem components", ...(query ? [query] : []), ...(typeof ctx.args?.limit === "number" ? ["--limit", String(ctx.args.limit)] : []), "--cursor", body.cursor];
    lines.push("", s.dim(`Showing ${start + 1} to ${start + entries.length} of ${total}. More: ${parts.join(" ")}`));
  } else if (start > 0 || entries.length < total) {
    lines.push("", s.dim(`Showing ${start + 1} to ${start + entries.length} of ${total}.`));
  }
  if (typeof body.cursor !== "string" && start === 0 && entries.length >= total) lines.push("");
  lines.push(s.dim("Details of one type: schem component <type>"));
  return lines;
}

interface ComponentPin { number: string; name: string; role: string; aliases?: string[]; group?: string; iface?: string[]; chain?: string; representative?: boolean }

function componentLines(body: Body, s: Style): string[] {
  const lines = [`${s.bold(String(body.id))}${typeof body.name === "string" ? `  ${body.name}` : ""}`];
  const facts: Array<[string, string]> = [["Kind", String(body.kind)]];
  if (typeof body.refPrefix === "string") facts.push(["Ref prefix", body.refPrefix]);
  if (typeof body.controller === "boolean") facts.push(["Controller", body.controller ? "yes" : "no"]);
  const doc = body.doc as { url?: string; title?: string } | undefined;
  if (doc?.url) facts.push(["Docs", doc.url]);
  if (Array.isArray(body.interfaces) && body.interfaces.length) facts.push(["Interfaces", body.interfaces.join(", ")]);
  if (Array.isArray(body.groups) && body.groups.length) facts.push(["Groups", body.groups.join(", ")]);
  lines.push(...pairs(facts, s));
  if (typeof body.note === "string") lines.push("", `  ${body.note}`);
  const pins = body.pins as ComponentPin[];
  if (pins.length) {
    lines.push("", section(`Pins (${pins.length})`, s));
    const extra = (p: ComponentPin): string => [
      p.aliases?.length ? `aliases ${p.aliases.join(", ")}` : "",
      p.group ? `group ${p.group}` : "",
      p.iface?.length ? `iface ${p.iface.join(", ")}` : "",
      p.chain ? `chain ${p.chain}` : "",
      p.representative ? "representative" : "",
    ].filter(Boolean).join("; ");
    lines.push(...table(pins.map((p) => [p.number, s.bold(p.name), p.role, extra(p)]), { header: ["Pin", "Name", "Role", "Aliases / Group / Interface"], style: s }));
  }
  return lines;
}

interface PartPin { number: string; name: string; role: string; at?: number[]; dir?: string; net: { id: string; name?: string } | null }

function netLabel(net: { id: string; name?: string } | null, s: Style): string {
  if (net === null) return s.dim("not connected");
  return net.name !== undefined && net.name !== net.id ? `${net.name} ${s.dim(`(${net.id})`)}` : net.id;
}

function queryLines(body: Body, s: Style): string[] {
  const lines: string[] = [];
  if (body.part) {
    const part = body.part as { id: string; type: string; at?: number[]; rot?: number; flip?: boolean; props?: Record<string, unknown>; pins: PartPin[] };
    const head = [`${s.dim("type:")} ${part.type}`];
    if (part.at) head.push(`${s.dim("at:")} ${point(part.at)}`);
    if (part.rot !== undefined) head.push(`${s.dim("rot:")} ${part.rot}`);
    if (part.flip) head.push(`${s.dim("flip:")} yes`);
    lines.push(`${s.bold(`Part ${part.id}`)}  ${head.join("  ")}`);
    if (part.props && Object.keys(part.props).length) {
      lines.push(`  ${s.dim("props:")} ${Object.entries(part.props).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")}`);
    }
    if (!isValid(body)) lines.push(`  ${badge(body, s)}`);
    lines.push("", section(`Pins (${part.pins.length})`, s));
    lines.push(...table(part.pins.map((p) => [p.number, s.bold(p.name), p.role, point(p.at), p.dir ?? "", netLabel(p.net, s)]), { header: ["Pin", "Name", "Role", "At", "Dir", "Net"], style: s }));
    return lines;
  }
  const net = body.net as { id: string; name?: string; kind: string; domain?: string; endpoints: string[]; drawn: string; pins: Array<{ part: string; number: string; at?: number[]; dir?: string }> };
  const head = [`${s.dim("id:")} ${net.id}`, `${s.dim("kind:")} ${net.kind}`, `${s.dim("drawn:")} ${net.drawn}`];
  if (net.domain !== undefined) head.splice(2, 0, `${s.dim("domain:")} ${net.domain}`);
  lines.push(`${s.bold(`Net ${net.name ?? net.id}`)}  ${head.join("  ")}`);
  lines.push(`  ${s.dim("endpoints:")} ${net.endpoints.join(", ")}`);
  if (!isValid(body)) lines.push(`  ${badge(body, s)}`);
  lines.push("", section(`Pins (${net.pins.length})`, s));
  lines.push(...table(net.pins.map((p) => [s.bold(p.part), p.number, point(p.at), p.dir ?? ""]), { header: ["Part", "Pin", "At", "Dir"], style: s }));
  return lines;
}

/** The human text of a successful command. */
function humanLines(body: Body, ctx: EmitContext, s: Style, columns: number): string[] {
  switch (ctx.verb) {
    case "check": return checkLines(body, ctx, s);
    case "init": case "undo": return savedSheetLines(ctx.verb, body, ctx, s);
    case "render": case "preview": return writtenLines(ctx.verb, body, ctx, s);
    case "fmt": return fmtLines(body, ctx, s);
    case "describe": if (typeof body.description === "string") return describeLines(body, s); break;
    case "components": if (Array.isArray(body.components)) return componentsLines(body, ctx, s, columns); break;
    case "component": if (Array.isArray(body.pins)) return componentLines(body, s); break;
    case "query": if (body.part || body.net) return queryLines(body, s); break;
  }
  // Anything else: the path and status.
  return [[typeof body.path === "string" ? displayPath(body.path) : "", typeof body.status === "string" ? body.status : ""].filter(Boolean).join("  ")];
}

function importCommand(rest: string[], io: Io): number {
  const json = rest.includes("--json");
  let file: string | undefined, outPath: string | undefined, overwrite = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--json") continue;
    if (arg === "--overwrite") { overwrite = true; continue; }
    if (arg === "-o" || arg === "--out") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) return usageError(`${arg}: no output file given.`, json, io, "import");
      outPath = next;
      i++;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") return usageError(unknownOption(arg, ["-o", "--out", "--overwrite", "--json", "--help"]), json, io, "import");
    if (file === undefined) file = arg;
    else return usageError(`import: more than one file given ("${file}" and "${arg}").`, json, io, "import");
  }
  if (file === undefined) return usageError("import: no SPICE file given.", json, io, "import");
  const readRoots = rootsFor(file);
  const opened = readWithin(readRoots, file);
  if (!opened.ok) {
    if (json) return emit({ isError: true, body: { ok: false, error: opened.message } }, true, io);
    io.err(`Cannot read ${showPath(file)}. ${opened.message}`);
    return 1;
  }
  const imported = importSpice(opened.text);
  if (!imported.ok || !imported.dsl || !imported.project) {
    if (json) {
      io.out(JSON.stringify({ ok: false, error: imported.errors[0] ?? "Could not import SPICE netlist.", errors: imported.errors, warnings: imported.warnings }, null, 2));
    } else {
      io.err(`${errStyle(io).red("Cannot import")} ${showPath(file)}:`);
      for (const e of imported.errors) io.err(issueLine("error", e, errStyle(io)));
      for (const w of imported.warnings) io.err(issueLine("warning", w, errStyle(io)));
    }
    return 1;
  }
  const parts = imported.project.circuit.parts.length;
  const nets = imported.project.circuit.nets.length;
  let written: string | undefined;
  if (outPath !== undefined) {
    const writeRoots = withLegacyOutput(readRoots, dirname(resolve(outPath)));
    try {
      written = writeOutput(writeRoots, outPath, opened.real, imported.dsl, overwrite);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (json) io.out(JSON.stringify({ ok: false, error: message }, null, 2));
      else io.err(message);
      return 1;
    }
  }
  if (json) {
    io.out(JSON.stringify({
      ok: true,
      ...(written ? { out: showPath(written) } : {}),
      dsl: imported.dsl,
      warnings: imported.warnings,
      parts,
      nets,
    }, null, 2));
    return 0;
  }
  for (const w of imported.warnings) io.err(issueLine("warning", w, errStyle(io)));
  if (written !== undefined) {
    const s = outStyle(io);
    io.out(`Wrote ${s.cyan(showPath(written))} (${plural(parts, "part")}, ${plural(nets, "net")}).`);
    io.out(s.dim(`Next: schem draw ${showPath(written)}`));
  } else io.out(imported.dsl.trimEnd());
  return 0;
}

export interface WatchOptions {
  dir?: string;
  theme?: string;
  transparent?: boolean;
  debounceMs?: number;
  io?: Io;
  onDraw?: (result: { code: number; count: number }) => void;
}

export interface WatchHandle {
  close(): void;
  readonly drawCount: number;
}

/**
 * Draw `file` once, then watch its parent folder with debounce and redraw SVG/PNG on edits.
 * Errors during intermediate edits are written to stderr without crashing the watcher.
 */
export function watchFile(file: string, options: WatchOptions = {}): WatchHandle {
  const dir = options.dir ?? "out";
  const debounceMs = options.debounceMs ?? 150;
  const io: Io = options.io ?? {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
  if (options.theme !== undefined) resolveTheme(options.theme);
  const svgOpts: SvgOptions | undefined = options.theme !== undefined || options.transparent
    ? { ...(options.theme !== undefined ? { theme: options.theme } : {}), ...(options.transparent ? { transparent: true } : {}) }
    : undefined;

  const filePath = resolve(file);
  const watchDir = dirname(filePath);
  const targetBase = basename(filePath);
  let closed = false;
  let drawCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runDraw = (): void => {
    let code = 1;
    try {
      code = draw(file, dir, false, io, svgOpts);
    } catch (e) {
      io.err(`watch: ${e instanceof Error ? e.message : String(e)}`);
      code = 3;
    }
    drawCount += 1;
    options.onDraw?.({ code, count: drawCount });
  };

  runDraw();

  const watcher = fsWatch(watchDir, (_eventType, filename) => {
    if (closed) return;
    if (filename !== null) {
      const name = String(filename);
      const matches = process.platform === "win32"
        ? name.toLowerCase() === targetBase.toLowerCase()
        : name === targetBase;
      if (!matches) return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) runDraw();
    }, debounceMs);
  });

  watcher.on("error", (err) => {
    if (!closed) io.err(`watch: ${err.message}`);
  });

  return {
    get drawCount() { return drawCount; },
    close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      watcher.close();
    },
  };
}

function watchCommand(rest: string[], io: Io): number {
  let file: string | undefined;
  let dir = "out";
  let theme: string | undefined;
  let transparent = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "-o" || arg === "--out") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) return usageError(`${arg}: no folder given.`, false, io, "watch");
      dir = next;
      i++;
    } else if (arg === "--theme") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) return usageError(`${arg}: no value given.`, false, io, "watch");
      theme = next;
      i++;
    } else if (arg === "--transparent") {
      transparent = true;
    } else if (arg.startsWith("-") && arg !== "-") {
      return usageError(unknownOption(arg, ["-o", "--out", "--theme", "--transparent", "--help"]), false, io, "watch");
    } else if (file === undefined) {
      file = arg;
    } else {
      return usageError(`watch: more than one file given ("${file}" and "${arg}").`, false, io, "watch");
    }
  }
  if (file === undefined) return usageError("watch: no file given.", false, io, "watch");
  if (theme !== undefined) {
    try { resolveTheme(theme); }
    catch (e) { return usageError((e as Error).message, false, io, "watch"); }
  }
  if (!existsSync(resolve(file))) {
    io.err(`Cannot read ${showPath(file)}. no such file`);
    return formatOf(file) === "dsl" ? 1 : 2;
  }
  const s = outStyle(io);
  io.out(`${s.bold("Watching")} ${s.cyan(showPath(file))} -> ${s.cyan(showPath(dir))} ${s.dim("(Ctrl+C to stop)")}`);
  const handle = watchFile(file, { dir, theme, transparent, io });
  const stop = () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    handle.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0;
}

const HELP_FLAGS = ["--help", "-h"];

/** Help as text, or as one JSON object when --json asks for machine output. */
function printHelp(text: string, json: boolean, io: Io, command?: string): number {
  if (json) io.out(JSON.stringify({ status: "help", ...(command ? { command } : {}), help: text }, null, 2));
  else io.out(text);
  return 0;
}

function unknownCommand(command: string, json: boolean, io: Io): number {
  const near = closest(command, COMMAND_NAMES);
  const message = `Unknown command "${command}".${near ? ` Did you mean "${near}"?` : ""}`;
  if (json) return usageError(message, true, io);
  const e = errStyle(io);
  io.err(`${e.red("error:")} ${message}`);
  io.err(e.dim(`Run "schem --help" for commands.`));
  return 2;
}

function dispatch(argv: string[], io: Io): number {
  const [command, ...rest] = argv;
  const json = rest.includes("--json");
  const style = json ? createStyle(false) : outStyle(io);
  if (command === undefined || command === "--help" || command === "-h") {
    return printHelp(mainHelp(packageVersion(), style), json, io);
  }
  if (command === "--version" || command === "-v") {
    io.out(packageVersion());
    return 0;
  }
  if (command === "help") {
    const topic = rest.find((a) => a !== "--json");
    if (topic === undefined) return printHelp(mainHelp(packageVersion(), style), json, io);
    if (topic === "mcp") return printHelp(MCP_HELP.trimEnd(), json, io, "mcp");
    const text = commandHelp(topic, style);
    return text === undefined ? unknownCommand(topic, json, io) : printHelp(text, json, io, topic);
  }
  if (command === "mcp") {
    if (rest.some((a) => HELP_FLAGS.includes(a))) return printHelp(MCP_HELP.trimEnd(), json, io, "mcp");
    return mcpMain(rest);
  }
  const help = commandHelp(command, style);
  if (help === undefined) return unknownCommand(command, json, io);
  if (rest.some((a) => HELP_FLAGS.includes(a))) return printHelp(help, json, io, command);
  if (Object.hasOwn(SHARED, command)) return shared(command as SharedVerb, rest, io);
  if (command === "import") return importCommand(rest, io);
  if (command === "watch") return watchCommand(rest, io);

  const a: Args = { dir: "out", strict: false, dryRun: false, json: rest.includes("--json"), transparent: false };
  // Options that take a value, and flags, per command.
  const valued: Record<string, (v: string) => void> = { "-o": (v) => (a.dir = v), "--out": (v) => (a.dir = v) };
  const flags: Record<string, () => void> = { "--json": () => (a.json = true) };
  if (command === "draw") {
    valued["--theme"] = (v) => (a.theme = v);
    flags["--transparent"] = () => (a.transparent = true);
  }
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
        return usageError(`${arg}: no ${arg === "-o" || arg === "--out" ? "folder" : "value"} given.`, a.json, io, command);
      valued[arg]!(next);
      i++;
    } else if (flags[arg]) {
      flags[arg]!();
    } else if (arg.startsWith("-") && arg !== "-") {
      return usageError(unknownOption(arg, [...Object.keys(valued), ...Object.keys(flags), "--help"]), a.json, io, command);
    } else if (a.file === undefined) {
      a.file = arg;
    } else {
      return usageError(`${command}: more than one file given ("${a.file}" and "${arg}").`, a.json, io, command);
    }
  }
  const svgOpts: SvgOptions | undefined = a.theme !== undefined || a.transparent
    ? { ...(a.theme !== undefined ? { theme: a.theme } : {}), ...(a.transparent ? { transparent: true } : {}) }
    : undefined;
  return command === "draw" ? draw(a.file, a.dir, a.json, io, svgOpts) : edit(a, io);
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

/**
 * Output sinks for a real process: stdout and stderr, each styled only when it is a terminal,
 * NO_COLOR is not set, TERM is not "dumb" and the arguments do not ask for exact output.
 */
export function processIo(argv: readonly string[]): Io {
  return {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    color: colorWanted(process.stdout, argv),
    errColor: colorWanted(process.stderr, argv),
    ...(process.stdout.columns ? { columns: process.stdout.columns } : {}),
  };
}

if (isEntryPoint()) {
  process.exitCode = run(process.argv.slice(2), processIo(process.argv.slice(2)));
}
