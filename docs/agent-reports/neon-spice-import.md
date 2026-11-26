# SPICE Netlist Importer Report

## Summary

Implemented a standard SPICE (`.cir` / `.sp` / `.net`) netlist importer in `src/io/spice.ts` that converts SPICE circuit decks into validated `schem` `LoadedProject` objects and canonical `.schem` DSL text via `formatDsl()`. Added 20 unit and end-to-end layout/verification tests in `tests/spice-import.test.ts`, rendered and visually inspected 3 sample PNGs, and documented the supported SPICE syntax in `docs/spice-import.md`.

No existing `src/` files, `phase0/` files, `tests/fixtures/` files, `SPEC.md`, or `package.json` were modified.

## Git Details

- **Branch**: `t3/4f76aa52`
- **Worktree path**: `C:\Users\ntlak\.t3\worktrees\Schematic circuit\t3-4f76aa52-026ca6d1b5116c74`
- **Commits**:
  - `0c5677e`: Add SPICE netlist importer (`src/io/spice.ts`)
  - `c896ab9`: Add SPICE importer tests and full layout verification (`tests/spice-import.test.ts`)
  - `8087e94`: Add SPICE import documentation and rendered sample PNGs (`docs/spice-import.md`, `docs/agent-reports/img/spice-import/*.png`)
  - Report commit added in the following commit (`docs/agent-reports/neon-spice-import.md`).

## Files Changed

- `src/io/spice.ts` (new): Implements `importSpice(source: string): SpiceImportResult`.
  - Preprocesses SPICE decks: first-line title detection (when not a comment, directive, or element card), `.title`, `*` full-line comments, `;` inline comments, `+` line continuations, `.end` cutoff, `.control`..`.endc` skipping, and `.subckt`..`.ends` block scoping.
  - Two-pass parsing so `.model` and `.subckt` directives work whether placed before or after elements.
  - Maps `R`, `C`, `L`, `D` (`diode`, `zener`, `schottky`, `led`), `V` (`ac-source`, `vsource`, `battery`), `I` (dynamic `BUILTIN["current-source"]` check with 2-pin `ic` fallback and warning), `Q` (`npn`/`pnp`), `M` (`nmos`/`pmos`), and `X` (`opamp` for 3-pin op-amp subcircuits, `ic` with `.subckt` pin names and inferred pin roles otherwise).
  - Maps node `0` and `GND`/`gnd` to net `GND` (`kind: "ground"`), preserves supply-named nodes (`VCC`, `VDD`, `5V`, `3V3`, `12V`, `-12V`, `VEE`, `VSS`, etc.) with inferred `kind`, merges nodes case-insensitively, sorts nets deterministically (power, ground with `GND` first, signal), validates through `validate()` and `loadProject()`, and formats canonical `.schem` text through `formatDsl()`.
- `tests/spice-import.test.ts` (new): 20 tests covering 7 realistic circuits (RC low-pass filter, voltage divider, common-emitter BJT amplifier, CMOS inverter, Schottky/Zener/LED diode rectifier and clamp, LDO subcircuit IC with `.subckt` pin names, and inverting op-amp stage), plus syntax features (`+` continuations, comments, `.title`, `.control`, `.end`, scientific notation, SPICE unit casing), deterministic net ordering, dynamic `current-source` fallback, warnings, and error cases. Every realistic circuit is verified through `layout()` (`status === "valid"`), `checkDrawing()` (layers 1 and 2, zero errors and zero overlaps), `formatDsl()` plus `compileDsl()` round-trip, and deterministic SVG rendering.
- `docs/spice-import.md` (new): Concise documentation of the API, SPICE syntax rules, element mappings, `.model`/`.subckt` rules, net naming, and an example.
- `docs/agent-reports/img/spice-import/rc-lowpass.png` (new): Rendered RC low-pass filter schematic.
- `docs/agent-reports/img/spice-import/ce-amplifier.png` (new): Rendered common-emitter BJT amplifier schematic.
- `docs/agent-reports/img/spice-import/cmos-inverter.png` (new): Rendered CMOS inverter schematic.
- `docs/agent-reports/neon-spice-import.md` (new): This report.

## Visual Inspection of Rendered PNGs

All 3 sample PNGs were generated from `importSpice()` -> `layout()` -> `toSvg()` -> `toPng()` and opened directly for visual inspection:

1. `docs/agent-reports/img/spice-import/rc-lowpass.png`:
   - `status=valid`, `checkDrawing.valid=true`, `overlaps=0`, `conventions=0`.
   - Clean closed loop with `V1 1 V` AC sine source on the left, `R1 1 kΩ` horizontal across the top, and `C1 100 nF` vertical on the right. Labels are crisp with no overlap.
2. `docs/agent-reports/img/spice-import/ce-amplifier.png`:
   - `status=valid`, `checkDrawing.valid=true`, `overlaps=0`, `conventions=0`.
   - `Vcc 12 V` drives `VCC` rail symbol; signal flows left to right from `Vin 10 mV` through `Cin 10 µF` into the `R1 47 kΩ` / `R2 10 kΩ` base divider and `Q1 2N2222` (NPN, collector up to `Rc 2.2 kΩ` and `VCC`, emitter down to `Re 470 Ω` and `GND`), then through `Cout 10 µF` to `Rl 10 kΩ`. Zero crossings and zero overlaps.
3. `docs/agent-reports/img/spice-import/cmos-inverter.png`:
   - `status=valid`, `checkDrawing.valid=true`, `overlaps=0`, `conventions=0`.
   - `Vdd 3.3 V` feeds `M1 PMOD` (PMOS on top, source up) stacked above `M2 NMOD` (NMOS on bottom, source to `GND`), `Vin 3.3 V` feeds both joined gates, and the common drain feeds `Cload 10 pF` to `GND`. Polarities, arrows, dots, and labels are all clean.

## Verification Commands and Exact Results

### `npm run typecheck`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web

Exit code: 0
```

### `npm test`

```text
> schem-cli@0.0.1 test
> vitest run

Test Files  33 passed (33)
     Tests  686 passed (686)
  Duration  22.57s

Exit code: 0
```

(`tests/spice-import.test.ts`: 20 passed out of 20.)

### `npm run phase0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    130
case02-divider-buffer          valid                              valid     0        0    0    47
case03-summing                 valid                              valid     0        0    0    14
case04-hbridge                 valid                              valid     0        0    0    159
case05-i2c                     valid                              valid     0        0    0    12
case06-esp32-relay             valid                              valid     0        0    0    21
case07-two-ic-decoupling       valid                              valid     0        0    0    18
case08-diffpair                valid                              valid     0        0    0    10

edit script                status                             expect as exp affected mode                gate 4
case03-longer-value        saved                              true   true   same     incremental         pass (untouched 8, mean 0 G, max 0 G, other routes 0)
case03-add-part            saved                              true   true   same     incremental         pass (untouched 3, mean 0 G, max 0 G, other routes 0)
case03-remove-part         saved                              true   true   differs  incremental         pass (untouched 6, mean 0 G, max 0 G, other routes 0)
case03-pin-sides           rejected (invalid_input)           either true   -        -                   -
case05-longer-value        saved                              true   true   same     incremental         pass (untouched 4, mean 1 G, max 4 G, other routes 1)
case05-add-part            saved                              true   true   differs  incremental         pass (untouched 5, mean 0 G, max 0 G, other routes 0)
case05-remove-part         saved                              true   true   same     incremental         pass (untouched 0, mean 0 G, max 0 G, other routes 0)
case05-pin-sides           saved                              true   true   same     incremental         pass (untouched 4, mean 0 G, max 0 G, other routes 0)
case07-longer-value        saved                              true   true   same     incremental         pass (untouched 9, mean 0 G, max 0 G, other routes 0)
case07-add-part            saved                              true   true   differs  incremental         pass (untouched 8, mean 0 G, max 0 G, other routes 0)
case07-remove-part         saved                              true   true   differs  incremental         pass (untouched 8, mean 0.5 G, max 4 G, other routes 0)
case07-pin-sides           saved                              true   true   same     incremental         pass (untouched 9, mean 0 G, max 0 G, other routes 0)

Exit code: 0
```

## Skipped Items and Open Questions

- `src/cli.ts` was intentionally not edited per file ownership rules; wiring `schem import` into the CLI is left to the coordinator during integration.
- `I<id>` current sources check `BUILTIN["current-source"]` dynamically at runtime. Until the `current-source` symbol branch is merged, `I<id>` maps to a 2-pin `ic` box with a warning. Once `BUILTIN["current-source"]` is present, verify its pin order matches SPICE `pos neg` (pin 0 = positive/tail, pin 1 = negative/head) or adjust if the merged symbol uses reversed pin order.
- Note: `npm ci` was run in the fresh worktree to populate `node_modules` from the existing `package-lock.json` without modifying `package.json` or `package-lock.json`.
