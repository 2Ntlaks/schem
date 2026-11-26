# Report: neon/layout-polish

- Branch: `neon/layout-polish`
- Base commit: `1e235fc` (`main`)
- Worktree path: `C:\Users\ntlak\.t3\worktrees\Schematic circuit\t3-4b3a98b2-5b240332074d76e5`

## Summary of work

Four layout improvements were implemented and verified in small commits, bringing the 18-circuit benchmark total from `906.2` on `main` (baseline `908.1`) down to `886.9` with zero regressions, and raising random-edit stability from `131/137` (`95.6%`) to `134/137` (`97.8%`).

### 1. Supply string (`186ce31`)
Ported commit `536bf02` (`claude/supply-string`):
- `src/layout/stacks.ts`: allowed a supply-to-ground string to end in a two-pin source (such as a battery) whose other pin connects straight to ground. A fuse or switch between a supply symbol and the battery that feeds it now stands directly above the battery in one vertical column.
- `src/layout/flow.ts`: marked that stacked supply block as feeding its supply rail so loads on that rail rank after it.
- `tests/supply-string.test.ts`: added the 3 supply-string tests covering `spst`, `fuse`, and a battery not grounded directly.
- Result: `sensor-node` improved from `92.1` to `77.8` (bench total `906.2 -> 891.9`), removing the two crooked wires between `B1` and `SW1`.

### 2. Top supply-pin ordering (`ed53231`)
- Diagnosed why `U1` (`Pololu D24V10F5`) and `U2` (`ESP32-DevKitC V4`) in `sensor-node` placed their supply output pins (`VOUT`/`5V` and `3V3`) to the left of their supply input pins (`VIN`/`VBAT` and `5V`): `icFor` in `src/layout/layout.ts` sorted top-edge pins alphabetically by net name (`"5V" < "VBAT"` and `"3V3" < "5V"`).
- Updated `icFor` to order top-edge pins by power role first (`power_in` before other roles, `power_out` last), keeping alphabetical and natural pin-number tie-breaking within each role.
- Verified visually on `sensor-node.png` and `regulator.png`: `U1` now shows `VBAT / VIN` on the left and `5V / VOUT` on the right; `U2` shows `5V` on the left and `3V3` on the right; `regulator` is unchanged.
- Added unit test coverage in `tests/layout-polish.test.ts`.

### 3. Astable multivibrator crossing reduction (`7351523`)
- Diagnosed `multivibrator` (`63.3`, 2 crossings, 1 backward transistor):
  - The 1 backward transistor (`Q1` facing right, base facing inward toward `Q2`) is intentional textbook symmetry and is explicitly required by two existing tests (`tests/transistor-astable.test.ts` lines 20-23 and `tests/general-layout.test.ts` lines 104-113).
  - The 2 crossings came from `ledAstable()` placing each base bias resistor (`R3` for `Q1`, `R2` for `Q2`) on its own transistor's side, forcing both cross-coupling capacitors (`C1` and `C2`) to cross the opposite bias column.
- Updated `ledAstable()` (`npn-led-astable`, bumped to `version: 2`) in `src/layout/templates/library.ts` so each bias resistor stands next to the opposite collector's timing capacitor (`R2` beside `C1`, `R3` beside `C2`). Both capacitors sit level with clean labels above, and the two base wires cross once in the centre below the capacitors, 3 G clear of every dot and with no short jogs.
- Used inequality spacing constraints on the capacitors and bias columns so longer component values do not cause interior contradictions.
- Result: `multivibrator` improved from `63.3` to `58.3` (crossings `2 -> 1`, 0 readability breaches, 0 conventions broken), lowering total bench score from `891.9` to `886.9`.
- Added unit tests in `tests/layout-polish.test.ts`.

