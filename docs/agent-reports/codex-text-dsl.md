# Text DSL implementation report

Branch: `codex/text-dsl`. Starting commit: `3fa8f8e`.

## Milestones

- **M1 partial and uncommitted.** The draft tokenises and parses the section 8 statements and uses the existing circuit validator and merge rules. It compiles the supported hints and checks the section 8.4 diagnostic codes with source spans. One strict placement test failed, so AGENTS.md requires implementation to stop. The draft lives under `out/dsl-wip/` in this worktree, with `src/core/dsl-syntax.ts`, `src/core/dsl-parser.ts`, `src/core/dsl.ts` and `tests/dsl.test.ts` at their original relative paths.
- **M2 through M5 skipped.** Conversion, the DSL corpus, the CLI and MCP changes, and the DSL docs and example are pending. There were no DSL corpus or example PNGs to compare.
- This report is the only committed file. The concurrent layout edit stayed in the original checkout.

## Checks

| Command | Clean start at `3fa8f8e` | M1 draft | Report-only commit |
|---|---|---|---|
| `npm run typecheck` | Exit 0 | Exit 0 | Exit 0 |
| `npm test` | 585 passed in 25 files | 603 passed, 1 failed in 26 files | 585 passed in 25 files |
| `npm run phase0` | Exit 0, 8 of 8 valid, zero overlaps | Exit 0, 8 of 8 valid, zero overlaps | Exit 0, 8 of 8 valid, zero overlaps |
| `npm run bench` | Exit 0, 18 of 18 valid, score 1075.4 | Exit 0, 18 of 18 valid, score 1075.4 | Exit 0, 18 of 18 valid, score 1075.4 |

The M1 failure was in `tests/dsl.test.ts:114`. With `hint strict R1 above R2` followed by `hint strict R2 above R1`, the assertion on `result.ok` printed `expected true to be false`. SPEC.md line 462 requires an error on the second hint. All 585 existing tests passed in the same run.

The first run in the shared checkout reported 582 passes and three failures while a concurrent edit to `src/layout/layout.ts` appeared. The I2C edit reported `expected 'canonical' to be 'incremental'`, the strict edit test reported `Cannot read properties of undefined (reading 'state')`, and the generated findings snapshot had a different `expectedLayout` hash. I repeated all four checks in a clean worktree at the requested commit and observed the starting results above. `npm ci` succeeded there using the existing lockfile.

All 49 SVG hashes from validation, its edit cases and the benchmarks matched the clean starting run for both the draft and the report-only commit. I inspected the corresponding PNGs. The Phase 0 runner marked the full acceptance gates incomplete. The reserved test set and full evaluation were skipped under the repo rules.

## Open questions and model gaps

- **Near, flow and group.** SPEC.md lines 212 and 436 give different word order for `near`. Lines 212, 215-220 and 435-445 describe hints absent from the current JSON hint model. The draft follows the grammar for `near` and diagnoses these three forms explicitly. Which syntax and JSON shape should the compiler support?
- **Orientation and priority.** Lines 214 and 438 describe an axis, while the current JSON hint stores a single rotation and flip. The draft uses rotations 0 and 90 without a flip. Should the hint instead preserve both rotations on that axis? Line 434 also permits both `strict` and an explicit priority, while line 207 gives each hint one priority. The draft rejects a statement that sets both.
- **Conversion scope.** Line 463 excludes other non-empty metadata, while lines 241 and 283 show or require a canonical saved document whose metadata includes sequence counters. Lines 427-431 and 448 also give no syntax for inline pin aliases or interface roles, metadata on an unnamed net, or an override targeting an unnamed net. Those decisions were left pending.
- **CLI scope.** Lines 842-843 list `update-assets` and `watch`. The explicit M4 command list omits those verbs. Their inclusion in this branch was left open.
