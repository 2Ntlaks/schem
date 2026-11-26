// The human side of the command line: grouped help, per-command help, typo suggestions,
// readable output for check, components, component, query and describe, and ANSI styling that
// only appears when asked for. src/cli-ui.ts holds the helpers; src/cli.ts uses them.
//
// Calls run() directly, except for two spawned processes that check the installed entry point
// (src/bin.ts) prints the same grouped help and never styles piped output.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { run, type Io } from "../src/cli.js";
import {
  closest, colorWanted, COMMANDS, commandHelp, createStyle, editDistance, fitList, mainHelp, num, stripAnsi, table, visibleWidth,
} from "../src/cli-ui.js";
import { TOOLS } from "../src/mcp/tools.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), "schem-cli-ux-"));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const PICO = join(ROOT, "examples", "pico-i2c-oled.schem");
const LED = join(ROOT, "examples", "led.schem");
const FINDINGS = join(ROOT, "tests", "dsl-corpus", "bench", "differentiator.schem");
const ESC = "\x1b[";

interface Captured { code: number; out: string; err: string; outLines: string[] }

function cli(argv: string[], extra: Partial<Io> = {}): Captured {
  const out: string[] = [], err: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), ...extra });
  return { code, out: out.join("\n"), err: err.join("\n"), outLines: out.join("\n").split("\n") };
}

function json(argv: string[], extra: Partial<Io> = {}): { code: number; body: Record<string, unknown>; raw: string } {
  const r = cli([...argv, "--json"], extra);
  return { code: r.code, body: JSON.parse(r.out) as Record<string, unknown>, raw: r.out };
}

describe("schem --help", () => {
  const help = cli(["--help"]);

  it("groups the commands by workflow and keeps every line within 80 columns", () => {
    expect(help.code).toBe(0);
    const headings = ["Usage:", "Create & Import:", "Draw & Export:", "Inspect & Query:", "Edit & Format:", "MCP Server (AI Agents):"];
    let last = -1;
    for (const h of headings) {
      const at = help.out.indexOf(h);
      expect(at, h).toBeGreaterThan(last);
      last = at;
    }
    for (const line of help.outLines) expect(line.length, line).toBeLessThanOrEqual(80);
  });

  it("lists each command under its group as schem <cmd>, not npm run schem -- <cmd>", () => {
    const groups: Record<string, string[]> = {
      "Create & Import:": ["init", "import"],
      "Draw & Export:": ["draw", "watch", "render", "preview"],
      "Inspect & Query:": ["check", "describe", "query", "components", "component"],
      "Edit & Format:": ["edit", "undo", "fmt"],
    };
    const blocks = help.out.split("\n\n");
    for (const [title, names] of Object.entries(groups)) {
      const block = blocks.find((b) => b.startsWith(title));
      expect(block, title).toBeDefined();
      const firstWords = block!.split("\n").slice(1).map((l) => l.trim().split(" ")[0]);
      expect(firstWords).toEqual(names);
    }
    expect(help.out).toContain("schem <command> --help");
    expect(help.out.match(/npm run schem -- /g)).toHaveLength(2);
  });

  it("names the MCP server with the exact tool list from src/mcp/tools.ts", () => {
    expect(help.out).toContain("mcp [--root <folder>]...");
    expect(help.out).toContain(`Serve the ${TOOLS.length} schem tools`);
    const tools = help.out.slice(help.out.indexOf("Tools:")).split("\n\n")[0]!.replace("Tools:", "").split(/[\s,]+/).filter(Boolean);
    expect(tools).toEqual(TOOLS.map((t) => t.name));
  });

  it("is the same text for no arguments, -h, --help and help", () => {
    for (const argv of [[], ["-h"], ["help"]]) expect(cli(argv).out).toBe(help.out);
  });

  it("is plain text when color is off and styled when color is on", () => {
    expect(help.out).not.toContain(ESC);
    const styled = cli(["--help"], { color: true });
    expect(styled.out).toContain(ESC);
    expect(stripAnsi(styled.out)).toBe(help.out);
  });
});

