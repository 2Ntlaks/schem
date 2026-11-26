// Presentation helpers for the human side of the command line (src/cli.ts and src/bin.ts).
//
// Nothing here decides what a command does. It only shapes text for people: optional ANSI
// styling (off unless the caller asks for it), padded column tables, rounded numbers, the
// closest-name suggestion for typos, and the help text for `schem --help` and every command.
// Machine output (--json) never passes through here.

import { INIT_TEMPLATE_NAMES } from "./cli-templates.js";
import { TOOLS } from "./mcp/tools.js";
import { THEME_NAMES } from "./render/themes.js";

// ---------------------------------------------------------------------------
// Styling

type Paint = (s: string) => string;

/** A small set of standard ANSI styles. With `on` false every style returns its text unchanged. */
export interface Style {
  readonly on: boolean;
  bold: Paint;
  dim: Paint;
  red: Paint;
  green: Paint;
  yellow: Paint;
  cyan: Paint;
}

// Standard SGR codes only, so the terminal's own palette decides the colours on dark and light
// backgrounds. Each style closes with its own reset code, so styles can nest.
const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
} as const;

export function createStyle(on: boolean): Style {
  const make = ([open, close]: readonly [number, number]): Paint =>
    on ? (s) => (s === "" ? s : `\x1b[${open}m${s}\x1b[${close}m`) : (s) => s;
  return {
    on,
    bold: make(CODES.bold),
    dim: make(CODES.dim),
    red: make(CODES.red),
    green: make(CODES.green),
    yellow: make(CODES.yellow),
    cyan: make(CODES.cyan),
  };
}

export const PLAIN: Style = createStyle(false);

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

/** Width of a string on screen: its length without ANSI codes. */
export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

/** Arguments whose output must stay byte-exact, so they are never styled. */
const RAW_OUTPUT_FLAGS = ["--json", "--alt-text", "--version", "-v"];

/**
 * True when output to `stream` may be styled: it is a terminal, NO_COLOR is not set, TERM is
 * not "dumb", and the arguments do not ask for exact output (--json, --alt-text, --version).
 */
export function colorWanted(
  stream: { isTTY?: boolean } | undefined,
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (stream?.isTTY !== true) return false;
  if ("NO_COLOR" in env) return false;
  if (env.TERM === "dumb") return false;
  return !argv.some((a) => RAW_OUTPUT_FLAGS.includes(a));
}

// ---------------------------------------------------------------------------
// Layout of text

export interface TableOptions {
  header?: string[];
  indent?: number;
  gap?: number;
  style?: Style;
}

/**
 * Rows of cells padded into aligned columns. The last column is not padded, so no line ends
 * in spaces. Widths ignore ANSI codes, so styled cells line up too.
 */
export function table(rows: string[][], opts: TableOptions = {}): string[] {
  const style = opts.style ?? PLAIN;
  const indent = " ".repeat(opts.indent ?? 2), gap = " ".repeat(opts.gap ?? 2);
  const all = opts.header ? [opts.header, ...rows] : rows;
  const columns = Math.max(0, ...all.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, c) => Math.max(0, ...all.map((r) => visibleWidth(r[c] ?? ""))));
  const line = (cells: string[]): string =>
    (indent + cells.map((cell, c) => (c === cells.length - 1 ? cell : cell + " ".repeat(widths[c]! - visibleWidth(cell)))).join(gap)).trimEnd();
  const out: string[] = [];
  if (opts.header) out.push(line(opts.header.map((h) => style.dim(h))));
  for (const row of rows) out.push(line(row));
  return out;
}

/** Label and value pairs as an aligned two-column list. */
export function pairs(items: Array<[string, string]>, style: Style = PLAIN, indent = 2): string[] {
  return table(items.map(([k, v]) => [style.dim(k), v]), { indent, style });
}

/**
 * Items joined with ", " that fit in `width` characters. When some do not fit, the line ends
 * with "(+N more)" instead of wrapping.
 */
