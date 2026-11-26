# Phase 1 symbols report

- Branch: `t3/84709191`
- Worktree: `C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-84709191-bcb2ca246248194b`
- Commits (before this report commit):
  - `08f8e9f` Add 5 Phase 1 symbols: current-source, lamp, speaker, photodiode, spdt
  - `ba6b77f` Add test circuits and convention checks for Phase 1 symbols
  - `6852f24` Regenerate docs/parts.md for Phase 1 symbols

## What was done

1. Drew 5 original (`source: "original"`) IEEE-style schematic symbols in `src/symbols/library.ts` and registered them in `BUILTIN`:
   - `current-source`: DC current source (`kind: "source"`, `refPrefix: "I"`). Circle (radius 1.2 G) with an arrow pointing towards pin `+`. Pins `+` (aliases `pos`, `p`, `1`, `dir: "left"`, `role: "output"`, `chain: "out"`) at `[0, 0]` and `-` (aliases `neg`, `n`, `2`, `dir: "right"`, `role: "output"`, `chain: "in"`) at `[6, 0]`. Matches `vsource` geometry so the layout engine stands it vertical with `+` and the arrow pointing up.
   - `lamp`: Indicator or incandescent lamp (`kind: "two-pin"`, `refPrefix: "LA"`). Circle (radius 1.2 G) with a 45-degree cross inside. Pins `1` at `[0, 0]` and `2` at `[6, 0]`.
   - `speaker`: Loudspeaker (`kind: "two-pin"`, `refPrefix: "LS"`). Rectangular driver housing with a flaring trapezoid cone on the front and a `+` polarity mark beside the positive lead. Pins `+` (aliases `pos`, `p`, `1`) at `[0, 0]` and `-` (aliases `neg`, `n`, `2`) at `[6, 0]`.
   - `photodiode`: Photodiode (`kind: "two-pin"`, `refPrefix: "D"`). Diode body matching `led` proportions with two inward light arrows. Pins `A` (`anode`; aliases `a`, `+`, `1`) at `[0, 0]` and `K` (`cathode`; aliases `k`, `-`, `2`) at `[4, 0]`.
   - `spdt`: Single-pole double-throw switch (`kind: "switch"`, `refPrefix: "SW"`). Three contact circles with a resting switch lever pivoting from `COM` to touch `NC` while leaving `NO` open. Pins `COM` (aliases `com`, `c`, `1`) at `[0, 0]` (`dir: "left"`), `NO` (aliases `no`, `2`) at `[4, -1]` (`dir: "right"`), and `NC` (aliases `nc`, `3`) at `[4, 1]` (`dir: "right"`).
2. Added a minimal `sym.kind === "switch"` default orientation rule to `defaultOrient` in `src/layout/kinds.ts`: keeps `COM` on the left and `NO`/`NC` on the right (`rot: 0, flip: false`), mirroring horizontally only when `COM` feeds to the right and `NO`/`NC` come from the left. All existing symbol kinds are unchanged.
3. Added 5 realistic small test circuits to `tests/support/symbol-circuits.ts`: `current-source-load`, `lamp-indicator`, `speaker-driver`, `photodiode-sensor`, and `spdt-selector`.
4. Appended registration, alias, and drawing-convention assertions for all 5 symbols to `tests/symbols.test.ts` without modifying existing tests.
5. Ran `npm run draw:symbols` (which renders the symbol sheet and every symbol circuit to PNG files), visually inspected `out/symbols/sheet.png` and all 5 new circuit PNGs, tightened the `spdt` lever endpoint and simplified `lamp-indicator` and `speaker-driver` to eliminate a wire short-step readability notice, and re-inspected the updated PNGs.
6. Ran `npm run docs:parts` to regenerate `docs/parts.md` (35 part types).

## Visual inspection

Copies of the inspected PNGs are saved under `docs/agent-reports/img/phase1-symbols/`:

- `docs/agent-reports/img/phase1-symbols/sheet.png`
- `docs/agent-reports/img/phase1-symbols/current-source-load.png`
- `docs/agent-reports/img/phase1-symbols/lamp-indicator.png`
- `docs/agent-reports/img/phase1-symbols/speaker-driver.png`
- `docs/agent-reports/img/phase1-symbols/photodiode-sensor.png`
- `docs/agent-reports/img/phase1-symbols/spdt-selector.png`

All 5 new circuits render `valid` with 0 overlaps, 0 crossings, 0 convention warnings, and 0 readability warnings.

## Files changed

- `src/symbols/library.ts`
- `src/layout/kinds.ts`
- `tests/support/symbol-circuits.ts`
- `tests/symbols.test.ts`
- `docs/parts.md`
- `docs/agent-reports/neon-phase1-symbols.md`
- `docs/agent-reports/img/phase1-symbols/sheet.png`
- `docs/agent-reports/img/phase1-symbols/current-source-load.png`
- `docs/agent-reports/img/phase1-symbols/lamp-indicator.png`
- `docs/agent-reports/img/phase1-symbols/speaker-driver.png`
- `docs/agent-reports/img/phase1-symbols/photodiode-sensor.png`
- `docs/agent-reports/img/phase1-symbols/spdt-selector.png`

## Verification commands and exact outputs

### `npm run draw:symbols`

