# Negative supply layout report

Branch `codex/negative-supplies`. Implementation commit `68babf8` and test import correction `6d2ad8d`.

## Changes

- `src/core/model.ts` recognises `VEE`, `V-` and signed voltages. Explicit power `VSS` is a negative supply. Explicit net kinds take precedence.
- `src/layout/ports.ts`, `src/layout/kinds.ts`, `src/layout/stacks.ts` and `src/layout/layout.ts` orient and place negative supply symbols and the parts that connect to them. In `pushpull` the PNP sits below the NPN and the bias string runs from VCC down to VEE.
- `src/layout/flow.ts` recognises an input diode feeding the negative rail at its anode. `src/quality/conventions.ts` checks the downward direction of negative supply symbols.
- `docs/agent-briefs/negative-supplies.md` records the task and `docs/general-layout.md` documents the implemented layout rule. `tests/negative-supplies.test.ts` adds focused coverage.

## Checks

- `npm run typecheck` passed after correcting the new test's `xformPath` import.
- `npm test` passed all 553 tests across 23 files, including the findings snapshot. The first run had one failure because I imported `xformPath` from the wrong module. TypeScript reported TS2724 and the test reported `TypeError: xformPath is not a function`. I stopped under the repository rule and resumed after the user authorized correcting the import.
- `npm run phase0` exited 0. All 8 validation cases drew valid with zero overlaps. The runner marked the full phase gates incomplete because they require reserved cases, blind ratings or timing data outside this run.
- `npm run bench -- --check` passed. All 18 circuits drew valid, no circuit scored worse and the total fell from 1167.1 to 1106.8. `pushpull` went from 134.2 to 73.9 and from four crossings to zero.
- `git diff --check` passed.
- I inspected 50 PNGs, including the 18 benchmark drawings, 8 validation drawings and 23 validation-edit drawings. I opened [push-pull before](<C:/Users/ntlak/.codex/worktrees/negative-supplies/Schematic circuit/out/bench/pushpull-before.png>) and [push-pull after](<C:/Users/ntlak/.codex/worktrees/negative-supplies/Schematic circuit/out/bench/pushpull.png>) at full size. The last run reproduced the reviewed contact sheets pixel for pixel.

## Scope

The existing source-loop rule keeps a negative supply net wired if it has two endpoints and one is a source. The differential-pair validation case still shows its existing wired-source drafting warning. The downward-symbol rule applies when the rail is drawn using a supply symbol.

Held-out cases were outside the scope of this run. The benchmark check used the original baseline scores. No open questions.
