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

## Symbols

The Phase 0b symbol types used by the frozen cases are in `src/symbols/library.ts`: `diode`, `npn`, `pnp`, `nmos`, `pmos`, `polarised-capacitor`, `potentiometer`, `spst`, `pushbutton`, `buzzer`, `motor`, `relay`, `fuse`, `ac-source`, and the generated `header`. All are drawn for this project (`source: "original"`, IEEE/US style, grid units; nothing copied from circuit-diagram.org or any other library). Pin numbers, names, aliases, roles and chain are exactly those of `phase0/proposed-symbols.json` (copied into `tests/symbols.test.ts`, which checks them). Every symbol passes the 7.1 loader check in all 8 orientations; one small circuit per symbol (`tests/support/symbol-circuits.ts`) lays out `valid` and passes layers 1 and 2. `npm run draw:symbols` writes those circuits and a symbol sheet to `out/symbols/`.

Layout changes are small: `pinDefsOf` reads header pins from the part; the placement loop builds a header with `headerFor` and asks `defaultOrient` (new file `src/layout/kinds.ts`) for the new kinds; the artwork loop draws a symbol's fixed `texts`; labels fall back to `partNumber`.

| Area | SPEC says | 0b does | Why |
|---|---|---|---|
| Text in symbols (7.1) | no text except through `labels` | a symbol may carry fixed `texts` (centred, upright): relay terminal numbers A1 A2 11 12 14; header pin names and numbers | without them a relay's NO and NC, and a header's pins, cannot be told apart |
| Header pins (7.2, 7.3) | `pins` only for `ic` and custom parts; unused IC pins hidden | `header` parts carry `pins` like `ic`; a header draws **every** declared pin, in declared order, in one column leaving right (mirrored when its nets lie to the left); a pin without a role is `passive` unless its name says supply or ground | a connector shows all its positions; names like `COM` are not chip I/O |
| Relay (7.2 "one symbol") | not specified | coil plus one changeover contact, 5 pins (A1, A2, 11 COM, 12 NC, 14 NO), as proposed | follows the proposal |
| Default orientations (9.2 step 3b) | ICs, sources, two-pin parts | transistors: N types emitter/source down, P types up, mirrored top-bottom when the supply sits on the other pin; base/gate mirrored left-right to face a driver on the right. Potentiometer: as a two-pin part on pins 1 and 3, wiper to the right when vertical. Relay: rotation 0. AC source: as a source, pin 1 up | — |
| Part label | value, else label, else colour | then `partNumber` (2N2222A, 1N4148) | transistors and diodes in the cases carry only a part number |
| AC source pins | — | role `passive` (as proposed), while `vsource` uses `output` | layout ranks sources by symbol kind, so the role does not change the drawing |

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

Reads `phase0/cases/validation/*.json` and the edit scripts for cases 3, 5 and 7, whose file names it builds from the case numbers (it never lists `phase0/cases/edits/`). `--test` adds `phase0/cases/test/` and the case 11 scripts, for the end gate only. A case with a part type the layout cannot draw is reported as `missing symbol: X`. Output: `out/phase0/validation/<case>.svg|png` and `summary.json`; `out/phase0/edits/<script>.before.svg|png`, `.after.svg|png` and `summary.json` with the gate 4 figures and both affected-part lists. The 2026-10-25 continuation also writes `out/phase0/gates.json` and exits 1 for failed case/status/overlap checks, unexpected edit outcomes or failed stability checks. Ratings, benchmarks and successful validation subsets remain explicitly incomplete against the full gates. Cases 1, 3 and 5 draw byte-identical SVG and PNG to `npm run draw` on `cases/`.
