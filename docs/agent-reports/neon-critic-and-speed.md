# Agent Report: Verified Alt Text, Net Table, and Gate 6 Review Speed-Up

- **Branch:** `t3/6d0a6354`
- **Worktree:** `C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-6d0a6354-d8f38bab3d66d45b`
- **Commits:**
  - `ddc2f75` - `perf(findings): cache and prune provably useless fix dry-runs in review()`
  - `817b4e9` - `feat(quality): add verified altText, netTable, and netTableMarkdown`
  - (This report is committed in the follow-up docs commit on the same branch.)

## What Was Done

### 1. Reader-Facing Alt Text and Net Table (`src/quality/alt-text.ts`)

Implemented SPEC 10.4 reader accessibility helpers derived strictly from verified electrical connectivity (`render.electrical`, the drawn wires, pins, junction dots, and ports checked by `verify()`):

- `netTable(circuit, pinDefs, render): NetTableRow[]`: runs Layer 1 electrical verification (`verify()`), builds conductor equivalence classes directly from `render.electrical` (respecting dotless crossings and internal pin groups), classifies each net's presentation as `"wire"` or `"port"` from the drawn geometry, sorts connected pins in natural canonical order (`R1[1]`, `U1[2]`), and sorts rows deterministically by kind (`power`, `ground`, `signal`), name, domain, and id. Throws if electrical verification fails.
- `netTableMarkdown(rows): string`: formats verified `NetTableRow` entries as a GitHub-flavored Markdown table, escaping pipe characters and normalizing any em/en dashes to plain hyphens.
- `altText(circuit, pinDefs, render, notes?): string`: generates concise, deterministic, plain-English alt text (no em dashes or en dashes). It states the circuit title (when present), part count and type breakdown, key IC/module devices, recognized structures only from matched template notes (explicitly phrased as inferred and ignoring abandoned/dropped template notes), power and ground rails, and a left-to-right signal flow summary derived from verified signal connectivity and drawn pin positions.

### 2. Speeding Up `review()` (`src/edit/findings.ts`)

Profiled `review()` (the SPEC 10.2 findings harness, which dry-runs candidate visual edits through `edit()`) on Gate 6's generated 30-part circuit (`generate(30, 16)`). Layout took about 55 ms, while `review()` took about 2.1 s because failed candidates ran the full incremental, incremental-reroute, and canonical fallback chain.

Added sound, output-preserving optimizations inside `src/edit/findings.ts` without changing any finding id, message, candidate count text, fix ops, `expect`, `tradeoff`, `changesCircuit`, or `expectedLayout`:

- **Early exit and lazy `layoutToken`**: return immediately when there are zero findings, skipping `layoutToken` hashing on clean drawings.
- **Deduplication and candidate cache**: deduplicate identical candidate op lists within and across findings in one `review()` call, and omit redundant `expectedLayout` re-hashing inside dry-run `edit()` calls (still setting `expectedLayout` on the returned `CheckedFix`).
- **Skip `circuitEquals` on pure visual fixes**: compute `changesCircuit` as `false` directly when the chosen ops contain no circuit-modifying operations.
- **Provable no-op and local-collision pruning**:
  - Skip `setOrientation` on a locked part, or on an orientation convention finding (`C10-*`, `C9.4-*`, `C7-source-*`) when the candidate keeps the part's current broken orientation.
  - Skip `setOrientation` on a fixed built-in symbol when the candidate orientation places one of that part's own side-mounted port symbols across the mandatory first grid step of one of its own wired pins (`edgeForbidden`), which always fails Layer 1/2 checks (for example, rotating op-amp `U5` 180 degrees on `generate(30, 16)` saved ~1.0 s alone).
  - Skip `setPinSides` when all requested sides already match `state.parts[part].sides` and no existing `pinSides` hint is being replaced.
  - For `C13-*` decoupling findings (two-pin decoupling capacitors on power and ground rails with no existing `relative` hint, lock, or template membership): skip `place` directions already satisfied by drawn part envelopes with >= 2 G clearance, and skip `above`/`below` (which constrain only Y) when the capacitor sits in a different column separated horizontally by more than `DECOUPLING_REACH` (8 G) from every served IC supply pin.

### 3. Tests (`tests/alt-text.test.ts`)

Added 7 unit tests covering:
- Simple LED circuit (`case01-led.json`) wire-drawn rails, canonical net table, and Markdown output.
- Op-amp summing circuit (`case03-summing.json`) and untitled non-inverting op-amp circuit, checking inferred wording when template notes match and confirming functional words are omitted without template notes or with abandoned template notes.
- Multi-IC circuits (`case05-i2c.json` and `phase0/cases/validation/case07-two-ic-decoupling.json`), checking port-drawn rails, named signal buses, and natural ordering of grouped IC pins.
- Deterministic output on `generate(30, 16)` across repeated calls and reversed template note order.
- Domain-scoped nets (`analog`), Markdown escaping, and sanitization of em/en dashes.
- Rejection of drawings that fail electrical verification (`verify()`).

