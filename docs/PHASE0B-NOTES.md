# Phase 0b: build notes

For the later gate-reporting, decoupling-slot and PNG-scale changes, see [2026-10-25 build progress](PHASE0B-PROGRESS-2026-10-25.md). The notes below describe the earlier implementation snapshot.

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
| `setSpacing` (11.3) | factor | factor f adds round((f - 1) x 4) G to every gap; runs a canonical layout | - |
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

## Symbols

The Phase 0b symbol types used by the frozen cases are in `src/symbols/library.ts`: `diode`, `npn`, `pnp`, `nmos`, `pmos`, `polarised-capacitor`, `potentiometer`, `spst`, `pushbutton`, `buzzer`, `motor`, `relay`, `fuse`, `ac-source`, and the generated `header`. All are drawn for this project (`source: "original"`, IEEE/US style, grid units; nothing copied from circuit-diagram.org or any other library). Pin numbers, names, aliases, roles and chain are exactly those of `phase0/proposed-symbols.json` (copied into `tests/symbols.test.ts`, which checks them). Every symbol passes the 7.1 loader check in all 8 orientations; one small circuit per symbol (`tests/support/symbol-circuits.ts`) lays out `valid` and passes layers 1 and 2. `npm run draw:symbols` writes those circuits and a symbol sheet to `out/symbols/`.

Layout changes are small: `pinDefsOf` reads header pins from the part; the placement loop builds a header with `headerFor` and asks `defaultOrient` (new file `src/layout/kinds.ts`) for the new kinds; the artwork loop draws a symbol's fixed `texts`; labels fall back to `partNumber`.

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| Text in symbols (7.1) | no text except through `labels` | a symbol may carry fixed `texts` (centred, upright): relay terminal numbers A1 A2 11 12 14; header pin names and numbers | without them a relay's NO and NC, and a header's pins, cannot be told apart |
| Header pins (7.2, 7.3) | `pins` only for `ic` and custom parts; unused IC pins hidden | `header` parts carry `pins` like `ic`; a header draws **every** declared pin, in declared order, in one column leaving right (mirrored when its nets lie to the left); a pin without a role is `passive` unless its name says supply or ground | a connector shows all its positions; names like `COM` are not chip I/O |
| Relay (7.2 "one symbol") | not specified | coil plus one changeover contact, 5 pins (A1, A2, 11 COM, 12 NC, 14 NO), as proposed | follows the proposal |
| Default orientations (9.2 step 3b) | ICs, sources, two-pin parts | transistors: N types emitter/source down, P types up, mirrored top-bottom when the supply sits on the other pin; base/gate mirrored left-right to face a driver on the right. Potentiometer: as a two-pin part on pins 1 and 3, wiper to the right when vertical. Relay: rotation 0. AC source: as a source, pin 1 up | - |
| Part label | value, else label, else colour | then `partNumber` (2N2222A, 1N4148) | transistors and diodes in the cases carry only a part number |
| AC source pins | - | role `passive` (as proposed), while `vsource` uses `output` | layout ranks sources by symbol kind, so the role does not change the drawing |

Known limits: a relay or header turned by 90 degrees keeps its texts upright and centred, which can bring them close to a lead (no default orientation does this). Relay contacts routed around the top and drivers placed right of their transistor are flow and template work.

## File shape and modules

Built 2026-10-25 for the frozen cases (`phase0/HANDOFF.md`, "What Phase 0b must add", items 2-5). Where the spec is silent, the simplest rule consistent with it was chosen; each such rule is marked **decision**.