### 4. Incremental edit stability (`4ffce4d`)
- Diagnosed the 6 unstable edits in `scripts/edit-sweep.ts` (`#28`, `#50`, `#76`, `#80`, `#89`, `#143`).
- In `src/layout/layout.ts`, `keptGap` returned the full channel gap whenever either block was in `affected`, even when both blocks existed in the previous layout and their updated envelopes still cleared each other by at least 1 G at their previous positions. That caused adding a part or wire (`#80`, `#89`, `#143`) to slide untouched neighbour columns by 1-2 G and reroute unrelated nets.
- Removed the `affected` bypass in `keptGap` so the existing overlap check (`clear`) governs whether two previous parts keep their previous gap. When an edit widens an outline into a neighbour, `clear` is false and the full gap still applies.
- Result: random-edit stability rose from `131/137` (`95.6%`) to `134/137` (`97.8%`), fixing all 3 `add part` failures (`#80`, `#89`, `#143`).
- Added unit tests for seeds `80`, `89`, and `143` in `tests/layout-polish.test.ts`.

### 5. Findings on items left unchanged (for owner decision)

#### `differentiator` readability breach (`squeezedRuns: 1` at `[42, 31]`)
- Root cause: `OPAMP_INVERTING` (and `OPAMP_NONINVERTING`, `invertingStage`) in `src/layout/templates/library.ts` do not declare `reserve: ["T"]`, unlike `sallenKey`, `RELAXATION_OSCILLATOR`, and `wienBridge` which declare `reserve: ["U"]`. Because output tap column `T` sits outside the region envelope, the next column (`U2`) is placed close enough that `n6` (`R3/R4` to `U2[IN-]`) drops along `x = 42` right next to `T` at `x = 41`.
- Tested adding `reserve: ["T"]`: `differentiator` improved `63.0 -> 58.7` (`breaches: 1 -> 0`), but three existing tests and two bench circuits blocked it:
  1. `tests/dsl-cli.test.ts:123` uses `differentiator.schem` specifically to test `preview --finding` and asserts `findings.length > 0` (the `L-squeezedRuns` breach is its only finding).
  2. `tests/opamp-templates.test.ts:180` explicitly asserts that no `opamp-*` template sets `reserve`.
  3. `tests/findings-snapshot.test.ts` (`generated-30-16`) snapshots the `L-squeezedRuns` finding and decoupling distances from an unreserved `opamp-inverting` column.
  4. `inamp` (`75.3 -> 76.6`) and `mixer-ce` (`56.4 -> 57.4`) scored slightly worse due to the extra horizontal width when no vertical wire enters from above.
- Reverted so all existing tests pass and zero bench circuits regress.

