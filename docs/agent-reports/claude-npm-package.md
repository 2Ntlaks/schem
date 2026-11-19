# Report: claude/npm-package

Branch `claude/npm-package`, made from `main` at `3fa8f8e`. Work was done in a separate git worktree (`.claude/worktrees/npm-package`), because the main checkout had another agent's uncommitted change to `src/layout/layout.ts`. Nothing was pushed, merged, tagged or published.

## Read this first: the name `schem` is taken on npm

`npm view schem` shows a package `schem@1.0.0-preview2` owned by `uneco`, published in 2022: 545 bytes, "Proprietary", no dependencies, no executable. So today:

- `npx schem ...` downloads that package and fails (it has no command). It does not run this project.
- `npm publish` under the name `schem` would be refused, because the owner of the name is someone else.

I kept the name `schem` everywhere as the brief asked. `docs/install.md` and the README say plainly that the package is not on npm yet and lead with the install-from-clone path, which works today and is tested. The name report below lists free alternatives. Whatever name is chosen, the command can stay `schem` (see open question 1).

## Milestones

| | Milestone | Commit | Done |
| --- | --- | --- | --- |
| M1 | Build: `npm run build` bundles `src/bin.ts` to `dist/schem.js` | `9236799` | yes |
| M2 | Package fields in `package.json` | `9554611` | yes |
| M3 | `npm run pack:smoke` and a CI job on Windows and Linux | `cef1711` | yes (Linux run only in CI, see below) |
| M4 | `docs/install.md` and a README Install section | `4de74e4` | yes |
| M5 | `release.yml` (manual only) and the name report | `cad0705` | yes |

## What I did

**M1. Build.** `src/bin.ts` is the new entry: `schem mcp ...` goes to the MCP server's `main()`, anything else to the CLI's `run()`. `src/cli.ts` has no `mcp` command and I did not edit it. On `--help`, the bin prints the CLI help and then three lines about `schem mcp`. `scripts/build.ts` bundles it with esbuild (ESM, `node22`, `#!/usr/bin/env node` banner).

I found every file the engine reads from disk at run time (grep for `readFileSync`, `readdirSync`, `createRequire`, `import.meta`, `new URL(`) and handled each in the build:

| Read at run time | From source | In the bundle |
| --- | --- | --- |
| DejaVuSans.ttf (`src/text/font-file.ts`) | `dejavu-fonts-ttf` package via `createRequire` | copied to `dist/fonts/DejaVuSans.ttf` with its licence; a build-time stand-in for `font-file.ts` reads it from there |
| module library `src/modules/*.json` (`src/modules/files.ts`) | the JSON files next to `files.ts` | written into the bundle as text, the same way the playground build does it |
| `package.json` version, `src/cli.ts` | `../package.json` | unchanged: from `dist/` that is already the package root |
| `package.json` version, `src/mcp/server.ts` | `../../package.json` | rewritten to `../package.json` at build time |

Two more build-time rewrites: `src/cli.ts` and `src/mcp/main.ts` each start themselves when `process.argv[1]` is their own file. In one bundle both would match (on Windows the npm shim runs `node dist/schem.js` directly), so both would run. The build makes their `isEntryPoint()` return `false`; `src/bin.ts` decides. Every rewrite is an exact text match that must occur once, or the build fails with a message naming the file, so a later change to those files cannot break the package silently.

Because only the build needs it, `dejavu-fonts-ttf` (12 MB installed) moved from `dependencies` to `devDependencies`. The tests, `tsx` scripts and the playground still find it in `node_modules`.

**M2. Package.** `package.json`: removed `private`; added `bin` (`schem` to `dist/schem.js`), `files`, `exports` (`./package.json` only, because there is no library API yet: importing the bundle would run the CLI), `keywords`, `homepage`, `bugs`, `repository`, `prepack: npm run build`; kept `description` (reworded), `license: MIT`, `engines: node >=22` and the name. `files` is `dist/`, the three format docs the CLI's own messages point to (`docs/netlist-format.md`, `docs/parts.md`, `docs/editing.md`), `docs/install.md` and `examples/*.schem.json` with `examples/README.md`. npm adds `README.md`, `LICENSE` and `package.json` itself.