export function fitList(items: readonly string[], width: number): string {
  const all = items.join(", ");
  if (all.length <= width) return all;
  for (let k = items.length - 1; k >= 1; k--) {
    const shown = `${items.slice(0, k).join(", ")} (+${items.length - k} more)`;
    if (shown.length <= width) return shown;
  }
  return `(${items.length} items)`;
}

/** A number rounded to at most `digits` decimals, without trailing zeros. Other values as text. */
export function num(value: unknown, digits = 1): string {
  if (typeof value !== "number") return value === null || value === undefined ? "none" : String(value);
  if (!Number.isFinite(value)) return "none";
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A grid point such as (66, 27). */
export function point(value: unknown): string {
  return Array.isArray(value) && value.length === 2 ? `(${num(value[0])}, ${num(value[1])})` : "";
}

/** A byte count for people: 980 B, 7.4 KB, 1.2 MB. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${num(n / 1024, 1)} KB`;
  return `${num(n / (1024 * 1024), 1)} MB`;
}

/** "1 part", "2 parts". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

// ---------------------------------------------------------------------------
// Typos

export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(row[j + 1]! + 1, next[j]! + 1, row[j]! + Number(a[i] !== b[j])));
    }
    row = next;
  }
  return row[b.length]!;
}

/**
 * The candidate closest to `word`, if it is close enough to be a likely typo: at most two edits
 * (one for words of three letters or fewer), or the only candidate that starts with `word`.
 */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  const w = word.toLowerCase();
  if (w === "") return undefined;
  const limit = w.replace(/^-+/, "").length <= 3 ? 1 : 2;
  let best: string | undefined, bestDistance = Infinity;
  for (const c of candidates) {
    const d = editDistance(w, c.toLowerCase());
    if (d < bestDistance) { best = c; bestDistance = d; }
  }
  if (best !== undefined && bestDistance <= limit) return best;
  const prefixed = candidates.filter((c) => c.toLowerCase().startsWith(w));
  return w.replace(/^-+/, "").length >= 2 && prefixed.length === 1 ? prefixed[0] : undefined;
}

// ---------------------------------------------------------------------------
// Help text

interface CommandHelp {
  /** One-line summary for the command list. */
  summary: string;
  /** Short usage form for the command list, without the leading "schem ". */
  brief: string;
  /** Full usage lines, without the leading "schem ". */
  usage: string[];
  /** Plain sentences that say what the command does. */
  about: string[];
  options: Array<[string, string]>;
  examples: string[];
  /** Exit codes this command uses. */
  exits: Array<[string, string]>;
}

const JSON_OPTION: [string, string] = ["--json", "Print machine-readable JSON instead of text"];
const THEMES = THEME_NAMES.join(", ");
const TEMPLATES = INIT_TEMPLATE_NAMES.join(", ");

const EXIT_OK: [string, string] = ["0", "Done, and the drawing is valid"];
const EXIT_INVALID: [string, string] = ["1", "The drawing is not valid, or the input could not be used"];
const EXIT_USAGE: [string, string] = ["2", "Wrong arguments or options"];
const EXIT_INTERNAL: [string, string] = ["3", "Internal error (please report it)"];
const EXIT_CONFLICT: [string, string] = ["4", "Conflict: the file is locked or changed since its tokens"];
const EXIT_USAGE_LEGACY: [string, string] = ["2", "Wrong arguments, or a .json file that cannot be read"];
const LEGACY_JSON_NOTE = "A .json input that cannot be read exits 2; a .schem input exits 1.";