| Piece | Where | Tested by |
|---|---|---|
| Loader for the SPEC 6.5 file and the Phase 0a shape; canonical save | `src/io/project.ts` | `tests/io.test.ts` |
| Module library (the four corpus modules, byte-identical to `phase0/modules/`) and the module check | `src/modules/` | `tests/io.test.ts` |
| `decouples` hints in intent, with their checks | `src/core/intent.ts` | `tests/io.test.ts` |
| Edit scripts read from a file's `ops` array and applied through `edit()` | `src/io/edit-script.ts` | `tests/io.test.ts` |
| Phase 0b case run: validation cases, edit scripts, gate 4 numbers | `scripts/phase0.ts` (`npm run phase0`) | run by hand; writes `out/phase0/` |

### Reading and writing files

- **Two shapes.** A file with `schema` is a SPEC 6.5 project file; a file without it is the Phase 0a shape (`meta` + `circuit`, endpoints by name). `schema` must be `schem/MAJOR.MINOR`; a major other than 1 is refused (`E101`).
- **Saving always writes the SPEC 6.5 form** (decision): key order `schema, meta, circuit, intent, assets, [layout], ext`; parts `id, type, props, pins`; nets `id, name, kind, domain, endpoints`; hints `id, type, <fields>, priority`. Endpoints and no-connect marks are written canonically and sorted in natural order (`U1[7]` before `U1[20]`), which is the order the frozen cases use: cases 2 and 7 load and save back byte for byte. `props`, pins, asset definitions and `ext` keep their own key order. A Phase 0a file is upgraded on save (schema `schem/1.0`, default intent with style `clean` / `ieee`, `assets.library` `schem-symbols@0.0.1` when the file names none).
- **`meta.nextNetId` / `nextHintId`** (decision): written as the larger of the stored value and the highest id in use plus one. `src/core/ops.ts` still numbers new nets from the highest id in use, so a deleted net's id can come back within one session. Making `connect` read `meta.nextNetId` is left for Phase 1.
- **`ext`** is copied as read, kept through edits and renames, and never interpreted.
- **Unknown fields** (SPEC 6.6): any key outside `ext` that this version does not know is listed in `unknownFields` (for example `circuit.parts[R1].tolerance`) with warning `W105`. The file still lays out; edit scripts are refused (`E105`) and `saveProject` throws, because writing would lose the field. `props` are open (type-specific) and never count as unknown.
- **`layout`** is kept as read (`layoutCache`) and dropped by any edit, since it is a cache.
- **Unknown hint types** (`near`, `flow`, `group`) are refused at load with the supported list (`E260`) (decision): their JSON shapes are not designed yet, and dropping them silently would lose intent.
- **Part types.** A fixed symbol (`BUILTIN`) and a module may not carry `pins` (`E203`); `ic` must (`E203`); `header` and **any other type with `pins`** are parts with their own pins (SPEC 6.2 rev C.3 for `header`; decision for other custom types). Pin roles come from the layout's own reading where it knows the type (a header pin without a role is `passive` unless its name says supply or ground), else from the SPEC 7.3 defaults. A type that is none of these is `E201` and listed in `missingTypes`.
- Error codes added: `E100` not JSON, `E101` schema, `E102` file shape, `E105` edit refused for unknown fields, `E108` operation not supported yet, `E202` module, `E203` pins on a part, `E260` hint shape or id, `E261`/`E262` decouples target, `W263` decouples placement, `E270` pin sides on a fixed symbol, `W105` unknown fields.

### Modules (SPEC 7.3)

