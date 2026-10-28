# Phase 0b build progress, 2026-10-25

This increment follows the initial [project audit](PROJECT-AUDIT-2026-10-25.md). Phase 0b remains in progress.

## Changes built

### Explicit acceptance evidence

`npm run phase0` now writes `out/phase0/gates.json` with a status and supporting evidence for each gate. Invalid/missing drawings, forbidden low-confidence statuses, overlaps, unexpected edit results and failed stability checks make the command exit 1. The fixed-op-amp `setPinSides` rejection is accepted only for the specified case 3 script with its `E270` reason.

A successful validation subset is marked incomplete against the full twelve-case gate. Blind ratings, baseline comparisons and full-pipeline performance measurements remain incomplete until they have their own evidence. Convention and readability warnings remain separate from hard validity failures.

### Decoupling child slots

The matcher in `src/layout/decoupling.ts` reads topology and pin roles. An explicit `decouples` hint takes priority. Without a hint, the matcher attaches a capacitor only when the supply net identifies one IC/module unambiguously; it does not guess between several ICs.

Supported slots put vertical capacitors next to upward-facing IC supply pins on port-presented power/ground nets. The slot reserves the IC and capacitor envelopes together, moves the IC label out of the slot, sorts capacitances within a shared slot, and draws explicit short supply connections with one shared supply port per pin. The netlist is never changed. The version is reported as `decoupling@1` in layout notes.

Slots yield to explicit orientation/placement intent. Existing capacitor locks are retained. A bounded fallback to generic placement handles constraints, routing or drawing checks that prevent a slot from being used. The independent verifier remains the final authority.

Incremental placement now lets export bounds expand around a longer label instead of forcing all geometry to remain right/below an absolute sheet margin. Net serialization is canonical after routing, so reuse of unchanged routes does not reorder SVG elements on a no-op edit.

This is the first decoupling implementation, not completion of all SPEC 9.4 templates. The current geometric slot offers two positions around each upward-facing supply pin. Crowded/additional capacitors, other pin orientations, wired power nets and ambiguous multi-IC inference still need broader template support. The complete persisted `layout.basis` format is also still pending.

### PNG scale

`toPng` now converts from the SVG's physical size correctly: 1 G = 2.54 mm = 9.6 CSS pixels at 96 px/in before scaling. The default is now exactly 10 pixels/G. Non-positive and non-finite scales are rejected.

A 48 x 32 G export is 121.92 x 81.28 mm and 480 x 320 pixels at the default scale. CLI DPI options and DPI metadata remain future work.

## Verified results

| Check | Result |
|---|---|
| `npm test` | 394 tests passed across 12 files |
| `npm run typecheck` | Passed |
| `npm run draw` | All three development cases valid; connectivity and overlap checks pass |
| `npm run phase0` | All eight validation circuits pass connectivity and overlap checks; exits 1 because case 4 still has a forbidden low-confidence status |
| Validation edit scripts | All twelve behave as permitted; eleven saved edits pass stability gate 4, plus the allowed case 3 rejection |
| Frozen test cases | Not opened or executed |

Case 7 improved from `valid_low_confidence` with four decoupling convention violations to `valid` with zero convention violations. Each capacitor's supply anchor is within 8 G of its specified IC pin. One unrelated adjacent-track readability finding remains. All four case 7 edit scripts save valid results with zero movement of untouched parts and zero unrelated route changes.

New regression checks cover gate failures and incomplete evidence, hinted supply targets, alias resolution, ambiguous inference, shared-slot capacitance ordering, removal of a decoupler's wire, frozen validation edits, capacitor locks, explicit orientation edits, reordered input, byte-identical no-op edits, and physical PNG dimensions at several scales.

## Remaining build work

The H-bridge template/confidence handling is the remaining known validation status blocker. I2C, op-amp, bridge-rectifier and low-side-switch templates, richer decoupling slots, the built-in asset persistence guarantee and the loader/custom-type consistency issue remain. Phase completion still requires the prescribed quality ratings, baseline comparisons, benchmarks and reserved end-gate evaluation.

The initial audit is retained as a record of the state before this increment. This change does not modify frozen circuit/edit fixtures or the specification.