Runtime dependencies are exactly what the bundle imports: `@resvg/resvg-js` (native PNG renderer, cannot be bundled) and `opentype.js`. The build checks this every time: it fails if the bundle imports a package that `dependencies` does not list, or if `dependencies` lists one the bundle never imports. No dependency was added.

**M3. Proof by clean install.** `scripts/pack-smoke.ts` (`npm run pack:smoke`) runs `npm pack` (which builds through `prepack`) into a temporary folder outside the repo, then:

1. installs the tarball into an empty project (only `schem` in its dependencies) and with `node_modules/.bin/schem`: checks `--version`; draws `led`, `esp32-relay` (uses the module library) and `summing-amp` and checks the SVG **and PNG** are byte-identical to the repo's own `src/cli.ts` output; starts `schem mcp --root <folder>` over stdio, sends `initialize`, `notifications/initialized`, `tools/list`, `schem_create` and `schem_render`, and checks serverInfo and instructions, that the tool list equals the repo's `TOOLS`, that create reports `valid` with the same revision and layoutToken as the repo's server run in-process, and that the rendered SVG is byte-identical;
2. repeats all of that through `npx --yes --package <tarball> -- schem ...` in an empty folder (no `package.json`, no `node_modules`), which is the closest thing to `npx schem` without publishing;
3. installs from the clone with `npm install --global --prefix <temp> <repo>` (the documented `npm install -g .`, into a temporary prefix so the real global folder is untouched) and draws the three examples again. That global install is a link back to the repo, so the script removes it with `npm uninstall -g` before deleting the temporary folder.

`.github/workflows/ci.yml` has a new `pack-smoke` job (Windows and Linux, Node 22). The existing `test` and `same-output` jobs are unchanged.

**M4. Install docs.** `docs/install.md`: install from a clone (works today), `npx` and `npm install -g` for after publishing, the MCP server's real options, and setup for Claude Code, Claude Desktop, Cursor, VS Code and Codex CLI. README: an "Install" section after "Quick start".

The brief mentions a `--roots` option. `src/mcp/server.ts` has no `--roots`: its options are `--root <folder>` (repeatable; default the folder the server started in) and `--help`/`-h`. The docs use `--root`.

**M5. Release workflow.** `.github/workflows/release.yml` runs only from a manual "Run workflow" (`workflow_dispatch`). It runs typecheck, tests, phase0 and pack:smoke on Windows and Linux, checks that it was started from the tag `v<version>` matching `package.json`, then runs `npm publish --dry-run --provenance --access public`, or the real `npm publish --provenance --access public` (with `NODE_AUTH_TOKEN` from the `NPM_TOKEN` secret) only when the "publish" box is ticked. The comment at the top explains how to switch it to tag-triggered runs.

## Files changed

```
 .github/workflows/ci.yml      |  17 +++   new pack-smoke job only
 .github/workflows/release.yml |  80 +++   new
 .gitignore                    |   2 +     dist/ and *.tgz
 README.md                     |  13 ++    Install section
 docs/install.md               | 159 +++   new
 package-lock.json             |   6 +-    bin entry; dejavu-fonts-ttf now dev
 package.json                  |  45 ++-
 scripts/build.ts              | 133 +++   new
 scripts/pack-smoke.ts         | 287 +++   new
 src/bin.ts                    |  31 +++   new entry file (the only change under src/)
```

No existing test, `phase0/`, `tests/fixtures/`, `bench/` or `SPEC.md` file was touched. Nothing under the held-out test paths was opened or run.

## Checks

Baseline on `main` (`3fa8f8e`) before any change, in the fresh worktree after `npm ci`: typecheck exit 0; `npm test` 25 files, 585 tests passed; `npm run phase0` 8 of 8 validation cases `valid`.

Every milestone commit was checked with typecheck, test and phase0 (and pack:smoke from M3 on); all passed each time. Output on the final code commit `cad0705` (Windows 11, Node 24.14.0, npm 11.9.0):

`npm run typecheck`
```
> schem@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```
(exit 0, no errors)

`npm test`
```
 Test Files  25 passed (25)
      Tests  585 passed (585)
```