- **Definition shape** (decision, AUTHOR-NOTES item 4): `{ id, version, kind: "module", name, refPrefix, controller?, doc: { url, revision, ... }, pins: [ { number, name, role, aliases?, group?, iface?, chain? } ] }`. The check (`E202`) requires the id to equal its key and look like `module:name`, a documentation `url` and `revision`, unique pin numbers usable inside `[...]`, known roles, and aliases unique within the part. No geometry: a module is drawn as a generated box, like `ic`.
- **Where a definition comes from** (decision): the file's `assets.definitions` first (the file renders the same if the library changes, SPEC 6.5), else the shipped library, in which case the definition is copied into `assets` so the saved file is self-contained. Module definitions no part uses are dropped on save. Non-module entries in `assets.definitions` are kept as read and not interpreted; the engine does not yet write built-in symbol definitions into `assets` (its symbol format is not the SPEC 7.1 shape yet).
- **In memory a module part is an inline-pin part** (decision): it gets `pins` (a copy of the definition's) and, for a `controller: true` module, `props.controller: "true"` unless the part sets `controller` itself. The layout already reads both, so no layout change was needed. Saving removes both again. Consequences: a part may override the flag with `controller: "false"`; a redundant `controller: "true"` written on a controller module is dropped on save.
- **`props.controller` on an `ic` counts** (AUTHOR-NOTES item 16): the layout already treats it as a flow source; nothing changed.
- **Group representative** (SPEC 6.2 and 7.3, rev C.3 ruling): a module definition may carry `representatives: { <group>: <pin number> }` (checked: the pin must be in that group, `E202`). The loader marks that pin `representative: true` in the part's pins, and `groupRepresentative` (src/core/validate.ts, used by the layout, verifier and convention checks alike) takes it unless it is marked no-connect; otherwise the lowest-numbered member in natural order. The four shipped modules are frozen copies and name none, so the Uno's GND group still lands on `ICSP1-6` until a definition names one.
- **Board supply pins** (rev C.3 ruling): roles stay as the module files give them (usual USB supply). The engine has no unconnected-supply warning yet (only `phase0/check-cases.ts` computes one), so the module exemption has nothing to switch off; whoever adds the warning must skip module pins.
- **`addPart` of a module** in an edit script takes the pins and the definition the same way.

### Hints and edit scripts

- **`decouples`** (AUTHOR-NOTES item 15): `{ id, type: "decouples", part, pin, priority }`. `part` must be a capacitor (`capacitor` or either spelling of the polarised capacitor, `E261`); `pin` must resolve (any endpoint form) to a terminal or group of another part (`E262`); it is written canonically on save. A capacitor that is not on the pin's net, or has no other net, is a warning (`W263`), not an error. Two capacitors on one pin are allowed (item 17). The layout does not use the hint yet (templates).
- **Edit-file shape** (item 18, SPEC 11.4 rev C.3): `{ ops: [...], expectedRevision?, expectedLayout? }`, or a bare list of operations; the Phase 0b fields `schema`, `case`, `edit`, `description` and `expect: { ok: true | false | "either", affectedParts? }` are read by the script runner and ignored by the edit. Every operation's fields are checked before anything runs (`E102`); `setHint`, `clearOverride` and `setNetStyle` are refused as not built yet (`E108`).
- **Affected parts** (SPEC 9.5, rev C.3 ruling): `edit()` now leaves port-drawn power and ground nets out of the spread. For a changed net that the previous layout drew only with ports (`LayoutState.routes[net].ports`; without a previous layout, the layout's rule: a named power or ground net with three or more endpoints), only parts whose own endpoints changed count. Gate 4 uses this. The frozen `expect.affectedParts` (rev C.2 table) is reported next to it, not trusted: they differ on case03-remove-part (`Rf U1` against `Rf U1 V1 V2 V3`), case05-add-part (`C1` against all six parts), case07-add-part (`C5 R1 U1` against nine) and case07-remove-part (`U2` against nine). Hints removed by `removePart` do not make their parts affected; an explicit `removeHint` does (case07-remove-part: `U2`, from hint h4's pin).
- **`setPinSides` on a fixed symbol is rejected** (`E270`, SPEC 11.3 rev C.3 ruling). Only generated boxes (`ic`, `header`, modules) have pin sides. The error names the equivalent `setOrientation` when one exists: the first orientation (in `ORIENTS` order) that puts every listed pin on its side in the listed order. For case 3's op-amp (IN+ above IN- on the left, OUT on the right) that is `{ rot: 180, flip: true }`; otherwise the error says no orientation gives it. Case 3's script expects `"either"`.
- **`removePart` and intent** (SPEC 11.3 rev C.3 ruling): in the same transaction the part's lock, label-side override and every hint naming it are removed (an `align` hint keeps its other parts if two remain; a `decouples` hint goes when its capacitor or its pin's part goes). `EditResult.removedHints` lists the removed hint ids (explicit `removeHint` ids are not repeated), and the script runner passes them on. `renamePart` rewrites the part in a `decouples` hint's `pin`.