export const COMMANDS: Record<string, CommandHelp> = {
  init: {
    summary: "Start a new .schem file from a verified template",
    brief: "init [name]",
    usage: ["init [name] [--template <name>] [--json]"],
    about: [
      "Writes <name>.schem (default: circuit.schem) and checks that it draws cleanly.",
      "A name ending in .json writes a JSON netlist instead. An existing file is never replaced.",
      `Templates: ${TEMPLATES}. The default is led.`,
    ],
    options: [["--template <name>", "Starter circuit to copy"], JSON_OPTION],
    examples: ["init blinky", "init filter --template opamp", "init board.schem.json --template i2c"],
    exits: [EXIT_OK, EXIT_INVALID, EXIT_USAGE],
  },
  import: {
    summary: "Turn a SPICE netlist into a .schem file",
    brief: "import <file.cir>",
    usage: ["import <file.cir> [-o <output.schem>] [--overwrite] [--json]"],
    about: [
      "Reads a SPICE netlist. Without -o it prints the .schem text; with -o it writes the file.",
      "See docs/spice-import.md for the elements it understands.",
    ],
    options: [
      ["-o, --out <file>", "Write the result to this .schem or .schem.json file"],
      ["--overwrite", "Replace the output file if it exists"],
      JSON_OPTION,
    ],
    examples: ["import filter.cir", "import filter.cir -o filter.schem"],
    exits: [["0", "Imported"], ["1", "The netlist could not be read or imported"], EXIT_USAGE],
  },
  draw: {
    summary: "Write <name>.svg and <name>.png",
    brief: "draw <file>",
    usage: ["draw <file> [-o <dir>] [--theme <name>] [--transparent] [--json]"],
    about: [
      "Lays out, checks and writes <dir>/<name>.svg and <dir>/<name>.png. <dir> defaults to out.",
      "A file saved by edit is drawn exactly as it was saved.",
      LEGACY_JSON_NOTE,
      `Themes: ${THEMES}.`,
    ],
    options: [
      ["-o, --out <dir>", "Output folder (default: out)"],
      ["--theme <name>", "Colour theme for the SVG and PNG"],
      ["--transparent", "No background fill"],
      JSON_OPTION,
    ],
    examples: ["draw examples/led.schem.json", "draw board.schem -o figures --theme blueprint"],
    exits: [EXIT_OK, EXIT_INVALID, EXIT_USAGE_LEGACY, EXIT_INTERNAL],
  },
  watch: {
    summary: "Draw, then redraw whenever the file changes",
    brief: "watch <file>",
    usage: ["watch <file> [-o <dir>] [--theme <name>] [--transparent]"],
    about: [
      "Draws once like draw, then redraws the SVG and PNG each time the file is saved.",
      "Errors in a half-finished edit are printed and watching goes on. Press Ctrl+C to stop.",
      LEGACY_JSON_NOTE,
    ],
    options: [
      ["-o, --out <dir>", "Output folder (default: out)"],
      ["--theme <name>", "Colour theme for the SVG and PNG"],
      ["--transparent", "No background fill"],
    ],
    examples: ["watch board.schem", "watch board.schem -o figures --theme dark"],
    exits: [["0", "Watching (until Ctrl+C)"], ["1", "The file does not exist (.schem)"], EXIT_USAGE_LEGACY],
  },
  render: {
    summary: "Write one verified SVG or PNG",
    brief: "render <file> -o <out>",
    usage: [
      "render <file> -o <output.svg|png> [--scale N | --dpi N] [--theme <name>]",
      " [--transparent] [--draft] [--overwrite] [--json]",
    ],
    about: [
      "Writes one SVG or PNG file. It refuses a drawing that is not valid unless --draft is given.",
      `Themes: ${THEMES}.`,
    ],
    options: [
      ["-o, --out <file>", "Output file; .svg or .png picks the format"],
      ["--scale <N>", "PNG pixels per grid unit (default: 10)"],
      ["--dpi <N>", "PNG resolution in dots per inch (one grid unit is 2.54 mm)"],
      ["--theme <name>", "Colour theme"],
      ["--transparent", "No background fill"],
      ["--draft", "Write the file even when the drawing is not valid"],
      ["--overwrite", "Replace the output file if it exists"],
      JSON_OPTION,
    ],
    examples: ["render board.schem -o board.svg", "render board.schem -o board.png --dpi 300 --overwrite"],
    exits: [EXIT_OK, EXIT_INVALID, EXIT_USAGE],
  },
  preview: {
    summary: "Write a PNG overview or a focused crop",
    brief: "preview <file> -o <out.png>",
    usage: ["preview <file> -o <output.png> [--max N] [--focus R1,U2 | --finding ID]", " [--json]"],
    about: ["Writes a PNG of the whole sheet, or a crop around some parts or one finding from check."],
    options: [
      ["-o, --out <file>", "Output .png file"],
      ["--max <N>", "Longest side in pixels"],
      ["--focus <ids>", "Crop to these parts (comma separated)"],
      ["--finding <id>", "Crop to a finding id from schem check"],
      JSON_OPTION,
    ],
    examples: ["preview board.schem -o look.png", "preview board.schem -o r1.png --focus R1 --max 400"],
    exits: [EXIT_OK, EXIT_INVALID, EXIT_USAGE],
  },
  check: {
    summary: "Status, metrics and findings for the drawing",
    brief: "check <file>",
    usage: ["check <file> [--detail brief|normal|full] [--cursor N] [--json]"],
    about: [
      "Lays out and verifies the drawing, then reports its status, readability metrics and findings.",
      "Findings that carry a fix can be applied with schem edit.",
    ],
    options: [
      ["--detail <level>", "brief (counts), normal (+findings), full (+metrics; default)"],
      ["--cursor <N>", "Show findings from this offset (for long lists)"],
      JSON_OPTION,
    ],
    examples: ["check board.schem", "check board.schem --detail brief", "check board.schem --json"],
    exits: [EXIT_OK, EXIT_INVALID, EXIT_USAGE],
  },
  describe: {
    summary: "Plain-text summary and verified alt text",
    brief: "describe <file>",
    usage: ["describe <file> [--table] [--alt-text] [--json]"],
    about: [
      "Describes the drawing in words: sheet size, parts, nets and the alt text.",
      "--alt-text prints only the alt-text line, ready for Markdown or a blog post.",
    ],
    options: [
      ["--table", "Add a table of nets, how each is drawn and its pins"],
      ["--alt-text", "Print only the alt text, with nothing around it"],
      JSON_OPTION,
    ],
    examples: ["describe board.schem", "describe board.schem --alt-text"],
    exits: [EXIT_OK, EXIT_INVALID, EXIT_USAGE],
  },
  query: {
    summary: "Pins, positions and connections of a part or net",
    brief: "query <file> part|net <ID>",
    usage: ["query <file> part <ID> [--json]", "query <file> net <ID|NAME> [--json]"],
    about: ["Shows where a part sits and what each pin connects to, or which pins a net joins."],
    options: [JSON_OPTION],
    examples: ["query board.schem part R1", "query board.schem net GND"],
    exits: [EXIT_OK, ["1", "No such part or net, or the input could not be used"], EXIT_USAGE],
  },
  components: {
    summary: "Search built-in symbols and modules",
    brief: "components [query]",
    usage: ["components [query] [--limit N] [--cursor N] [--json]"],
    about: ["Lists part types whose id or name contains the query. Use the id as a part type."],
    options: [
      ["--limit <N>", "How many to show (default: 20)"],
      ["--cursor <N>", "Start from this offset (shown when there are more)"],
      JSON_OPTION,
    ],
    examples: ["components", "components esp32", "components --limit 50"],
    exits: [["0", "Listed"], ["1", "Bad query"], EXIT_USAGE],
  },
  component: {
    summary: "Pins and docs for one part type",
    brief: "component <type>",
    usage: ["component <type> [--json]"],
    about: ["Shows every pin of a part type with its role, aliases, group and interfaces."],
    options: [JSON_OPTION],
    examples: ["component resistor", "component module:ssd1306-oled-i2c"],
    exits: [["0", "Shown"], ["1", "Unknown type (close matches are suggested)"], EXIT_USAGE],
  },
  edit: {
    summary: "Apply an edit script and keep the drawing",
    brief: "edit <file> --ops <ops.json>",
    usage: [
      "edit <file> --ops <ops.json> [-o <dir>] [--strict] [--dry-run]",
      " [--expect-revision <R>] [--expect-layout <L>] [--json]",
    ],
    about: [
      "Applies the operations in <ops.json> as one change, keeps the rest of the drawing where it was, saves the file (the old one goes to .schem-history/) and draws it like draw.",
      "An edit that moves untouched parts more than the limit is saved with a warning; --strict refuses it instead.",
      `Operations are listed in docs/editing.md. ${LEGACY_JSON_NOTE}`,
    ],
    options: [
      ["--ops <file>", "JSON edit script (required)"],
      ["-o, --out <dir>", "Output folder for the drawing (default: out)"],
      ["--strict", "Refuse an edit that moves untouched parts too far"],
      ["--dry-run", "Check the edit and write nothing"],
      ["--expect-revision <R>", "Refuse unless the file still has this revision"],
      ["--expect-layout <L>", "Refuse unless the drawing still has this layout token"],
      JSON_OPTION,
    ],
    examples: ["edit board.schem --ops ops.json", "edit board.schem --ops ops.json --dry-run"],
    exits: [["0", "Saved (or checked with --dry-run)"], ["1", "Refused, or the input could not be used"], EXIT_USAGE_LEGACY, EXIT_INTERNAL, EXIT_CONFLICT],
  },
  undo: {
    summary: "Restore the last saved version",
    brief: "undo <file>",
    usage: ["undo <file> [--json]"],
    about: ["Puts back the newest copy from .schem-history/, written by edit and fmt."],
    options: [JSON_OPTION],
    examples: ["undo board.schem"],
    exits: [EXIT_OK, ["1", "Nothing to undo, or the input could not be used"], EXIT_USAGE, EXIT_CONFLICT],
  },
  fmt: {
    summary: "Tidy a file, or convert between .schem and JSON",
    brief: "fmt <file>",
    usage: ["fmt <file> [--to dsl|json] [--json]"],
    about: [
      "Rewrites the file in its canonical form.",
      "--to writes a converted copy next to it, and refuses when the conversion would drop fields.",
    ],
    options: [["--to <format>", "dsl (.schem) or json (.schem.json)"], JSON_OPTION],
    examples: ["fmt board.schem", "fmt board.schem --to json"],
    exits: [["0", "Formatted, or already tidy"], ["1", "Could not format or convert"], EXIT_USAGE],
  },
};