## Files Changed

- Modified: `src/edit/findings.ts`
- Added: `src/quality/alt-text.ts`
- Added: `tests/alt-text.test.ts`
- Added: `docs/agent-reports/neon-critic-and-speed.md`

No files under `src/layout/`, `src/mcp/`, `src/cli.ts`, `src/render/`, `web/`, `src/symbols/`, `src/modules/`, `tests/snapshots/findings.json`, `bench/`, `phase0/`, `tests/fixtures/`, `SPEC.md`, or `package.json` were modified.

## Gate 6 Timing Comparison (Default Validation Mode Only)

Measured with `npm run gates` (1 cold run + 7 warm runs, target warm p95 < 3000 ms; held-out `--test` mode was never run):

| Circuit | Role | Metric | Before | After | Change |
| --- | --- | --- | --- | --- | --- |
| `generated #30 (16 patterns)` | generated | cold | 2214 ms | 945 ms | -57.3% |
| `generated #30 (16 patterns)` | generated | warm median | 2134 ms | 832 ms | -61.0% |
| `generated #30 (16 patterns)` | generated | warm p95 | 2581 ms | 1120 ms | -56.6% |
| `generated #30 (16 patterns)` | generated | layout median | 55 ms | 54 ms | - |
| `case04-hbridge` | stand-in for case 11 | warm median | 158 ms | 154 ms | -2.5% |
| `case04-hbridge` | stand-in for case 11 | warm p95 | 193 ms | 163 ms | -15.5% |

## Verification Commands and Exact Results

### `npm run typecheck`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```
Exit code: `0`.

### `npm test`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  33 passed (33)
      Tests  673 passed (673)
   Duration  16.19s
```
Included `tests/alt-text.test.ts` (7 passed), `tests/findings.test.ts` (8 passed, unchanged), and `tests/findings-snapshot.test.ts` (10 passed, unchanged). Exit code: `0`.

### `npm run phase0`

```text
case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    195
case02-divider-buffer          valid                              valid     0        0    0    50
case03-summing                 valid                              valid     0        0    0    14
case04-hbridge                 valid                              valid     0        0    0    151
case05-i2c                     valid                              valid     0        0    0    13
case06-esp32-relay             valid                              valid     0        0    0    21
case07-two-ic-decoupling       valid                              valid     0        0    0    17
case08-diffpair                valid                              valid     0        0    0    8
```
All 8 validation cases `valid` with 0 overlaps, 0 convention breaks, and 0 readability breaches; 12/12 edit scripts passed. Exit code: `0`.

### `npm run gates`

```text
gate  verdict     figure
1     incomplete  8 of 8 cases pass (need 12 of 12)
2     incomplete  awaiting ratings of out/gates/validation/packs/panel-651d583403
3     incomplete  awaiting ratings of out/gates/validation/packs/panel-651d583403
4     incomplete  12 of 12 edit scripts pass (need 16 of 16)
5     incomplete  awaiting ratings of out/gates/validation/packs/panel-651d583403; no baseline drawings
6     incomplete  stand-in case04 p95 163 ms; generated p95 1120 ms; case 11 is in the test set: timed only with --test

Gate 6: full pipeline (layout, checks, findings with fix dry-runs), 1 cold + 7 warm runs, target warm p95 < 3000 ms
circuit                            role                  parts pins nets text  finds status                cold   median p95    layout verdict
case04-hbridge                     stand-in for case 11  15    37   12   153   0     valid                 153    154    163    140    (meets target)
generated #30 (16 patterns)        generated             30    68   18   268   3     valid                 945    832    1120   54     pass
```
Exit code: `0`.

## Skipped Items and Notes

- Did not run `npm run gates -- --test` or `npm run phase0 -- --test`, and did not touch any held-out test-set paths, per repository rules.
- Did not run `npm run bench -- --check` because `src/layout/` was not touched.
- No PNG drawings were created or modified by these changes, so no PNG visual diff review was required.
- Ran `npm ci` once in this fresh git worktree to populate the gitignored `node_modules/` directory from the existing `package-lock.json` without editing `package.json` or `package-lock.json`.

## Open Questions

1. Should `altText`, `netTable`, and `netTableMarkdown` be re-exported from `src/quality/index.ts` and wired into `src/render/svg.ts` (`<desc>`), `src/cli.ts`, and `src/mcp/commands.ts` in a follow-up integration pass? (Those files were outside this task's file ownership.)
2. For `C13` findings in `src/edit/findings.ts`, the remaining ~700 ms on `generate(30, 16)` comes from `place C5 right-of U1` and `place C6 right-of U1` failing both incremental attempts before `canonical` reports `infeasible`. If maintainers later allow `src/edit/edit.ts` or `src/layout/layout.ts` changes, short-circuiting the layout retry chain during fix dry-runs could cut that remaining time further.