```text
> schem-cli@0.0.1 draw:symbols
> tsx scripts/symbols.ts

half-wave-rectifier: layout valid, verifier valid, overlaps 0, crossings 0, bends 4
npn-low-side-switch: layout valid, verifier valid, overlaps 0, crossings 1, bends 7
pnp-high-side-switch: layout valid, verifier valid, overlaps 0, crossings 0, bends 1
nmos-motor-driver: layout valid, verifier valid, overlaps 0, crossings 1, bends 7
pmos-high-side-switch: layout valid, verifier valid, overlaps 0, crossings 0, bends 1
potentiometer-dimmer: layout valid, verifier valid, overlaps 0, crossings 0, bends 3
spst-lamp-switch: layout valid, verifier valid, overlaps 0, crossings 0, bends 4
pushbutton-pull-up: layout valid, verifier valid, overlaps 0, crossings 0, bends 2
buzzer-driver: layout valid, verifier valid, overlaps 0, crossings 1, bends 7
relay-driver: layout valid, verifier valid, overlaps 0, crossings 3, bends 9
lc-low-pass: layout valid, verifier valid, overlaps 0, crossings 0, bends 4
zener-shunt: layout valid, verifier valid, overlaps 0, crossings 0, bends 2
mcu-crystal: layout valid, verifier valid, overlaps 0, crossings 0, bends 5
header-feeds-resistor: layout valid, verifier valid, overlaps 0, crossings 0, bends 2
current-source-load: layout valid, verifier valid, overlaps 0, crossings 0, bends 4
lamp-indicator: layout valid, verifier valid, overlaps 0, crossings 0, bends 4
speaker-driver: layout valid, verifier valid, overlaps 0, crossings 0, bends 4
photodiode-sensor: layout valid, verifier valid, overlaps 0, crossings 0, bends 2
spdt-selector: layout valid, verifier valid, overlaps 0, crossings 0, bends 5
sheet: 30 symbols -> out\symbols\sheet.png
```

### `npm run docs:parts`

```text
> schem-cli@0.0.1 docs:parts
> tsx scripts/parts-doc.ts

wrote docs/parts.md (35 part types)
```

### `npm run typecheck`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```

Exit code: 0.

### `npm test`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  32 passed (32)
      Tests  698 passed (698)
```

Exit code: 0.

### `npm run phase0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    179
case02-divider-buffer          valid                              valid     0        0    0    64
case03-summing                 valid                              valid     0        0    0    34
case04-hbridge                 valid                              valid     0        0    0    203
case05-i2c                     valid                              valid     0        0    0    14
case06-esp32-relay             valid                              valid     0        0    0    19
case07-two-ic-decoupling       valid                              valid     0        0    0    26
case08-diffpair                valid                              valid     0        0    0    12
```

All 8 validation cases are `valid` with 0 overlaps, 0 convention warnings, and 0 readability warnings. All 12 validation edit scripts match expectations and pass gate 4. Exit code: 0.

### `npm run bench -- --check`

```text
> schem-cli@0.0.1 bench
> tsx scripts/bench.ts --check

circuit           status                   score     was  cross  bends  wire  conv  limit  back  upstr
ce-amp            valid                     39.9    39.9      0      3    66     0      0     0      0
current-sink      valid                     28.7    28.7      0      2    49     0      0     0      0
darlington        valid                     36.3    36.3      0      5    59     0      0     0      0
debounce          valid                     25.9    25.9      0      1    49     0      0     0      0
differentiator    valid                       63      63      0      7    87     0      1     0      0
follower          valid                       31      31      0      2    45     0      0     0      0
highside          valid                     28.4    28.4      0      2    37     0      0     0      0
inamp             valid                     75.3    75.3      0     10   191     0      0     0      0
levelshift        valid                     67.9    67.9      0     12   147     0      0     0      0
mcu               valid                       72      72      0     10   140     0      0     0      0
mixer-ce          valid                     56.4    56.4      0      8    93     0      0     0      0
multivibrator     valid                     63.3    63.3      2      2    74     0      0     1      0
ne555             valid                     41.3    41.3      0      5    78     0      0     0      0
pushpull          valid                     61.3    61.3      0      7   139     0      0     0      0
regulator         valid                       37    38.9      0      5    47     0      0     0      0 better
schmitt           valid                     32.6    32.6      0      3    58     0      0     0      0
sensor-node       valid                     92.1    92.1      0      8   152     0      0     0      0
shift             valid                     53.8    53.8      0      4   122     0      0     0      0

18 circuits, 18 valid. Total score 906.2 (baseline 908.1). Images: out/bench/index.html
```

Exit code: 0.

## Open questions and notes

- `src/core/quantity.ts` (outside this task's file ownership) recognises `isource` and `fuse` for amp quantity formatting, not `current-source`. Values on `current-source` therefore render verbatim (for example `"10 mA"` renders as `10 mA`). A follow-up change can add `current-source` to `quantityOf` in `src/core/quantity.ts` if automatic SI formatting of values like `"10m"` is wanted.
- The `regulator` bench circuit already scored `37` (vs baseline `38.9`) on `main` from commit `5d52854`; none of the 18 bench drawings changed due to this work.
- Held-out test cases (`phase0/cases/test/` and `--test` scripts) were not opened, listed, read, or run.