### `npm run phase0`

Reads `phase0/cases/validation/*.json` and the edit scripts for cases 3, 5 and 7, whose file names it builds from the case numbers (it never lists `phase0/cases/edits/`). `--test` adds `phase0/cases/test/` and the case 11 scripts, for the end gate only. A case with a part type the layout cannot draw is reported as `missing symbol: X` (none since the 0b symbols landed); any other failure is reported per case, and the run exits 1 on a crash, a drawing the verifier rejects, or a gate the validation subset already fails; it also writes `out/phase0/gates.json` (`scripts/lib/phase0-gates.ts`), where ratings and benchmarks stay explicitly incomplete. Output: `out/phase0/validation/<case>.svg|png` and `summary.json`; `out/phase0/edits/<script>.before.svg|png`, `.after.svg|png` and `summary.json` with the gate 4 figures and both affected-part lists. Cases 1, 3 and 5 draw byte-identical SVG and PNG to `npm run draw` on `cases/`.

### `npm run gates`

`scripts/gates.ts` measures the SPEC 15 Phase 0b gates; the gate arithmetic is `scripts/lib/gate-math.ts` (tested in `tests/gates.test.ts`), and the case and edit runs are shared with `npm run phase0` in `scripts/lib/case-run.ts`. Default mode: validation cases 1-8 and the edit scripts of cases 3, 5 and 7; `--test` (end gate only) adds cases 9-12 and the case 11 scripts. Every gate is "k of n": a run that has not measured everything still says `pass` or `fail` when the missing items cannot change the result, else `incomplete`. Exit 1 on any `fail` or crash. Output in `out/gates/<set>/` (`gates.json`, drawings, findings, edits, renders, packs).

- **Gate 1**: verifier valid and status `valid`, or `valid_low_confidence` on case 8 only.
- **Gate 4**: a saved edit passes when its change report has no breaks; a rejected edit fails, except case 3's `setPinSides` (SPEC 15).
- **Gate 6**: the full pipeline (layout, layers 1-4, `review()` with its fix dry-runs), 1 cold + `--runs` (7) warm runs, median and p95; pass = warm p95 < 3 s (SPEC 13 item 11). Circuits: case 11 (`--test` only; the default mode times the largest validation case on the same code path, for information) and `generate(30, 16)` from `tests/support/generate.ts` (the first seed with exactly 30 parts and at most 150 pins: 30 parts, 68 pins).
- **Gates 2, 3, 5** (decision): each case is drawn as `schem-noedit` and `schem-edit`. The edit call is `<agent-edits>/caseNN.json` (default `out/gates/<set>/agent-edits/`, edit-script shape, at most 3 visual operations, no `lock` with `at`) when an agent wrote one from `findings/caseNN.json`; otherwise the runner stands in for the agent with the first checked fix that has no trade-off and does not change the circuit; with none, the after-edit drawing is the no-edit one. A refused call also leaves the no-edit drawing. Baselines come from `baselines/out/<tool>/<set>/caseNN/final.png`, looked up by the ids of the cases the run drew. All go into one pack (`phase0/judge/blind-pack.ts`, `--pairs ours` by default) in `packs/panel-<hash of images, seed, judges, pairs>`, so an unchanged run reuses the pack and keeps the answers in it. `--ratings owner.json` (judge-answer shape; its `pack` names the pack) runs `phase0/judge/tally.ts` and decides the gates on the owner's scores; with judge answers only, on the panel median, marked as an estimate. Gates 2, 3 and 5 use the **after-edit** score; gate 5 counts a case once ours and at least one baseline are rated, and a tie with the best baseline is a success.