describe("per-command help", () => {
  const names = Object.keys(COMMANDS);

  it("covers every CLI command", () => {
    expect(names.sort()).toEqual(["check", "component", "components", "describe", "draw", "edit", "fmt", "import", "init", "preview", "query", "render", "undo", "watch"]);
  });

  for (const name of ["init", "import", "draw", "watch", "render", "preview", "check", "describe", "query", "components", "component", "edit", "undo", "fmt"]) {
    it(`schem ${name} --help, -h and help ${name} show usage, options, examples and exit codes`, () => {
      const long = cli([name, "--help"]), short = cli([name, "-h"]), word = cli(["help", name]);
      for (const r of [long, short, word]) {
        expect(r.code).toBe(0);
        expect(r.err).toBe("");
        expect(r.out).toBe(long.out);
      }
      for (const part of ["Usage:", `schem ${name} `, "Options:", "Examples:", "Exit codes:", "-h, --help"]) expect(long.out, part).toContain(part);
      for (const line of long.outLines) expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(80);
      expect(long.out).not.toContain(ESC);
    });
  }

  it("does not run the command when --help is given", () => {
    const r = cli(["render", LED, "-o", join(WORK, "never.svg"), "--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--dpi <N>");
    expect(() => readFileSync(join(WORK, "never.svg"))).toThrow();
  });

  it("lists the templates and themes the engine really has", () => {
    expect(cli(["init", "--help"]).out).toContain("led, divider, opamp, regulator, i2c, bjt-amp");
    expect(cli(["draw", "--help"]).out).toContain("clean, dark, blueprint, textbook, mono-print");
  });

  it("prints the MCP server help for help mcp and mcp --help", () => {
    for (const argv of [["help", "mcp"], ["mcp", "--help"]]) {
      const r = cli(argv);
      expect(r.code).toBe(0);
      expect(r.out).toContain("schem mcp");
      for (const tool of TOOLS) expect(r.out).toContain(tool.name);
    }
  });

  it("returns help as one JSON object with --json", () => {
    const r = json(["check", "--help"]);
    expect(r.code).toBe(0);
    expect(r.body).toMatchObject({ status: "help", command: "check" });
    expect(String(r.body.help)).toContain("Usage:");
    expect(r.raw).not.toContain(ESC);
  });
});

describe("typos", () => {
  it.each([["drw", "draw"], ["chck", "check"], ["imprt", "import"], ["rendr", "render"], ["componnets", "components"], ["undoo", "undo"]])(
    "schem %s suggests %s and exits 2",
    (typo, command) => {
      const r = cli([typo]);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toContain(`Unknown command "${typo}". Did you mean "${command}"?`);
      expect(r.err).toContain('Run "schem --help" for commands.');
      expect(r.err).not.toContain("    at ");
    },
  );

  it("suggests nothing for a word that is not close to any command", () => {
    const r = cli(["nonsense"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown command "nonsense".');
    expect(r.err).not.toContain("Did you mean");
  });

  it("help <typo> suggests the command too", () => {
    const r = cli(["help", "drw"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Did you mean "draw"?');
  });

  it("keeps --json usage errors as pure JSON", () => {
    const r = json(["drw"]);
    expect(r.code).toBe(2);
    expect(r.body).toEqual({ error: 'Unknown command "drw". Did you mean "draw"?', status: "usage" });
  });

  it("suggests the closest option for a mistyped flag, with the command's usage line", () => {
    const draw = cli(["draw", LED, "--them", "dark"]);
    expect(draw.code).toBe(2);
    expect(draw.err).toContain('Unknown option "--them". Did you mean "--theme"?');
    expect(draw.err).toContain("Usage: schem draw <file>");
    expect(draw.err).toContain('Run "schem draw --help"');
    const check = cli(["check", LED, "--detial", "brief"]);
    expect(check.code).toBe(2);
    expect(check.err).toContain('Did you mean "--detail"?');
  });

  it("closest() and editDistance() behave as expected", () => {
    expect(editDistance("drw", "draw")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(closest("drw", ["draw", "watch"])).toBe("draw");
    expect(closest("zzzz", ["draw", "watch"])).toBeUndefined();
    expect(closest("comp", ["component", "components"])).toBeUndefined();
    expect(closest("prev", ["preview", "render"])).toBe("preview");
  });
});

describe("schem check (human output)", () => {
  const r = cli(["check", PICO]);

  it("starts with the path and a valid badge, then the counts", () => {
    expect(r.code).toBe(0);
    expect(r.outLines[0]).toMatch(/pico-i2c-oled\.schem {2}valid$/);
    expect(r.outLines[1]).toBe("  6 parts, 6 nets. 0 errors, 0 warnings, 0 notes.");
  });

  it("shows rounded metrics with units instead of raw JSON", () => {
    expect(r.out).not.toMatch(/[{}]/);
    expect(r.out).not.toMatch(/\d\.\d{3,}/);
    expect(r.out).toMatch(/Sheet +83 x 41 G/);
    expect(r.out).toMatch(/Wire length +145 G/);
    expect(r.out).toMatch(/Crossings +1\b/);
    expect(r.out).toMatch(/Bends +5\b/);
    expect(r.out).toMatch(/Dots +2\b/);
    expect(r.out).toMatch(/Jogs +0\b/);
    expect(r.out).toMatch(/Squeezed runs +0\b/);
    expect(r.out).toMatch(/Far labels +0\b/);
    expect(r.out).toMatch(/Min dot spacing +9\.2 G/);
    expect(r.out).toMatch(/Aspect error +0\.42/);
    expect(r.out).toMatch(/Margin imbalance +0\.58/);
    expect(r.out).toContain("Findings  none");
  });

  it("lists findings with severity, id, message and the attached fix", () => {
    const f = cli(["check", FINDINGS]);
    expect(f.code).toBe(0);
    expect(f.out).toContain("Findings (1)");
    expect(f.out).toMatch(/info {2}L-squeezedRuns/);
    expect(f.out).toContain("Readability: wires of different nets squeezed onto adjacent tracks");
    expect(f.out).toContain("fix: setSpacing");
    expect(f.out).toContain("warning: W410");
    expect(f.out).toMatch(/Min crossing to dot +none/);
  });

  it("--detail brief stops after the counts", () => {
    const b = cli(["check", PICO, "--detail", "brief"]);
    expect(b.outLines).toHaveLength(2);
  });

  it("keeps --json output exactly as before (full metrics, no rounding)", () => {
    const j = json(["check", PICO]);
    expect(j.code).toBe(0);
    expect((j.body.metrics as Record<string, unknown>).minDotSpacing).toBeCloseTo(9.2195, 3);
    expect(j.raw).not.toContain(ESC);
  });
});

describe("schem components and component (human output)", () => {
  it("prints aligned columns and a next-page hint", () => {
    const r = cli(["components", "--limit", "10"]);
    expect(r.code).toBe(0);
    expect(r.outLines[0]).toMatch(/^ {2}Type +Kind +Pins \/ Details$/);
    const rows = r.outLines.slice(1, 11);
    const kindColumn = r.outLines[0]!.indexOf("Kind");
    for (const row of rows) expect(row.charAt(kindColumn - 1), row).toBe(" ");
    expect(rows.every((row) => row.charAt(kindColumn) !== " ")).toBe(true);
    expect(r.out).toContain("Showing 1 to 10 of");
    expect(r.out).toContain("More: schem components --limit 10 --cursor 10");
  });

  it("keeps wide modules on one short line", () => {
    const r = cli(["components", "module", "--limit", "50"]);
    expect(r.code).toBe(0);
    for (const line of r.outLines) expect(line.length, line).toBeLessThanOrEqual(80);
    expect(r.out).toMatch(/module:arduino-uno-r3 +module +Arduino UNO R3 \(44 pins\)/);
    expect(r.out).not.toContain("IOREF");
  });

  it("fits long pin lists to the terminal width with (+N more)", () => {
    const list = Array.from({ length: 44 }, (_, i) => `P${i}`);
    const fitted = fitList(list, 30);
    expect(fitted.length).toBeLessThanOrEqual(30);
    expect(fitted).toMatch(/\(\+\d+ more\)$/);
    expect(fitList(["a", "b"], 30)).toBe("a, b");
  });

  it("says when nothing matches", () => {
    const r = cli(["components", "no-such-thing"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('No part types match "no-such-thing"');
  });

  it("shows one component with a header and an aligned pin table", () => {
    const r = cli(["component", "module:ssd1306-oled-i2c"]);
    expect(r.code).toBe(0);
    expect(r.outLines[0]).toBe("module:ssd1306-oled-i2c  SSD1306 I2C OLED Display");
    expect(r.out).toMatch(/Kind +module/);
    expect(r.out).toMatch(/Ref prefix +OLED/);
    expect(r.out).toMatch(/Docs +https:\/\//);
    expect(r.out).toMatch(/Interfaces +i2c\.scl, i2c\.sda/);
    expect(r.out).toContain("Pins (4)");
    expect(r.out).toMatch(/Pin +Name +Role +Aliases \/ Group \/ Interface/);
    expect(r.out).toMatch(/2 +VCC +power_in +aliases 3V3, VDD/);
    expect(r.out).toMatch(/3 +SDA +bidir +iface i2c\.sda/);
  });

  it("keeps the component --json body unchanged", () => {
    const j = json(["component", "led"]);
    expect(j.body).toMatchObject({ id: "led", refPrefix: "D" });
  });
});

describe("schem query (human output)", () => {
  it("shows a part with its pins and nets as a table", () => {
    const r = cli(["query", PICO, "part", "OLED1"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("{");
    expect(r.outLines[0]).toBe("Part OLED1  type: module:ssd1306-oled-i2c  at: (66, 27)  rot: 0");
    expect(r.out).toMatch(/Pin +Name +Role +At +Dir +Net/);
    expect(r.out).toMatch(/1 +GND +ground +\(73, 35\) +down +GND \(n2\)/);
    expect(r.out).toMatch(/2 +VCC +power_in +\(77, 27\) +up +3V3 \(n3\)/);
  });

  it("shows a net with its endpoints and pins", () => {
    const r = cli(["query", PICO, "net", "SDA"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("{");
    expect(r.outLines[0]).toBe("Net SDA  id: n4  kind: signal  drawn: wire");
    expect(r.out).toContain("endpoints: OLED1[3], R1[2], U1[6]");
    expect(r.out).toMatch(/OLED1 +3 +\(73, 27\) +up/);
  });

  it("keeps --json returning the same objects", () => {
    const part = json(["query", PICO, "part", "OLED1"]).body.part as Record<string, unknown>;
    expect(part).toMatchObject({ id: "OLED1", type: "module:ssd1306-oled-i2c", at: [66, 27], rot: 0, flip: false });
    const net = json(["query", PICO, "net", "SDA"]).body.net as Record<string, unknown>;
    expect(net).toMatchObject({ id: "n4", name: "SDA", kind: "signal", endpoints: ["OLED1[3]", "R1[2]", "U1[6]"], drawn: "wire" });
  });
});

describe("schem describe (human output)", () => {
  it("shows the description, the alt text line and an aligned net table", () => {
    const alt = String(json(["describe", LED]).body.altText);
    const r = cli(["describe", LED, "--table"]);
    expect(r.code).toBe(0);
    expect(r.outLines[0]).toBe("Description");
    expect(r.out).toContain(`Alt text: ${alt}`);
    expect(r.out).toContain("Nets (3)");
    expect(r.out).toMatch(/Net +Drawn as +Pins/);
    expect(r.out).toMatch(/PWR +wires +B1\[\+\], R1\[1\]/);
  });

  it("--alt-text stays one plain line, even with color on", () => {
    const alt = String(json(["describe", LED]).body.altText);
    for (const color of [false, true]) {
      const out: string[] = [];
      const code = run(["describe", LED, "--alt-text"], { out: (s) => out.push(s), err: () => {}, color });
      expect(code).toBe(0);
      expect(out).toEqual([alt]);
    }
  });
});

describe("other commands stay readable", () => {
  it("init and fmt say what happened to which file", () => {
    const dir = mkdtempSync(join(WORK, "init-"));
    const init = cli(["init", join(dir, "blinky")]);
    expect(init.code).toBe(0);
    expect(init.outLines[0]).toMatch(/^Created .*blinky\.schem {2}valid$/);
    expect(init.out).toContain("Next: schem draw");
    const fmt = cli(["fmt", join(dir, "blinky.schem")]);
    expect(fmt.code).toBe(0);
    expect(fmt.out).toMatch(/blinky\.schem is already formatted/);
  });

  it("render reports the file, its size and format", () => {
    const dir = mkdtempSync(join(WORK, "render-")), file = join(dir, "led.schem");
    copyFileSync(LED, file);
    const svg = cli(["render", file, "-o", join(dir, "led.svg")]);
    expect(svg.code, svg.err).toBe(0);
    expect(svg.out).toMatch(/^Wrote .*led\.svg {2}SVG 33 x 18 G, [\d.]+ KB$/);
    const png = cli(["render", file, "-o", join(dir, "led.png"), "--dpi", "300"]);
    expect(png.out).toMatch(/PNG \d+ x \d+ px, 30 px per G, 300 dpi/);
  });

  it("draw keeps its one-line summary", () => {
    const dir = mkdtempSync(join(WORK, "draw-"));
    copyFileSync(LED, join(dir, "led.schem"));
    const r = cli(["draw", join(dir, "led.schem"), "-o", join(dir, "out")]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^led: valid\. Wrote .*led\.svg and .*led\.png \(\d+ ms\)$/);
  });
});

describe("ANSI styling", () => {
  const commands: string[][] = [
    ["check", PICO],
    ["components", "--limit", "5"],
    ["component", "module:ssd1306-oled-i2c"],
    ["query", PICO, "part", "OLED1"],
    ["query", PICO, "net", "SDA"],
    ["describe", LED, "--table"],
    ["render", "--help"],
  ];

  it("is off by default, so programmatic callers get plain text", () => {
    for (const argv of commands) {
      const r = cli(argv);
      expect(r.out + r.err, argv.join(" ")).not.toContain(ESC);
    }
  });

  it("is on with color: true, and stripping it gives the plain text back", () => {
    for (const argv of commands) {
      const plain = cli(argv), styled = cli(argv, { color: true });
      expect(styled.out, argv.join(" ")).toContain(ESC);
      expect(stripAnsi(styled.out)).toBe(plain.out);
    }
  });

  it("never touches --json, --version or usage errors sent as JSON", () => {
    for (const argv of [...commands.filter((a) => !a.includes("--help")).map((a) => [...a, "--json"]), ["--version"], ["drw", "--json"]]) {
      const r = cli(argv, { color: true, errColor: true });
      expect(r.out + r.err, argv.join(" ")).not.toContain(ESC);
    }
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(cli(["--version"], { color: true }).out).toBe(pkg.version);
  });

  it("styles errors only when errColor (or color) is on", () => {
    expect(cli(["drw"]).err).not.toContain(ESC);
    expect(cli(["drw"], { errColor: true }).err).toContain(ESC);
    expect(cli(["drw"], { color: true, errColor: false }).err).not.toContain(ESC);
  });

  it("colorWanted() needs a terminal, no NO_COLOR, a real TERM and no exact-output flag", () => {
    const tty = { isTTY: true };
    expect(colorWanted(tty, ["check", "x"], {})).toBe(true);
    expect(colorWanted({ isTTY: false }, ["check", "x"], {})).toBe(false);
    expect(colorWanted({}, ["check", "x"], {})).toBe(false);
    expect(colorWanted(undefined, ["check", "x"], {})).toBe(false);
    expect(colorWanted(tty, ["check", "x"], { NO_COLOR: "" })).toBe(false);
    expect(colorWanted(tty, ["check", "x"], { NO_COLOR: "1" })).toBe(false);
    expect(colorWanted(tty, ["check", "x"], { TERM: "dumb" })).toBe(false);
    expect(colorWanted(tty, ["check", "x"], { TERM: "xterm-256color" })).toBe(true);
    for (const flag of ["--json", "--alt-text", "--version"]) expect(colorWanted(tty, ["describe", "x", flag], {})).toBe(false);
  });

  it("uses only standard SGR codes, so the terminal theme picks the colours", () => {
    const styled = cli(["check", FINDINGS], { color: true }).out + cli(["--help"], { color: true }).out;
    const codes = new Set([...styled.matchAll(/\x1b\[([0-9;]*)m/g)].map((m) => m[1]));
    for (const code of codes) expect(["1", "2", "22", "31", "32", "33", "36", "39"]).toContain(code);
  });
});

describe("text helpers", () => {
  it("num() rounds without trailing zeros and shows missing values as none", () => {
    expect(num(9.219544457292889, 1)).toBe("9.2");
    expect(num(0.41758646864050925, 2)).toBe("0.42");
    expect(num(145)).toBe("145");
    expect(num(2.0, 1)).toBe("2");
    expect(num(null)).toBe("none");
    expect(num(Infinity)).toBe("none");
    expect(num(-0.0001, 1)).toBe("0");
  });

  it("table() aligns styled cells by their visible width and leaves no trailing spaces", () => {
    const s = createStyle(true);
    const lines = table([[s.bold("a"), "1"], ["long", s.green("22")]], { header: ["K", "V"], style: s });
    const plain = lines.map(stripAnsi);
    expect(plain).toEqual(["  K     V", "  a     1", "  long  22"]);
    expect(visibleWidth(lines[2]!)).toBe(10);
  });

  it("mainHelp() and commandHelp() are plain without a style", () => {
    expect(mainHelp("9.9.9")).not.toContain(ESC);
    expect(mainHelp("9.9.9")).toContain("schem 9.9.9");
    expect(commandHelp("nope")).toBeUndefined();
  });
});

describe("installed entry point (src/bin.ts)", () => {
  const bin = (args: string[], env: Record<string, string | undefined> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src", "bin.ts"), ...args], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000,
    });

  it("prints the same grouped help as run(), once, with the MCP group, and no ANSI when piped", () => {
    const r = bin(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd()).toBe(cli(["--help"]).out);
    expect(r.stdout.match(/MCP Server \(AI Agents\):/g)).toHaveLength(1);
    expect(r.stdout).not.toContain(ESC);
  }, 60_000);

  it("suggests a command for a typo and exits 2", () => {
    const r = bin(["drw"], { NO_COLOR: "1" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Did you mean "draw"?');
    expect(r.stderr).not.toContain(ESC);
  }, 60_000);
});
