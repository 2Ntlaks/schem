# Divider wiring report

Candidate commit `1709d86` on `codex/divider-wiring` offsets the lower resistor by two grid units when a voltage divider tap has at least two additional terminals. The three target drawings show a straight connection from the coupling capacitor to the transistor base with two T junctions. I stopped at a divider-buffer snapshot failure.

| Circuit | Before | Candidate |
|---|---:|---:|
| `ce-amp` | 47.0 | 39.9 |
| `follower` | 38.1 | 31.0 |
| `mixer-ce` | 63.5 | 56.4 |

## Files

- [Template](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/src/layout/templates/library.ts>) adds the offset variant.
- [Regression tests](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/tests/divider-wiring.test.ts>) check validity, straight wiring and the two junctions on all three circuits.
- [Brief](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/docs/agent-briefs/divider-wiring.md>), [template catalog](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/docs/templates.md>) and [general layout notes](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/docs/general-layout.md>) record the scope and placement rule.

## Checks

- `npm run bench -- ce-amp follower mixer-ce` passed on the original layout and on the candidate placement. I opened all six [before](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/out/divider-before>) and [after](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/out/bench>) PNGs.
- `npm run typecheck` passed.
- `npm test` exited 1 with 545 tests passing, including the three new tests. In `tests/findings-snapshot.test.ts:20`, `case02-divider-buffer` expected an empty findings list and received an `L-jogs` entry, `Readability: short steps in wires: 1 (at most 0).` The drawing status was `valid`.
- `git diff --check` passed.
- I skipped `npm run phase0` and `npm run bench -- --check` after the test failure, as required by `AGENTS.md`.

## Open question

Can placement distinguish taps that need branches on opposite sides from the divider-buffer tap using the existing topology and layout geometry?