## Templates (SPEC 9.4)

Built on 2026-10-25: the template mechanism and six templates. Case 3 and case 5 now lay out with no readability breach (the `known` table in `tests/quality.test.ts` is empty for both); case 1 matches no template and is unchanged.

| Piece | Where | Tested by |
|---|---|---|
| Template data types: slots (part types, pin and interface roles, pin-to-net predicates, many-slots, follow-slots), orientations, label sides, pin sides, ranks, difference constraints (`interior`, `link`), boundary pins, pre-routed runs | `src/layout/templates/types.ts` | `tests/templates.test.ts` |
| Engine: matching, overlap resolution, interior solve (step 5), linking constraints, runs | `src/layout/templates/engine.ts` | same |
| Templates: op-amp inverting / summing, op-amp non-inverting, I2C pull-ups, voltage divider, pull-up, pull-down, LED + resistor (vertical to a ground symbol, else horizontal); round 2: H-bridge (MOSFET and BJT), low-side switch (relay coil or two-pin load), bridge rectifier. Decoupling is not a template: `src/layout/decoupling.ts` on main | `src/layout/templates/library.ts` | same; drawings by `npx tsx scripts/templates.ts` |
| Hooks in the layout: block ranks, block columns and ordering, rigid regions, link constraints, template runs, fallbacks, `LayoutResult.blocks`, `LayoutState.templates` | `src/layout/layout.ts` | all layout tests |

### Where this differs from SPEC.md (to fold into the spec)

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| A.2 ranks | U2 and U3 rank 2 | peripherals get ranks 2, 3, ... in canonical order, one column each | in one column they would be stacked; "peripherals in one row" needs them side by side |
| A.2 controller pin sides | GPIO21 and GPIO22 on the right, SDA above SCL | the same, placed after the controller's other right-side pins (`setPinSides` from an edit still puts its pins first) | the bus trunks then run below the other right-side wires and their pull-ups |
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
| Random edits, the 80 seeds of `tests/edits.test.ts` | 65 of 74 stable (87.8%) | 68 of 74 (91.9%) |
| Random edits, 300 seeds | 239 of 277 (86.3%) | 231 of 277 (83.4%) |
| `npm run phase0`, readability breaches per validation case 1-8 | 0, 1, 2, 1, 2, 1, 0, 2 | 0, 0, 0, 1, 0, 1, 0, 2 |

"main" is main after the rev C.3 merge (symbols, loader, affected-part rule). The 300-seed stability is lower: a region moves as one block, so an edit that changes a region (a new input resistor, a removed peripheral turning the I2C region into a pull-up) or pushes a region aside in its column moves several untouched parts at once; a part no longer reached from a source after a removal is ranked after the I2C peripherals' columns. Keeping regions that hold an affected member out of the incremental column-separation skip made it worse (81%), so that was not kept.

Case 7 (two ICs, I2C EEPROM): the I2C template gives no crossing beside a dot and no squeezed wires, and 1 crossing instead of 3, because a template's pin sides go **after** the other pins of that side (here RESET above PC4/PC5). Listed first, the trunks ran through the RESET pull-up and were left to the router.

### Round 2: H-bridge, low-side switch, bridge rectifier, router (2026-10-26)

The three remaining templates are switched on, each with a test circuit in `tests/support/template-circuits.ts` (written from the SPEC 9.4 table) and a test in `tests/templates.test.ts` that checks the table's constraints: bridge rectifier (AC source, four diodes, smoothing capacitor, load), BJT H-bridge without base-emitter resistors, low-side NPN motor switch with a flyback diode and no pull-down. Case 4 (MOSFET H-bridge) and case 6 (relay) cover the other variants. Decoupling is the owner's `src/layout/decoupling.ts` on main, not a template; the stub is gone.

