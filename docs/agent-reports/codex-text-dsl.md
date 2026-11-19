# Text DSL implementation report

The work is on `codex/text-dsl`, based on `3fa8f8e`. All five milestones are complete within the owner's clarified scope.

## Milestones

| Milestone | Result |
| --- | --- |
| M1, parser and compiler (`22d378e`) | Restored the draft under `src/core/` and `tests/`. It compiles text through the existing circuit validator and merge rules. It orders net IDs by canonical endpoints and reports diagnostics with source spans. I fixed the compiler's handling of contradictory strict hints. A new test now checks the approved `near` behavior through JSON save, load and rename. |
| M2, JSON conversion (`01c9008`) | Added `src/core/dsl-format.ts`. Text can round trip through canonical JSON, with storage counters regenerated. Conversion returns a sorted list of fields the text grammar cannot represent. Final review added coverage for empty unknown fields and invalid identifiers inherited from JavaScript objects. |
| M3, drawing proof (`c570f42`) | Added 20 text circuits under `tests/dsl-corpus/` and tests for identical SVGs, reordered declarations, comments, blank lines and equivalent pin spellings. |
| M4, CLI and MCP (`9574228`) | Added `init`, `render`, `check`, `preview`, `query`, `undo`, `fmt`, `describe` and `components`. `draw` and `edit` accept text files. Shared code under `src/mcp/` handles command logic, safe writes and edit history. The MCP `schem_create` tool accepts text source. |
| M5, docs and example | Added `docs/dsl.md` and `examples/led.schem`. Linked the guide from the main README and docs index. |

The implementation and tests are in `src/core/dsl*.ts`, `src/core/intent.ts`, `src/core/validate.ts`, `src/io/project.ts`, `src/edit/edit.ts`, `src/cli.ts`, `src/mcp/` and the new `tests/dsl*.test.ts` files. The edit change keeps both references in a `near` hint correct when a part is renamed. The layout engine, renderer, verifier, specification and existing tests had no edits.

## Verification

| Command | Clean base | Final commit |
| --- | --- | --- |
| `npm run typecheck` | Exit 0 | Exit 0 |
| `npm test` | 585 tests passed in 25 files | 642 tests passed in 29 files |
| `npm run phase0` | Exit 0, 8 of 8 valid, zero overlaps | Exit 0, 8 of 8 valid, zero overlaps |
| `npm run bench` | Exit 0, 18 of 18 valid, total score 1075.4 | Exit 0, 18 of 18 valid, total score 1075.4 |

All four checks passed before each milestone commit. The test counts after M1 through M4 were 604, 607, 628 and 639. All 49 validation, validation-edit and benchmark SVG hashes matched the clean base at each milestone. I inspected those validation and benchmark PNGs, five matching corpus PNG pairs, and both examples in the guide. The 300 DPI example exports were byte-identical to their JSON counterparts at 990 by 540 pixels for the LED and 1530 by 1290 pixels for the amplifier.

The parked draft had one new test failure: `expected true to be false` for two contradictory placement hints. The restored compiler now finds the source constraint cycle before drawing. The first `near` implementation then failed an existing JSON test that expects `"near" is not supported` in a `schem/1.0` file. The implementation now uses `schem/1.1` for files with `near`. The existing test stayed as written. The earlier shared-checkout run had three failures during a concurrent layout edit. The clean base in the isolated worktree passed all 585 tests.

## Corpus exclusions

| Validation circuit | Fields outside the text subset |
| --- | --- |
| `case02-divider-buffer` | `meta.created`, `ext`, `assets.library` |
| `case04-hbridge` | `meta.created`, `ext`, `assets.library` |
| `case05-i2c` | Inline pin interface roles on `U1`, `U2` and `U3` |
| `case06-esp32-relay` | `meta.created`, `ext`, `assets.library` |
| `case07-two-ic-decoupling` | `meta.created`, `ext`, `assets.library`, inline pin aliases and interface roles |
| `case08-diffpair` | `meta.created`, `ext`, `assets.library` |

All 18 benchmark files and the other two validation files converted and drew byte-identical SVGs. Phase 0's full acceptance gates remain incomplete. The reserved evaluation was skipped under the repository rules.

## Specification decisions

- SPEC.md lines 212 and 436 disagree on `near` word order. The compiler follows line 436. JSON 1.1 stores the hint under the minor-version policy on lines 286-289. Proximity placement remains outside this task. The group and flow forms on lines 439 and 445 report `E260` as agreed.
- The owner resolved the orientation forms on lines 214 and 438 as rotations 0 and 90 with no mirror. The parser rejects combining `strict` and `priority=` under the owner decision for line 434.
- Lines 241, 283 and 463 were clarified to allow regenerated metadata counters. Inline pin aliases and interface roles have no spelling in lines 427-428. Line 448 requires a name for a net override. Conversion reports these fields when applicable.
- `update-assets` and `watch` on lines 842-843 were excluded by the owner. The starting MCP server had no undo or component catalogue, so those commands are available in the CLI from the shared command module. The six advertised MCP tools retain their existing contract.
- A text edit stores its revision-bound layout in a trailing comment, since the grammar has no layout field. The legacy plain-text JSON `draw` and `edit` forms keep exit 2 for unreadable input to preserve their existing contract. The new commands and their JSON output follow the exit statuses on line 848.
