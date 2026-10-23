# Phase 0b: build notes

Status on 2026-10-23: the parts of Phase 0b that do not depend on the frozen cases are built: edit operations, incremental mode and the minimal findings harness. Templates, the baselines and the gate run wait for the case freeze (`phase0/`, written by agent B).

## What is built

| Piece | Where | Tested by |
|---|---|---|
| Edit transactions: operations in order, layout, layers 1-2, save only a valid result (D4); `revision` and `layoutToken`; `expectedRevision` / `expectedLayout` conflicts | `src/edit/edit.ts` | `tests/edits.test.ts` |
| Circuit operations, now with `setProp`; added parts keep their pins on the part | `src/core/ops.ts` | `tests/edits.test.ts`, fixtures |
| Visual operations as setters: `lock`, `unlock`, `setOrientation`, `setPinSides`, `setLabelSide`, `setSpacing`, `place`, `align`, `removeHint`, `relayout` | `src/edit/edit.ts`, intent in `src/core/intent.ts` | `tests/edits.test.ts` |
| Hints in the solve: `relative`, `align`, `orient`, `pinSides`; locks; label-side override | `src/layout/layout.ts` | `tests/edits.test.ts`, `tests/quality.test.ts` |
| Incremental mode | `src/layout/layout.ts` (`previous`, `affected`, `reuseRoutes`) | `tests/edits.test.ts` |
| Change report and gate 4 check | `src/edit/report.ts` | `tests/edits.test.ts` |
| Findings harness with checked fixes | `src/edit/findings.ts` | `tests/findings.test.ts` |

## Where this differs from SPEC.md (to fold into the spec)

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| Incremental mode (9.5) | repair region of affected boxes + 2 G; outside frozen; widen by 4 G up to 3 times, then whole sheet | every part that existed keeps its previous position as a lower bound plus an upper bound that gives way first (`prev` for untouched parts, `prevAffected`, weaker, for affected ones); nets whose drawn terminals did not move keep their routes; fallbacks: keep routes, then reroute everything, then a canonical layout with locks | the difference-constraint solve already gives a minimal, deterministic version of "displacement cost"; region bookkeeping can come later if the gate needs it |
| Ordering in incremental mode | displacement term in the ordering cost | parts that existed keep their previous top-to-bottom order in each column; new parts keep the slots the barycentre sweeps give them | simplest form that keeps order stable |
| Column separation in incremental mode | every pair in adjacent columns | skipped for two parts that existed before and whose rows did not overlap (1 G to spare) | a longer label pushed whole columns sideways for nothing |
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
- 80 generated circuits, one random edit each (`tests/support/random-edits.ts`): every saved edit passes layers 1-2; at least 85% meet gate 4 (about 90% measured on 137 edits). Misses are mostly labels tripled in length or new parts pushing a column aside; that is layout-quality work for the templates.
- Findings on case 3: fixes found for both readability breaches the owner saw (dots one step apart: reverse R2; wire steps: spacing x1.5). Case 5: no checked fix among 3 candidates for the crossing beside a dot and the squeezed wires; the I2C template (Appendix A.2) is the fix.