- **Fixed:** the H-bridge and low-side templates kept the drive resistor clear of the transistor only through the optional gate-source or pull-down resistor, so without one the two overlapped and the template was abandoned. Each now has its own constraint: the control pin at least 2 G from the drive resistor's pin.
- **Module names as labels:** a module part shows its definition's `name` (case 6's U1: "ESP32-DevKitC V4") when it has no value, label or part number. The loader and `addPart` set it in memory as `Part.title`; it is never saved.
- **Router (SPEC 9.2 step 7), four changes:**
  1. Goal test on pop: the join onto the net's tree is pushed as a state with its full cost (last step and turn included) and the search returns when it is popped. Before, it returned on the first generated neighbour of the tree, so a route with an extra bend could win a tie on everything except its uncounted last turn.
  2. Hug cost (2 per unit step alongside another net's wire on the adjacent track): the squeezed-run metric, priced in the search.
  3. Jog cost (9, on top of the bend, for a bend within 2 steps of the path's previous bend): the jog metric, priced in the search. The steps since the last bend (1, 2, or "3+ or none") are part of the A* state, so the cost is exact. Without it the hug cost turned squeezed runs into jogs (generated set: jogs 64 to 107).
  4. Rip-up and reroute: at most 3 passes; each pass takes every routed net with conflicts (crossings and hugging, at the search's costs), most first, reroutes it with every other wire in place and keeps the new route only if the total falls and nothing fails. A pass that improves nothing ends it. Pre-wired, port and reused (incremental) nets are never touched.
  The crossing cost went from 8 to 12 (with the jog cost, 8 traded too many crossings for fewer jogs). Weights chosen by a small grid search on the 300 generated circuits (hug 1 to 4, jog 4 to 9, cross 8 to 12).

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| Router cost | length + bend + crossing + proximity near foreign pins | adds hug (2 per unit step on the track next to another net's wire) and jog (9 for a bend within 2 G of the previous bend); crossing 12, bend 3 | the two readability metrics the critic reports, priced where the wires are chosen |
| Rip-up passes | "a fixed number of rip-up-and-reroute passes (default 3) for nets involved in the most crossings" | a pass is a sweep over every net with conflicts (crossings and hugging), most first; 3 passes at most, ending early when a pass improves nothing | one net per pass left case 4's squeezed run: three passes went to nets whose crossings no reroute removes |
| Module label | not stated | a module part without a value line shows its definition's `name` | case 6's U1 read as a bare box |

**Measured** (`npm run phase0`, and the 300 generated circuits with `generate(seed, 5)`):

| | branch head before round 2 finished (`ee3fbe8`) | after |
|---|---|---|
| Validation readability breaches, cases 1-8 | 0, 0, 0, 1, 0, 1, 0, 2 | 0, 0, 0, 0, 0, 0, 0, 0 |
| Validation crossings, cases 1-8 | 0, 1, 0, 4, 2, 3, 1, 1 | 0, 0, 0, 2, 2, 3, 1, 1 |
| Generated: valid / breaches / crossings / bends | 281 / 156 / 219 / 2197 | 281 / 97 / 223 / 2231 |
| Generated breaches by kind | jogs 64, squeezed 67, crossing beside a dot 24, aspect 1 | jogs 25, squeezed 68, crossing beside a dot 3, aspect 1 |
| Random edits, 80 / 300 seeds | 68 of 74 (91.9%) / 231 of 277 (83.4%) | unchanged |
| Time: 300 generated layouts / case 4 layout | 2.8 s / 66-81 ms | 6.2 s / about 370 ms |

**Cost:** routing is 2 to 5 times slower (the larger A* state, the costed join, the rip-up sweeps; no search fails, the time is in successful searches: `search` itself, `edgeKey` and `pop`). Gate 6 was already failing on time; the gate 6 branch's planned work (obstacles rasterised once per route call, a reachability pre-check) speeds exactly this loop and must be measured after the merge.

Case 6 stays at 3 crossings: with J1's pins in the order COM, NO, NC and both NO and NC leaving the top of the relay on one side, every route that stays near the relay crosses three times; one crossing needs loops round J1.

**Open question for the owner:** a named power net with two endpoints and no source (a motor and its flyback diode on a 12 V net, nothing else) is drawn as a plain wire (SPEC 9.2 step 2 item 1), so the drawing never shows "12V". With a source or connector on the net (3+ endpoints) it gets ports. Should a two-endpoint power net with no source part keep a port so its name shows?

### Merge with the decoupling child slots (2026-10-28)

`main` (the owner's decoupling child slots, `522217b`, and the gate runner) merged into the templates branch. Host envelopes in the template engine include the child slots (`clusterEnv`); the templates' own decoupling stub is gone. Four interactions fixed on the way, all tests unchanged except the one noted:

- **I2C peripheral supply pin on top.** The I2C template put a peripheral's `power_in` pins on the right, so case 7's U2 VCC faced right and its capacitors C3, C4 got no slot (62 G away). The template now puts them on top after SCL and SDA, where the trunks end. `tests/templates.test.ts` (A.2) asserted the old side and now asserts the new one.
- **Room beside a decoupled top pin.** Two capacitors on one pin take both sides of it; at the 4 G pin pitch the inner one's label covered the wire into SDA and routing failed. A generated IC box now spaces a top pin with child slots from a neighbour without any (`icSymbol` `topGap`; 2 G to the capacitor, its outline, its label, 1 G clear). As a safety net, a child slot never covers the channel above another top pin of its host. Boxes without child slots draw byte-identical.
- **Pin-sides edits keep the template's sides for unnamed pins.** `setPinSides` naming only U2's bottom pins used to drop the template's sides for every pin, so U2 changed shape and C3 jumped sides (8 G). Pins the edit, a fixed placement or the previous layout name follow that; the rest keep the template's side.
- **A part that must make room moves right or down.** In incremental mode the margin constraints are off (owner's change), so when the solver dropped an untouched part's lower "previous" bound the part slid to the origin (case 3 longer value: V2 11 G). Upper bounds now have their own lower priority (`prevUp`, `prevAffectedUp`), as SPEC 9.5 and the solver comment intend.
- A shared pin's slot fills left to right, smallest capacitance first, wherever the pin sits on the box.

Result: 439 tests pass; validation cases 1-8 all `valid` (case 4 was `valid_low_confidence`); 12 of 12 validation edits pass gate 4. Case 8 (differential pair, no template) is still the weakest drawing.

### Gate 6 speed-up (2026-10-28)

After the merge, every router search on gate 6's generated circuit succeeds (451 searches, about 393,000 expansions per `review()`); the time was the cost of each expansion, not failed searches. Two changes in `src/layout/router.ts`, neither changes a result (`tests/findings-snapshot.test.ts`, re-taken on the merged code before the change, is byte-identical):

- **Forbidden geometry rasterised once per route call** on a half grid (grid points and unit-edge midpoints), the same closed-box test as `src/geom/forbidden.ts`; a point off the raster falls back to that test.
- **Numbers instead of strings** for grid points, unit edges and search states (coordinates within +-4096 G keep every key a small integer; outside that the router throws), wire directions as bit masks, and an inner loop without allocations.

The planned reachability pre-check was not needed: no search fails on the validation set or the generated circuit.

| | before (merged code) | after |
|---|---|---|
| Generated 30-part circuit, warm median / p95 | 2868 / 3086 ms (FAIL) | 1664 / 1822 ms (pass) |
| Case 4, warm median / p95 | 330 / 349 ms | 81 / 103 ms |

Timings on a loaded Windows laptop; the same run varies by up to 2x between repeats with identical work, so the margin to 3 s matters more than the exact figure.