#### Incremental label-side fallback (for remaining `longer value` edits)
- Tested an incremental-mode fallback that flips an affected part's label to another clear side when its widened label would collide with an untouched neighbour.
- This fixed seed `#50`, raising stability to `135/137` (`98.5%`), leaving only `#28` and `#76` (where `D1`'s 16-character color string overlaps `U1` on the left and `R1` on the right).
- However, `tests/cli-edit.test.ts:148-170` hardcodes seed `#50` (`g50.schem.json`) as its fixture for testing `--strict` refusal on an unstable edit.
- Reverted so `tests/cli-edit.test.ts` stays green without modifying existing tests.

#### PR #5 evaluation (`grok/rc-rl-filter`, commit `771f9b8`)
- Tested adding `RC_RL` and `RC_RL_R` (`rc-rl-filter`) to `src/layout/templates/library.ts` and documenting it in `docs/templates.md`:
  - `tests/findings-snapshot.test.ts` (`generated-30-16`): failed. `generated-30-16` contains an RC low-pass section, so `rc-rl-filter` inherently matches it and changes `C13-C5` (`116 -> 117 G`), `C13-C6` (`103 -> 104 G`), and replaces `L-squeezedRuns` with `L-jogs` (3).
  - `tests/edits.test.ts` (layer 5 random-edit stability): failed (`130/137` = `94.89% < 95%`). Adding a part in seeds `#29`, `#107`, `#108`, and `#122` formed new `rc-rl-filter` matches that pulled untouched parts into rigid regions (moving parts by 14 to 133 G and rotating `R2` in `#107`). Note that `generate(38, 5)` itself no longer failed individually.
  - `npm run bench -- --check`: `ne555` regressed (`41.3 -> 41.9`, wire `78 -> 79`), while `ce-amp` (`39.9 -> 38.9`) and `follower` (`31.0 -> 29.1`) improved.
- Left `rc-rl-filter` out as instructed so `npm test` and `bench --check` remain clean.

## Before and after images

Visually inspected all changed drawings:
- `docs/agent-reports/img/neon-layout-polish/sensor-node-before.png` vs `docs/agent-reports/img/neon-layout-polish/sensor-node-after.png`
- `docs/agent-reports/img/neon-layout-polish/multivibrator-before.png` vs `docs/agent-reports/img/neon-layout-polish/multivibrator-after.png`

## Files changed

- `src/layout/stacks.ts`
- `src/layout/flow.ts`
- `src/layout/layout.ts`
- `src/layout/templates/library.ts`
- `tests/supply-string.test.ts`
- `tests/layout-polish.test.ts`
- `docs/agent-reports/img/neon-layout-polish/sensor-node-before.png`
- `docs/agent-reports/img/neon-layout-polish/sensor-node-after.png`
- `docs/agent-reports/img/neon-layout-polish/multivibrator-before.png`
- `docs/agent-reports/img/neon-layout-polish/multivibrator-after.png`
- `docs/agent-reports/neon-layout-polish.md`

## Verification commands and exact results

### `npm run typecheck`
```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```
Exit code 0.

### `npm test`
```text
 Test Files  34 passed (34)
      Tests  673 passed (673)
```
Exit code 0.

### `npm run phase0`
```text
case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    118
case02-divider-buffer          valid                              valid     0        0    0    36
case03-summing                 valid                              valid     0        0    0    14
case04-hbridge                 valid                              valid     0        0    0    150
case05-i2c                     valid                              valid     0        0    0    13
case06-esp32-relay             valid                              valid     0        0    0    16
case07-two-ic-decoupling       valid                              valid     0        0    0    16
case08-diffpair                valid                              valid     0        0    0    11

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
```
Exit code 0. (Reserved test cases were not run, per `AGENTS.md`.)

### `npm run bench -- --check`
```text
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
multivibrator     valid                     58.3    63.3      1      4    74     0      0     1      0 better
ne555             valid                     41.3    41.3      0      5    78     0      0     0      0
pushpull          valid                     61.3    61.3      0      7   139     0      0     0      0
regulator         valid                       37    38.9      0      5    47     0      0     0      0 better
schmitt           valid                     32.6    32.6      0      3    58     0      0     0      0
sensor-node       valid                     77.8    92.1      0      4   136     0      0     0      0 better
shift             valid                     53.8    53.8      0      4   122     0      0     0      0

18 circuits, 18 valid. Total score 886.9 (baseline 908.1). Images: out/bench/index.html
```
Exit code 0.

### `npx tsx scripts/edit-sweep.ts`
```text
#28 longer value: untouched parts moved 2.29 G on average (at most 2); an untouched part moved 8 G (at most 6); routes changed on 2 nets the edit did not involve (at most 1): n3, n4
#50 longer value: routes changed on 2 nets the edit did not involve (at most 1): n5, n6
#76 longer value: untouched parts moved 2.29 G on average (at most 2); an untouched part moved 8 G (at most 6); routes changed on 2 nets the edit did not involve (at most 1): n3, n4
134 of 137 saved edits are stable (97.8%)
```
Exit code 0.

## Open questions for the owner

1. **`differentiator` (`squeezedRuns: 1`):** Do you want to update `tests/dsl-cli.test.ts` (pick another finding fixture), `tests/opamp-templates.test.ts` (allow `reserve: ["T"]` on op-amp templates), and `tests/findings-snapshot.test.ts` (`generated-30-16`) so `opamp-inverting` can reserve its output tap column `T`?
2. **Incremental label-side fallback (`134/137 -> 135/137`):** Do you want to point `tests/cli-edit.test.ts` (`--strict` test) to seed `#28` instead of `#50` so the incremental label-side fallback can land?
3. **`rc-rl-filter` (PR #5):** Because `rc-rl-filter` inherently changes `generated-30-16` in `tests/findings-snapshot.test.ts`, drops random-edit stability to `94.9%` (below the 95% gate) when new filters form during `addPart` edits, and regresses `ne555` (`41.3 -> 41.9`), do you want to keep it out until incremental mode avoids forming new templates over untouched parts, or update the snapshot and scope it out of 555 timing strings?
4. **Bench baseline:** `bench/baseline.json` was intentionally left untouched for the coordinator to update after visual review (new total `886.9`).
