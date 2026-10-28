# Project audit against SPEC.md rev C.3

Date: 2026-10-25 (Africa/Johannesburg). Reviewed commit: `9370659`, with a clean working tree before the audit. Runtime: Windows, Node.js v24.14.0.

This is the initial audit snapshot. Subsequent implementation and current validation results are recorded in [Phase 0b build progress](PHASE0B-PROGRESS-2026-10-25.md).

## Verdict

The project has a working Phase 0a foundation and substantial Phase 0b infrastructure. It is not ready to pass Phase 0b or start treating the Phase 1 CLI as the next acceptance milestone. The main unfinished work is automatic pattern layout, followed by the formal quality evaluation and performance measurements.

All eight validation circuits currently pass connectivity verification and overlap checks. That is stronger than merely producing pictures. However, two return a status forbidden for their cases by gate 1, and seven have at least one convention or readability finding. A `valid` status establishes correctness and basic drawing validity, not publication quality or a blind owner rating.

The four reserved test circuits and their case 11 edit scripts were left unopened and were not executed. SPEC sections 13 and 15 reserve them for a single end-of-phase evaluation. Results below are a validation-set assessment, not the formal twelve-case gate run.

## Checks performed

| Check | Observed result |
|---|---|
| `npm test` | 9 test files, 367 tests passed |
| `npm run typecheck` | Passed |
| `npm run phase0` | Eight validation circuits rendered; process exited 0 |
| Validation connectivity and overlaps | 8/8 pass; zero overlaps |
| Validation status requirement | 6/8 meet the gate 1 status rule; cases 4 and 7 do not |
| Validation edit scripts | 11 edits saved; all 11 meet stability gate 4; the twelfth is the permitted case 3 pin-side rejection |
| Visual inspection | Inspected freshly generated PNGs for cases 3, 4, 5 and 7 |
| Focused probes | Confirmed missing built-in assets, PNG scale mismatch and loader/layout custom-type inconsistency |

The existing tests cover independent model/verifier fixtures, mutation checks, symbol orientations, fixed Appendix A examples, quality checks, transactional edits, file loading, checked findings, 300 generated circuits, and deterministic/metamorphic drawing checks. The generated stress test allows some layouts to fail, while requiring over 90% to draw validly and checking that successful layouts pass layers 1 and 2.

The CI configuration runs tests and drawing hashes on Windows and Linux. Its latest remote execution was not inspected, so this audit confirms local Windows results only.

## Validation drawings

| Case | Layout status | Convention findings | Readability findings | Main observation |
|---|---|---:|---:|---|
| 1: LED | `valid` | 0 | 0 | Meets all automated drawing checks |
| 2: divider/buffer | `valid` | 0 | 1 | Short wire step |
| 3: summing amplifier | `valid` | 0 | 2 | Dots 1 G apart; short wire steps |
| 4: H-bridge | `valid_low_confidence` | 0 | 1 | Adjacent wire tracks; bridge legs arranged vertically rather than as the planned pattern |
| 5: I2C | `valid` | 0 | 2 | Crossing 1 G from a junction; adjacent wire tracks; stacked pull-ups |
| 6: relay driver | `valid` | 0 | 1 | Adjacent wire tracks |
| 7: IC decoupling | `valid_low_confidence` | 4 | 0 | Capacitors 29, 38, 47 and 56 G from the nearest supply pin they can serve; limit is 8 G |
| 8: differential pair | `valid` | 1 | 2 | V3 supply orientation; crossing near a dot; adjacent tracks |

All rows have a valid connectivity result and zero overlap errors. Low confidence is allowed only for case 8 under Phase 0b gate 1. The source of low confidence in case 4 is disconnected source ranking for J1; in case 7 it is ranking of the port-connected capacitors and J1. See `src/layout/layout.ts:125`, `:141` and `:500`.

Machine-readable results and drawings are in `out/phase0/validation/`; edit results are in `out/phase0/edits/`. These output folders are ignored by Git.

## Implementation compared with the specification

| Area | Current implementation | Remaining work |
|---|---|---|
| Circuit model | Validation, endpoint resolution, groups, equality, quantities and circuit operations are implemented and tested | Allocate net IDs from the persisted counter rather than current maximum; complete the remaining file/feature guarantees |
| Symbols and modules | Built-in symbols, generated IC/header boxes, four modules, group representatives and symbol checks work | Full section 7.1 custom symbol format and embedded built-in asset use |
| Project files | Old and new shapes load; canonical saves; unknown-field edit refusal; inert `ext`; embedded modules | Built-in assets are not embedded or used from file definitions; custom inline types are accepted by the loader but rejected by layout |
| Layout | Flow ranking, barycentre ordering B, constraint solving, default orientations, routing, labels and basic power ports work | Automatic pattern recognition/templates, final power-presentation pass, richer repair search and remaining hint effects |
| Editing | Circuit operations, visual setters, locks, incremental anchoring, route reuse, revision/layout conflicts and stability reporting work | `setHint`, `clearOverride`, `setNetStyle`; persistence-level safety and undo snapshots for the future CLI |
| Findings | Convention/readability findings with bounded candidate dry-runs, checked fixes and circuit-equality tracking | Full critic, description, alt text and net table; broader fixes where current candidates cannot help |
| Rendering | Outlined SVG with physical dimensions, labels and PNG export | Correct PNG scale contract; DPI export/metadata and remaining accessibility/output details |
| Evaluation | Automated layers 1-5, independent fixture corpus, fixed Appendix A layouts and a blind-judge toolkit exist | Real blind owner ratings, baselines, complete gate evaluation, golden comparison report and formal performance benchmarks |
| User interfaces | Development drawing and phase-run scripts | Text DSL and complete `schem` CLI in Phase 1; MCP in Phase 2; web editor in Phase 3 |

