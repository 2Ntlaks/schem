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

## Templates (SPEC 9.4)

Built on 2026-10-25: the template mechanism and six templates. Case 3 and case 5 now lay out with no readability breach (the `known` table in `tests/quality.test.ts` is empty for both); case 1 matches no template and is unchanged.

| Piece | Where | Tested by |
|---|---|---|
| Template data types: slots (part types, pin and interface roles, pin-to-net predicates, many-slots, follow-slots), orientations, label sides, pin sides, ranks, difference constraints (`interior`, `link`), boundary pins, pre-routed runs | `src/layout/templates/types.ts` | `tests/templates.test.ts` |
| Engine: matching, overlap resolution, interior solve (step 5), linking constraints, runs | `src/layout/templates/engine.ts` | same |
| Templates: op-amp inverting / summing, op-amp non-inverting, I2C pull-ups, voltage divider, pull-up, pull-down, LED + resistor (vertical to a ground symbol, else horizontal); stubs for H-bridge, bridge rectifier, low-side switch, decoupling | `src/layout/templates/library.ts` | same; drawings by `npx tsx scripts/templates.ts` |
| Hooks in the layout: block ranks, block columns and ordering, rigid regions, link constraints, template runs, fallbacks, `LayoutResult.blocks`, `LayoutState.templates` | `src/layout/layout.ts` | all layout tests |

### Where this differs from SPEC.md (to fold into the spec)

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| A.2 ranks | U2 and U3 rank 2 | peripherals get ranks 2, 3, ... in canonical order, one column each | in one column they would be stacked; "peripherals in one row" needs them side by side |
| A.2 spacing | `U2.top >= SCL.y + 5`, `R2.x - R1.x >= label + 2` | measured: peripheral envelope (with its label) 2 G below the SCL trunk; SCL pull-up envelope 1 G right of the SDA pull-up's | the same intent, from measured sizes |
| A.1 rows and columns | input rows 5 G apart; `Rf.y <= IN-.y - 5`; tap column `T = OUT.x + 2` | input rows: the next input's label 2 G below the previous input's wire (6 G with two-line labels); a single input sits on the IN- row (the classic inverting drawing); Rf's envelope 1 G above the op-amp's, op-amp label below it; `T >= OUT.x + 2` and right of Rf's label; input labels clear of the node column | measured sizes; a long label no longer makes the region infeasible |
| A.1 sources | not part of the template | a `follow` link slot: the source on each input's net, each one stepped right of the one above, so its wire runs up past it and turns once | case 3's V3 had a step in its wire because the sources were stacked in one column |
| A.1 pre-routed runs | none (only A.2 trunks) | the summing node column and the output line (OUT to the tap column and on to Rf) are pre-routed | the 0a router joined the load to the feedback row instead of the output line |
| Boundary terminals | "endpoints whose nets leave the region" | a template may list them (A.1 lists only R_i[1], U1 OUT and IN+); other member pins take no part in the straight-wire pass | Rf[2] was lined up with the load and pulled it up to the feedback row |
| Op-amp non-inverting | feedback resistor above the op-amp; ground resistor vertical below the IN- node | the op-amp is mirrored (IN+ on top) and the feedback network hangs below it | with IN- on top, a ground resistor below the node always crosses the IN+ input wire |
| Voltage divider | one column, tap to the right | the two resistors 4 G apart; the tap is a T in the middle | with 2 G the straight-wire pass put a sideways tap 1 G off the junction (a step) |
| Pull-up / pull-down | resistor between a signal net and a rail | only for a rail drawn as a symbol and a signal net with 3+ endpoints; orientation only (the 0a defaults already placed them) | a two-endpoint net is a series path (the LED template's) |
| LED + resistor | in line, resistor first | vertical when the cathode goes to a ground symbol, else horizontal; a battery loop with wired supply and ground (case 1) matches neither and keeps its loop drawing | the owner accepted case 1's loop; an LED hanging from a pin to ground is drawn vertical |
| Template priority in incremental mode | not stated | linking constraints are `template` priority normally, `templateSoft` (below `prev`, above `prevAffected`) in incremental mode | untouched parts staying put wins over re-linking them (gate 4) |
| Abandoning a template | on two disagreeing child locks | a region whose interior has no solution, or whose members overlap, is left out (`templates.skip`) and the layout runs again; if the global solve conflicts, routing fails or the drawing fails layers 1-2, the layout runs again without templates (in incremental mode only after the edit's reroute attempt) | a template must never cost a valid drawing |
| Router (step 7) | join the tree at any point except pins and junctions | first try without joining 1 G from a bend or junction of the same net, then anywhere | a T beside a corner reads as a step, a T beside a T as two dots one step apart |
| `layout.basis` | templates are part of it | `LayoutState.templates` lists `id@version:parts` of every region used | the basis hash is not built yet; this records its template part |

### Measured

| | main (before) | templates (after) |
|---|---|---|
| Case 1 | crossings 0, bends 4, length 34, no breach | unchanged |
| Case 3 | crossings 0, bends 9, length 82, dots 4 (1 G apart), jogs 2; breaches: dot spacing, jogs | crossings 0, bends 8, length 88, dots 4 (2 G apart), jogs 0; no breach |
| Case 5 | crossings 2 (1 G from a dot), bends 6, length 110, squeezed runs 1, sheet 52x54; breaches: crossing beside a dot, squeezed wires | crossings 2 (2 G from dots), bends 4, length 150, squeezed 0, sheet 88x35; no breach |
| 300 generated circuits | 285 valid; 291 readability breaches, 350 crossings | 285 valid; 173 breaches, 263 crossings |
| Random edits, the 80 seeds of `tests/edits.test.ts` | 68 of 74 stable (91.9%) | 70 of 74 (94.6%) |
| Random edits, 300 seeds | 249 of 277 (89.9%) | 241 of 277 (87.0%) |

The 300-seed stability is lower: a region moves as one block, so an edit that changes a region (a new input resistor, a removed peripheral turning the I2C region into a pull-up) or pushes a region aside in its column moves several untouched parts at once.

### Next: H-bridge, low-side switch, bridge rectifier, decoupling

The matcher data for all four is in `library.ts` with `status: "stub"` and provisional pin names (`D`/`G`/`S`, `C`/`B`/`E`, `A`/`K`); check them against the new symbols, then add:
- **Low-side switch:** interior constraints: load vertical above the transistor on one x (`pin(load, SW).x = pin(q, D).x`), drive resistor horizontal left of the gate in line (`pin(rg, CTL).y = pin(q, G).y`), source down to ground; an optional flyback slot (diode across the load, `many: { min: 0 }`) placed parallel to the load. Boundary: the drive resistor's input and the supply.
- **H-bridge:** two legs as two columns (`qa_hi` above `qa_lo`, `qb_hi` above `qb_lo`, x equal per leg), load horizontal between the leg midpoints, gate drives outward: a `follow` link slot per gate for its resistor, left of the left leg and right of the right leg (the right leg mirrored: orientation `{ rot: 0, flip: true }`).
- **Bridge rectifier:** two vertical diode legs side by side, AC inputs at the leg midpoints on the left, + at the top and - at the bottom: equalities on the diode pins plus pre-routed runs for the + and - rails.
- **Decoupling:** a child slot (SPEC 9.2 step 1). The engine needs one change: letting a part of one region be bound by another template's slot inside it (today a part belongs to one region). The capacitor stands vertical next to the IC power pin; the `decouples` hint chooses the IC, otherwise the nearest in flow order (low confidence).