`npm run phase0` (validation cases)
```
case01-led                     valid                              valid     0        0    0    156
case02-divider-buffer          valid                              valid     0        0    0    30
case03-summing                 valid                              valid     0        0    0    26
case04-hbridge                 valid                              valid     0        0    0    204
case05-i2c                     valid                              valid     0        0    0    12
case06-esp32-relay             valid                              valid     0        0    0    18
case07-two-ic-decoupling       valid                              valid     0        0    0    18
case08-diffpair                valid                              valid     0        0    0    10
```

`npm run pack:smoke`
```
pack:smoke in C:\Users\ntlak\AppData\Local\Temp\schem-smoke-5L8qpv
  ok 1  npm pack: schem-0.0.1.tgz, 498.4 kB packed, 1197.0 kB unpacked, 19 files
  ok 2  npm install <tarball> into an empty project: node_modules/.bin/schem exists
  ok 3  schem --version: 0.0.1
  ok 4  installed: draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
  ok 5  installed: mcp initialize: serverInfo schem 0.0.1, same instructions as the repo
  ok 6  installed: mcp tools/list: schem_create, schem_edit, schem_check, schem_preview, schem_query, schem_render, identical to the repo
  ok 7  installed: mcp schem_create (status valid, same revision and layoutToken) then schem_render: SVG byte-identical to the repo's server
  ok 8  npx --package <tarball> schem --version in an empty folder: 0.0.1
  ok 9  npx: draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
  ok 10  npx: mcp initialize: serverInfo schem 0.0.1, same instructions as the repo
  ok 11  npx: mcp tools/list: schem_create, schem_edit, schem_check, schem_preview, schem_query, schem_render, identical to the repo
  ok 12  npx: mcp schem_create (status valid, same revision and layoutToken) then schem_render: SVG byte-identical to the repo's server
  ok 13  npm install -g . from the clone (temporary prefix): schem --version 0.0.1
  ok 14  clone install (npm install -g .): draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
pack:smoke passed: schem-0.0.1.tgz, 498.4 kB, 19 files
```

Other checks I ran by hand:

- **The drawing from the installed package**: I opened `esp32-relay.png` drawn by the installed `schem` (M3 run). It shows the ESP32 module, R1/R2 divider, Q1, D1 across the relay coil, K1 contacts to J1, with all labels and pin names readable. It is byte-identical to the repo's drawing.
- **Node 22**: CI uses Node 22, my machine has 24. I ran `dist/schem.js` with Node 22.23.5 (downloaded into the scratch folder, not the repo): `summing-amp` SVG and PNG were byte-identical to the source run on Node 24, and `schem mcp` answered `initialize` and `tools/list`.
- **`npm link`**: with `NPM_CONFIG_PREFIX` set to a temporary folder, `npm link` in the repo made a working `schem` command; `led` was byte-identical; removed afterwards with `npm uninstall -g`.

### Tarball: 498.4 kB packed, 1197.0 kB unpacked, 19 files

```
    1068  LICENSE
   12421  README.md
  757076  dist/fonts/DejaVuSans.ttf
    8816  dist/fonts/LICENSE-DejaVu.txt
  399533  dist/schem.js
    7338  docs/editing.md
    5808  docs/install.md
    6186  docs/netlist-format.md
    4772  docs/parts.md
    2383  examples/esp32-relay.schem.json
    4268  examples/h-bridge.schem.json
    3203  examples/i2c-sensors.schem.json
     874  examples/led.schem.json
    1724  examples/README.md
    1614  examples/relaxation-oscillator.schem.json
    2603  examples/sallen-key-filter.schem.json
    2003  examples/summing-amp.schem.json
    1997  examples/wien-bridge.schem.json
    2024  package.json
```

An install into an empty project adds 5 packages: `schem`, `@resvg/resvg-js` with the one prebuilt binary for the system (about 4.4 MB on Windows x64), `opentype.js` and its two small dependencies.

## Not done or not verified

