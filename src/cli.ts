// The one-command try-out (step 3): draw a circuit file for a newcomer.
//
//   npm run schem -- draw examples/led.schem.json
//
// `run` is exported so tests can call it without spawning a process; the bottom of this file
// calls it when the file is run directly. This is the only CLI: it loads, lays out, checks and
// writes the drawing with the same calls as scripts/draw.ts, in the same order.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, type LoadResult } from "./io/project.js";
import { layout } from "./layout/layout.js";
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
  npm run schem -- --help
  npm run schem -- --version

Example:
  npm run schem -- draw examples/led.schem.json

draw writes <dir>/<name>.svg and <dir>/<name>.png. <dir> defaults to out.
The circuit file format is described in docs/netlist-format.md.`;

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
// JSON syntax errors with a line and a column. JSON.parse only gives a position for some
// errors (for "Unexpected token" it gives a snippet instead), so this small scanner finds the
// offset itself. It is only used when the text is already known to be bad JSON; JSON.parse
// remains the authority on whether the file is valid.

interface JsonProblem {
  index: number;
  message: string;
}

function jsonProblem(text: string): JsonProblem | null {
  let i = 0;
  const at = (message: string, index = i): JsonProblem => ({ index, message });
  const ws = (): void => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };

  const value = (): JsonProblem | null => {
    ws();
    if (i >= text.length) return at("the file ends here, where a value should start.");
    const c = text[i]!;
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || (c >= "0" && c <= "9")) return number();
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return null;
      }
    }
    if (c === "}") return at("found \"}\" where a value should be. A trailing comma is not allowed.");
    if (c === "]") return at("found \"]\" where a value should be. A trailing comma is not allowed.");
    return at(`"${c}" cannot start a value. Strings and property names need double quotes.`);
  };

  const string = (): JsonProblem | null => {
    i++; // opening quote
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        i++;
        return null;
      }
      if (c === "\n" || c === "\r") return at("a string is not closed before the end of the line.");
      if (c === "\\") {
        const next = text[i + 1];
        if (next === undefined) return at("the file ends in the middle of an escape sequence.");
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return at("\\u must be followed by four hexadecimal digits.", i + 2);
          i += 6;
        } else if ('"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          return at(`"\\${next}" is not a valid escape. Use \\" \\\\ \\/ \\b \\f \\n \\r or \\t.`, i);
        }
        continue;
      }
      if (c.charCodeAt(0) < 0x20) return at("a string contains a control character; write it as an escape such as \\n.");
      i++;
    }
    return at("the file ends before the closing double quote of a string.");
  };

  const number = (): JsonProblem | null => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || m[0].length === 0) return at("this is not a valid number.");
    i += m[0].length;
    return null;
  };

  const object = (): JsonProblem | null => {
    i++; // {
    ws();
    if (text[i] === "}") {
      i++;
      return null;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') return at("a property name must be a double-quoted string.");
      const keyError = string();
      if (keyError) return keyError;
      ws();
      if (text[i] !== ":") return at("expected \":\" after the property name.");
      i++;
      const valueError = value();
      if (valueError) return valueError;
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return null;
      }
      if (i >= text.length) return at("the file ends before the closing brace }.");
      return at("expected a comma or the closing brace } after a value.");
    }
  };

  const array = (): JsonProblem | null => {
    i++; // [
    ws();
    if (text[i] === "]") {
      i++;
      return null;
    }
    for (;;) {
      const valueError = value();
      if (valueError) return valueError;
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return null;
      }
      if (i >= text.length) return at("the file ends before the closing bracket ].");
      return at("expected a comma or the closing bracket ] after a value.");
    }
  };

  const problem = value();
  if (problem) return problem;
  ws();
  if (i < text.length) return at("there is text after the end of the JSON value.");
  return null;
}

/** 1-based line and column of an offset in text. */
function lineColumn(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(index, text.length)));
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: index - lastNewline };
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

function draw(file: string | undefined, dir: string, io: Io): number {
  if (file === undefined) {
    io.err("draw: no file given.");
    io.err(USAGE);
    return 2;
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") io.err(`Cannot read ${showPath(file)}: no such file`);
    else if (code === "EISDIR") io.err(`Cannot read ${showPath(file)}: it is a directory, not a file.`);
    else if (code === "EACCES" || code === "EPERM") io.err(`Cannot read ${showPath(file)}: permission denied.`);
    else io.err(`Cannot read ${showPath(file)}: ${(e as Error).message}`);
    return 2;
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
    return 2;
  }

  const loaded = loadProject(text);
  if (!loaded.ok || loaded.project === undefined) {
    io.err(`Cannot draw ${showPath(file)}:`);
    printLoadErrors(loaded, io);
    return 2;
  }
  for (const w of loaded.warnings) io.err(issueLine("warning", w.message));

  const name = drawingName(file);
  const started = performance.now();
  const result = layout(loaded.project);
  if (result.render === undefined) {
    io.err(`${name}: could not draw it (${result.status}).`);
    for (const issue of result.issues) io.err(issueLine("issue", issue));
    for (const note of result.notes) io.err(issueLine("note", note));
    return 2;
  }

  const quality = checkDrawing(loaded.project.circuit, result.pinDefs, result.render);
  const svg = toSvg(result.render);
  const png = toPng(svg);
  const ms = performance.now() - started;

  const svgPath = join(dir, `${name}.svg`);
  const pngPath = join(dir, `${name}.png`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(svgPath, svg);
    writeFileSync(pngPath, png);
  } catch (e) {
    io.err(`Cannot write to ${showPath(dir)}: ${(e as Error).message}`);
    return 2;
  }

  const valid = quality.valid && result.status === "valid";
  io.out(
    `${name}: ${valid ? "valid" : "NOT valid"}. Wrote ${showPath(svgPath)} and ${showPath(pngPath)} (${Math.round(ms)} ms)`,
  );
  if (!valid) {
    for (const e of quality.connections.errors) io.out(issueLine("verifier", `${e.code} ${e.message}`));
    for (const o of quality.overlaps) io.out(issueLine("overlap", `${o.code} ${o.message}`));
    for (const issue of result.issues) io.out(issueLine("issue", issue));
    if (result.status !== "valid") io.out(issueLine("layout", result.status));
  }
  return valid ? 0 : 1;
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
  if (command !== "draw") {
    io.err(`Unknown command "${command}".`);
    io.err(USAGE);
    return 2;
  }

  let file: string | undefined;
  let dir = "out";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "-o" || arg === "--out") {
      const next = rest[i + 1];
      if (next === undefined) {
        io.err(`${arg}: no folder given.`);
        return 2;
      }
      dir = next;
      i++;
    } else if (arg.startsWith("-") && arg !== "-") {
      io.err(`Unknown option "${arg}".`);
      io.err(USAGE);
      return 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      io.err(`draw: more than one file given ("${file}" and "${arg}").`);
      return 2;
    }
  }
  return draw(file, dir, io);
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
