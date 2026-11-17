# Chip output fan-out

Implemented on `codex/chip-fanout` in `c82c4a8`. Tall series branches that would crowd the same column now stagger on the right of the chip. The higher a driver pin sits, the farther out its branch goes, leaving a clear row for its wire. The rule follows netlist connections and measured pin positions. It respects locks and placement or orientation hints. Existing edits keep their saved column assignments.

| Circuit | Score before | Score after | Bends before | Bends after |
|---|---:|---:|---:|---:|
| `shift` | 100.6 | 75.0 | 14 | 8 |
| `mcu` | 86.8 | 86.4 | 12 | 10 |
| All 18 circuits | 1167.1 | 1141.1 | | |

Every LED driver wire in those two circuits now makes one turn into its resistor. The `shift` drawing is shorter and wider, and its chip-select wire now detours above the bypass capacitor.

## Files

- `src/layout/flow.ts` identifies series branches connected to one external pin.
- `src/layout/layout.ts` places crowded branches in separate columns, reserves vertical routing space near each turn, and falls back to ordinary placement if staggering fails.
- `tests/chip-fanout.test.ts` checks routing, deterministic output, a no-op edit, and an explicit orientation hint.
- `docs/agent-briefs/chip-fanout.md` records the scope. `docs/general-layout.md` explains the placement rule.

## Verification

- `npm run typecheck` passed.
- `npm test` passed all 546 tests across 23 files, including the saved findings and generated edit-stability tests.
- `npm run phase0` exited 0. All eight validation drawings were valid, and all 12 edit scripts produced their expected outcomes. The 11 saved edits passed the stability check.
- `npm run bench -- --check` passed. All 18 drawings were valid and every score met or improved on the existing baseline.
- `git diff --check` passed. I inspected 49 benchmark, validation, and edit PNGs using contact sheets and opened the two before-and-after benchmark pairs at full size.

Held-out tests and full gates were outside the brief. There are no open questions.
