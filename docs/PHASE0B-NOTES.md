# Phase 0b: build notes

Status on 2026-10-23: the parts of Phase 0b that do not depend on the frozen cases are built: edit operations, incremental mode and the minimal findings harness. Templates, the baselines and the gate run wait for the case freeze (`phase0/`, written by agent B).

## What is built

| Piece | Where | Tested by |
|---|---|---|
| Edit transactions: operations in order, layout, layers 1-2 and gate 4 before saving incremental edits (D4); `revision` and `layoutToken`; `expectedRevision` / `expectedLayout` conflicts | `src/edit/edit.ts` | `tests/edits.test.ts`, `tests/edit-stability.test.ts` |
| Circuit operations, now with `setProp`; added parts keep their pins on the part | `src/core/ops.ts` | `tests/edits.test.ts`, fixtures |
| Visual operations as setters: `lock`, `unlock`, `setOrientation`, `setPinSides`, `setLabelSide`, `setSpacing`, `place`, `align`, `removeHint`, `relayout` | `src/edit/edit.ts`, intent in `src/core/intent.ts` | `tests/edits.test.ts` |
| Hints in the solve: `relative`, `align`, `orient`, `pinSides`; locks; label-side override | `src/layout/layout.ts` | `tests/edits.test.ts`, `tests/quality.test.ts` |
| Incremental mode | `src/layout/layout.ts` (`previous`, `affected`, `reuseRoutes`) | `tests/edits.test.ts` |
| Change report and gate 4 check | `src/edit/report.ts` | `tests/edits.test.ts` |
| Findings harness with checked fixes | `src/edit/findings.ts` | `tests/findings.test.ts` |

## Where this differs from SPEC.md (to fold into the spec)

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| Incremental mode (9.5) | repair region of affected boxes + 2 G; outside frozen; widen by 4 G up to 3 times, then whole sheet | previous positions stay preferred; alternate label placements avoid existing parts and conductors; up to eight local origin repairs anchor untouched parts; reusable routes are checked against new obstacles; full reroute and canonical fallback remain subject to gate 4 | small valid edits must also preserve unrelated work; an unstable result is rejected without changing the project |
| Ordering in incremental mode | displacement term in the ordering cost | existing columns, orientation, pin sides and label choices are cached; existing top-to-bottom order is retained; added parts start in free space below the drawing near their connected column | avoids re-ranking existing parts or pushing them out of an insertion slot; additions can make the drawing taller or routes longer |
| Column separation in incremental mode | every pair in adjacent columns | previous clear geometry retains its spacing, including empty corners inside a combined envelope; existing pairs otherwise need 1 G plus spacing | a larger label should not move an entire column when the actual bodies, labels and ports still clear |
| Gate 4 route count | "route changes limited to affected nets plus at most one other" | nets drawn only with supply or ground symbols are reported apart (`portStubs`): their stubs move with their parts, which the displacement figures already count | otherwise moving one op-amp counts as a GND reroute |
| `setSpacing` (11.3) | factor | factor f adds round((f - 1) x 4) G to every gap; runs a canonical layout | — |
| Step 8 | verify the render model | the layout now runs layers 1 and 2 itself; a drawing that fails is `budget_exhausted` with the reasons, never `valid` | an edit (a flipped pull-up) produced a drawing the layout called valid but the verifier rejected |
| Findings (10.2) | at most 5 candidate fixes per check, dry-run, offered if lexicographically better or with a trade-off | as specified, with this score order: validity, convention breaks, readability breaches, crossings, bends, wire length. Candidates: rotate (rules 7, 9.4, 10), align a row (rule 11), place left/right (rule 8), place next to the chip (rule 13), and for readability breaches near a point: turn nearby two-pin parts, reverse a nearby chip side, spacing x1.5 | minimal harness for 0b |
| Hints not yet in the solve | `near`, `flow`, `group`, `decouples` | accepted only through templates (next) | they belong with the templates |

## Bugs found and fixed on the way

- An `orient` hint on a pull-up (rotated and mirrored) made the supply stub double back on itself; the layout still said `valid`. Now a pin facing away from its symbol gets a U-shaped stub, and the layout runs layers 1-2 before saying `valid`.
- A new convention check: sources stand vertical with "+" at the top. Without it, the findings harness "fixed" a wire step in case 3 by turning V3 upside down.

## Measured

- The edit scripts of the SPEC 15 kinds on the development cases (`tests/support/edit-scripts.ts`): all saved, all incremental, all meet gate 4.
- 150 generated seeds, one random edit each (`tests/support/random-edits.ts`): all 137 eligible edits save, pass layers 1-2 and meet gate 4. Every edit is asserted individually, with no percentage allowance for instability or rejection.
- The original probe's 14 failures are frozen in `tests/fixtures/edit-stability/`, including their pre-edit geometry and affected scope. All now finish incrementally with zero untouched-part movement; seeds 31 and 92 each change one unrelated net, and the other 12 change none. Repeat requests are deterministic, and subsequent no-op edits preserve the repaired layouts.
- Gate 4 is checked before saving every incremental candidate, including canonical fallback. Explicit `setSpacing` and `relayout canonical` requests permit global changes. Mean and maximum displacement retain full precision so rounding cannot hide a threshold violation.
- Findings on case 3: fixes found for both readability breaches the owner saw (dots one step apart: reverse R2; wire steps: spacing x1.5). Case 5: no checked fix among 3 candidates for the crossing beside a dot and the squeezed wires; the I2C template (Appendix A.2) is the fix.