The fixed Appendix A tests show that good summing-amplifier and I2C arrangements can pass the existing router and verifier. They supply coordinates, and I2C conductor trunks, through test hooks. They do not demonstrate automatic template detection or automatic template placement. See `tests/appendix-a.test.ts:10` and `tests/support/appendix-a.ts`.

ELK ordering candidate A is conditional in the specification. Its absence alone is not a blocker: first obtain the validation blind ratings for candidate B, then build A only if B misses gate 3.

## Concrete gaps found

### 1. Phase 0b templates are the main completion blocker

The layout still follows the Phase 0a pipeline. There is no implemented automatic matcher/placer for the six Phase 0b template families. `decouples` is parsed and checked but does not affect placement. The other template-dependent hints, `near`, `flow` and `group`, are not supported by the project loader.

This is directly visible in case 7: all four capacitors are placed away from their ICs despite explicit `decouples` hints. I2C, summing-amplifier and H-bridge drawings also retain the drafting weaknesses those templates are intended to resolve. Sources: `src/layout/layout.ts`, `src/core/intent.ts:10`, `docs/PHASE0B-NOTES.md` and SPEC 9.4/15.

### 2. The phase runner can report success when acceptance checks fail

`npm run phase0` exited 0 in this audit despite cases 4 and 7 having forbidden low-confidence statuses. In `scripts/phase0.ts:116`, a case increments the failure count for verifier rejection, but not for a disallowed status, overlaps, or missing output. Edit-script expectation mismatches and stability failures are also printed without necessarily setting failure status. The final exit code at line 206 only uses that narrower failure count.

The script currently acts as a diagnostic renderer, as its build notes acknowledge. It should not be used as a passing acceptance signal. Before the end gate, add explicit gate accounting and distinguish incomplete/unrated gates from passes. Convention/readability warnings should remain separate from hard validity and owner-rating gates.

### 3. Saved files do not meet the self-contained asset guarantee

Loading and saving `cases/case01-led.json` produces `assets.definitions: {}` despite using battery, resistor and LED symbols. Saving copies the existing definitions rather than embedding those built-ins. Loading/layout resolve built-ins from `BUILTIN`, not the saved symbol definitions. A future library change can therefore change a saved file's drawing.

This conflicts with SPEC 6.5, which requires the next save to embed missing built-in definitions. Modules are embedded correctly. Sources: `src/io/project.ts:139`, `:185`, `:389`; `src/layout/layout.ts:60` and `:182`. Reproduction: `npx --no-install tsx out/audit/probe.ts`.

### 4. PNG scale does not match its argument or the specified default

The default `toPng(svg, pxPerGrid = 10)` exports case 1's 33 x 18 G drawing as 634 x 346 pixels. At 10 pixels per grid unit it should be 330 x 180 pixels. The zoom expression in `src/render/png.ts:6` multiplies a physically sized SVG's raster scale; it does not establish the requested pixels per grid unit.

Use a conversion based on the SVG viewBox/grid bounds, verify explicit/default scales against PNG dimensions, and implement DPI metadata when adding the CLI options. The current mismatch affects image dimensions even though the exported circuit remains readable. Reproduction is in the same probe.

### 5. Loader and layout disagree on custom inline-pin types

A one-part project with `type: "custom:test"` and a declared pin loads successfully, but `layout()` returns `invalid_input` with `E201 unknown part type`. `src/io/project.ts:194` accepts any part carrying valid pins; `src/layout/layout.ts:60` only creates pin definitions for built-ins, `ic`, modules and headers.

Either reject unsupported custom types clearly at load time until section 7.1 is implemented, or carry their symbol/pin definitions through layout. A successful load currently overstates rendering support.

## Acceptance gates still outstanding

1. **Gate 1, validity/status:** validation connectivity and overlaps pass, but cases 4 and 7 fail the allowed-status requirement. The four reserved test cases remain untested.
2. **Gates 2 and 3, blind publication ratings:** no current owner rating dataset or gate report was found. This audit's visual inspection is not a substitute for the required blind ratings, before and after the permitted agent edit.
3. **Gate 4, stability:** all twelve validation edit scripts behave as allowed, including the permitted fixed-symbol rejection. Case 11's four scripts remain reserved. The changed affected-part sets printed for some scripts are documented rev C.3 corrections, not newly discovered failures.
4. **Gate 5, baseline comparison:** the three baseline integrations and comparison results are absent. The handoff explicitly records them as not started.
5. **Gate 6, performance:** current case timings measure a single layout invocation. They exclude the critic's checked-fix dry-runs, do not establish warm p95, and do not cover the required generated 30-part benchmark. They cannot prove the performance gate.

The judge toolkit exists, but its existence is not evidence that real judging or owner calibration has been completed. Likewise, a CI configuration is not evidence of a successful cross-platform CI run.

## Recommended next work

1. Make the phase runner's gate results explicit so later acceptance evidence is trustworthy.
2. Implement decoupling, I2C and op-amp templates using the existing Appendix A examples and case 7 hints, then complete H-bridge, bridge rectifier and low-side-switch patterns. Keep the reserved test set sealed during development.
3. Address source-ranking/confidence behavior for the validated patterns, then rerun validation drawings and stability scripts.
4. Correct PNG scaling and align project asset/custom-type handling with the intended supported file contract.
5. Build the baseline drawings and validation blind-rating pack; use the measured result to decide whether candidate A is needed.
6. Add full-pipeline performance measurements, then perform the reserved end gate once the validation evidence is ready. Start Phase 1 after the Phase 0b decision.

This audit changed no engine code or circuit fixtures. It added this report and an ignored reproduction script under `out/audit/`; the validation runner refreshed ignored drawing outputs.