- **Linux was not run locally.** This machine has no WSL distribution and no Docker. The `pack-smoke` CI job covers Linux, but it runs only after a push, which I may not do. The script handles both systems (on Windows, `.cmd` shims run through the shell with quoted arguments; on Linux the bins run directly).
- **The MCP client snippets were not tried inside each client.** Doing so would change the owner's Claude Code, Claude Desktop, Cursor, VS Code or Codex settings. What is tested is the server those snippets start: `schem mcp --root` over stdio, from the tarball, from npx and from the clone. I checked `claude mcp add --help` on this machine to confirm the `claude mcp add <name> -- <command> [args...]` form and the `--scope` option. Codex CLI is not installed here, so its `config.toml` table and `codex mcp add` line come from its documentation, not from a run. The Windows `cmd /c npx` advice for Claude Code and Claude Desktop is a known need for those clients on native Windows; I did not run it.
- **`npx schem` from the registry** cannot be tested before publishing (and the name is taken). The npx test uses the tarball instead.

## Name report

`npm view schem`: **taken**. `schem@1.0.0-preview2`, owner `uneco`, 545 bytes, proprietary, no command, published 2022 and never updated. npm has a dispute process for unused names, but that is the owner's call. Also, on npm "schem" mostly means Minecraft: `.schem` is a Minecraft schematic file format, and `npm search schem` returns Minecraft tools (`mineflayer-schem`, `schematic2schem`, `craftmatic`). A scope `@schem` also exists (`@schem/api-endpoint`).

Free names, each checked with `npm view <name>` (404), and also with the dots and hyphens removed, since npm refuses a new name that matches an existing one once punctuation is stripped:

| Name | Also free stripped | Note |
| --- | --- | --- |
| `schem-cli` | `schemcli` | Keeps the project's name; the command stays `schem`. Still shares the Minecraft "schem" search results. |
| `schem-mcp` | `schemmcp` | Keeps the name and says "for agents"; undersells the CLI a little. |
| `netlist-schematic` | `netlistschematic` | Says exactly what it does, and finds well in npm search; no existing project of that name found. |
| `schemwright` | | Distinct and brandable, no clash found on npm; the "-wright" echoes Playwright, which may or may not be wanted. |
| `@2ntlaks/schem` | | A scoped name keeps `schem` exactly. It needs an npm user or organisation called `2ntlaks` (I could not check who owns that scope; `npm view @2ntlaks/schem` is 404). Scoped packages publish with `--access public`, which `release.yml` already passes. |

For all of these, the `bin` can stay `schem`. With one bin, `npx <package-name> draw x.json` runs it directly, and `npm install -g <package-name>` gives the `schem` command. Nothing was renamed.

## Open questions

1. **The npm name** (above). When it is chosen, update `name` in `package.json`, the `npx`/`npm install -g` lines and the warning box in `docs/install.md`, and the README Install section. If the name differs from `schem`, the MCP snippets become `npx -y <package-name> mcp ...`.
2. **Help text from `src/cli.ts` and `src/mcp/server.ts`** still says `npm run schem -- draw ...` and `npm run mcp`, which is wrong for an installed command. That text is in files another agent is changing, so I did not edit it. Suggested change for that agent: say `schem draw ...` and `schem mcp ...` in USAGE and HELP. The bin adds the `schem mcp` lines to `--help` until then. If the CLI later gets its own `mcp` command, `src/bin.ts` can shrink to the CLI alone.
3. **The build rewrites three source files' text** (`isEntryPoint` in `src/cli.ts` and `src/mcp/main.ts`, the package.json path in `src/mcp/server.ts`). The build fails loudly if they stop matching, but a cleaner fix for the owners of those files would be: export `main`/`run` from a module that does not start itself, and read the version from a single shared helper. Then `scripts/build.ts` needs no rewrites.
4. **The README ships in the package.** Its Install section says "not on npm yet"; reword it when publishing. Its images use relative links (`docs/assets/...`), and `docs/assets/` is not in the package; check after publishing that they show on npmjs.com, or switch them to absolute GitHub URLs.
5. **Installing straight from GitHub** (`npm install -g github:2Ntlaks/schem`) does not work, because `dist/` is not committed and there is no `prepare` script. Adding `"prepare": "npm run build"` would make it work but would also run the build on every `npm ci` in the repo and in CI. I left it out; say if you want it.
6. **No library API.** `exports` exposes only `package.json`. If schem should also be importable (`import { layout } from "schem"`), that needs a separate entry and type declarations.
