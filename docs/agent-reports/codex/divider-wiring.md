# Divider wiring report

On `codex/divider-wiring`, the lower divider resistor sits two grid units to the right when horizontal pins approach the tap from opposite sides. The coupling capacitor now connects to the transistor base through two T junctions on a straight wire in all three target circuits. Redrawing an existing layout preserves its divider geometry.

| Circuit | Before | After |
|---|---:|---:|
| `ce-amp` | 47.0 | 39.9 |
| `follower` | 38.1 | 31.0 |
| `mixer-ce` | 63.5 | 56.4 |
| All 18 circuits | 1167.1 | 1145.8 |

## Files

- Added the two-junction divider template and selected it using the orientation of the pins attached to the tap. [Template](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/src/layout/templates/library.ts>), [layout](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/src/layout/layout.ts>).
- Added four tests covering the three target drawings and byte-identical redraw of a saved divider. [Regression tests](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/tests/divider-wiring.test.ts>).
- Updated the scope, template catalog and general layout notes. [Brief](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/docs/agent-briefs/divider-wiring.md>), [template catalog](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/docs/templates.md>), [general layout notes](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/docs/general-layout.md>).

## Verification

- `npm run typecheck` passed.
- `npm test` passed all 547 tests. The initial candidate failed the `case02-divider-buffer` snapshot with `Readability: short steps in wires: 1 (at most 0).` After the user authorized resuming, I fixed the placement rule so the grounded shunt capacitor in that case keeps the divider in one column. The existing snapshot passes as written.
- `npm run phase0` passed. All eight validation cases are valid and all 12 edits behaved as expected. The runner leaves the full Phase 0 gates incomplete because it covers the validation subset, without blind ratings and full performance checks.
- `npm run bench -- --check` passed. All 18 benchmark drawings are valid and no score rose.
- `git diff --check` passed.
- Inspected the 18 benchmark drawings, eight validation drawings and 23 edit drawings. Opened the three target drawings at full size before and after the change. [Before](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/out/divider-before>), [after](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/out/bench>), [contact sheets](<C:/Users/ntlak/.codex/worktrees/divider-wiring/Schematic circuit/out/divider-review>).

Implementation commits are `1709d86` and `59b1cb5`. Review can proceed in the isolated worktree.