export const COMMAND_NAMES: readonly string[] = [...Object.keys(COMMANDS), "mcp", "help"];

const GROUPS: Array<[string, string[]]> = [
  ["Create & Import", ["init", "import"]],
  ["Draw & Export", ["draw", "watch", "render", "preview"]],
  ["Inspect & Query", ["check", "describe", "query", "components", "component"]],
  ["Edit & Format", ["edit", "undo", "fmt"]],
];

function heading(text: string, style: Style): string {
  return style.bold(style.cyan(text));
}

function wrapWords(words: string[], width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && indent.length + visibleWidth(line) + 1 + visibleWidth(word) > width) { lines.push(indent + line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines;
}

/** `schem --help`: every command grouped by workflow, in about 80 columns. */
export function mainHelp(version: string, style: Style = PLAIN): string {
  const s = style;
  const lines: string[] = [
    `${s.bold("schem")} ${version}: draw a clean circuit schematic from text or JSON`,
    "",
    heading("Usage:", s),
    `  schem ${s.cyan("<command>")} [file] [options]`,
    `  schem ${s.cyan("<command>")} --help     Options, examples and exit codes for one command`,
  ];
  const width = Math.max(...GROUPS.flatMap(([, names]) => names.map((n) => COMMANDS[n]!.brief.length)), 22);
  for (const [title, names] of GROUPS) {
    lines.push("", heading(`${title}:`, s));
    for (const name of names) {
      const c = COMMANDS[name]!;
      const brief = c.brief.replace(name, s.cyan(name));
      lines.push(`  ${brief}${" ".repeat(width - c.brief.length + 2)}${c.summary}`);
    }
  }
  const tools = TOOLS.map((t) => t.name);
  const mcp = "mcp [--root <folder>]...";
  lines.push(
    "",
    heading("MCP Server (AI Agents):", s),
    `  ${s.cyan("mcp")}${mcp.slice(3)}${" ".repeat(Math.max(2, width - mcp.length + 2))}Serve the ${tools.length} schem tools on stdin and stdout`,
    `  mcp --help${" ".repeat(width - 10 + 2)}Roots, protocol and what each tool does`,
    ...wrapWords([`${s.dim("Tools:")}`, ...tools.map((t, i) => (i < tools.length - 1 ? `${t},` : t))], 80, "    "),
    "",
    heading("Options for every command:", s),
    "  --json            Machine-readable JSON on stdout, nothing else",
    "  -h, --help        Help for the command",
    "  -v, --version     Print the version",
    "",
    heading("Files:", s),
    "  .schem text (docs/dsl.md) or .schem.json (docs/netlist-format.md).",
    "  Part types are in docs/parts.md and edit operations in docs/editing.md.",
    "",
    heading("Exit codes:", s),
    "  0 valid, 1 invalid or input error, 2 usage, 3 internal error, 4 conflict.",
    "",
    heading("Examples:", s),
    "  schem init blinky",
    "  schem draw blinky.schem",
    "  schem check blinky.schem",
    "  schem help draw",
    "",
    `  ${s.dim("From a clone of the repo, use npm run schem -- in place of schem:")}`,
    "  npm run schem -- draw examples/led.schem.json",
  );
  return lines.join("\n");
}

/** `schem <command> --help`. Undefined for an unknown command. */
export function commandHelp(name: string, style: Style = PLAIN): string | undefined {
  const c = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (c === undefined) return undefined;
  const s = style;
  const lines: string[] = [`${s.bold(`schem ${name}`)}: ${c.summary.charAt(0).toLowerCase()}${c.summary.slice(1)}`, "", heading("Usage:", s)];
  const lead = `  schem ${name} `;
  for (const u of c.usage) lines.push(u.startsWith(" ") ? " ".repeat(lead.length) + u.trim() : `  schem ${u}`);
  // Sentences run together into one paragraph; a list such as "Themes: ..." starts its own.
  const paragraphs: string[][] = [];
  for (const sentence of c.about) {
    if (paragraphs.length === 0 || /^[A-Z][a-z]+: /.test(sentence)) paragraphs.push([]);
    paragraphs.at(-1)!.push(sentence);
  }
  for (const p of paragraphs) lines.push("", ...wrapWords(p.join(" ").split(" "), 80, "  "));
  if (c.options.length) {
    lines.push("", heading("Options:", s));
    const options: Array<[string, string]> = [...c.options, ["-h, --help", "Show this help"]];
    lines.push(...table(options.map(([flag, text]) => [s.cyan(flag), text]), { style: s }));
  }
  lines.push("", heading("Examples:", s), ...c.examples.map((e) => `  schem ${e}`));
  lines.push("", heading("Exit codes:", s), ...table(c.exits.map(([code, text]) => [s.bold(code), text]), { style: s }));
  return lines.join("\n");
}

/** One usage line for error messages: "Usage: schem draw <file> ...". */
export function usageLine(name: string): string | undefined {
  const c = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  return c ? `Usage: schem ${c.usage[0]}` : undefined;
}
