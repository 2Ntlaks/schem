# DeepSeek Part A report: validation baselines

Branch: `deepseek/step2-showcase`. Part A only. Part B was not started.

## What I did

I finished the three tools' validation baselines for cases 1-8 and wrote the baseline documents.

1. Wrote the schemdraw first attempts for cases 6, 7 and 8 (`baselines/scripts/schemdraw/validation/caseNN/attempt-1.py`).
2. Fixed schemdraw case 5, whose first attempt failed its connection check (SDA and SCL merged), in attempt 2,
   then spent two more revisions on the pull-up labels.
3. Reviewed every attempt-1 image of all three tools for drawing-level errors. The observations are in
   `baselines/LOG.md` under "Attempts".
4. Revised within the budget (1 initial attempt plus at most 3 revisions per tool per case), using only the
   tools' own levers: schemdraw code, the SKiDL `options` and `parts` config, and the netlistsvg `parts.*.dirs`
   config. No case was given a special tool-wide setting.
5. Chose one `final.png` per tool and case from attempts whose check passes, copied it next to the attempts,
   and recorded the choice and reason in `baselines/LOG.md`.
6. Wrote `baselines/CONNECTIONS.md` from the final attempts' `.check.txt` files and `baselines/README.md` with
   the rerun steps.
7. Rewrote the status table and attempts section of `baselines/LOG.md` for the validation rows.
8. Ran the AGENTS.md checks, committed on the branch, and wrote this report.

All 24 final checks pass. All 24 `final.png` files match the attempt they were copied from (hash check).

## Final choices

| Case | schemdraw | SKiDL | netlistsvg |
|---|---|---|---|
| 1 | 3: "+" beside the positive plate | 1: clean wired loop | 1: clean split-power loop |
| 2 | 3: VOUT and "+" clear of wires | 1: clean divider and follower | 1: clean |
| 3 | 1: clean summing amplifier | 1: readable summer | 1: readable summer, no overlaps |
| 4 | 4: all part labels clear of wires | 4: best of four seeds, parts separated | 2: transistor ports on logical sides |
| 5 | 4: pull-up labels off the buses | 1: only seed with U1 not squeezed | 1: clean |
| 6 | 3: U1 value fits, relay labelled | 1: full relay circuit drawn cleanly | 1: clean |
| 7 | 3: labels clear, orthogonal leads | 4: ICs clear, passives hidden | 1: all parts drawn, titles busy |
| 8 | 4: labels clear, mirror wire orthogonal | 1: clean pair and mirror | 1: clean pair and mirror |

The reasons per attempt, and what each revision changed, are in `baselines/LOG.md`.

## Commands run and results

Baseline runs used `baselines/scripts/run_<tool>.sh validation NN K` from the repo root in Git Bash. Some
attempts were rerun after an edit, but each runner writes the same `attempt-K` files, so only the last run of
an attempt is on disk.

- schemdraw: case 1 attempts 1-3, case 2 attempts 1-3, case 3 attempt 1, case 4 attempts 1-4, case 5 attempts
  1-4, case 6 attempts 1-3, case 7 attempts 1-3, case 8 attempts 1-4. Every run reports `check: PASS` except
  case 5 attempt 1, which is FAIL and cannot be chosen.
- SKiDL: case 4 attempts 2, 3 and 4; case 5 attempts 2 and 3; case 7 attempts 2, 3 and 4. The first attempt-2
  runs for cases 4 and 7 used an invalid `expansion_factor` key and ended in `TypeError` with no image; the
  reruns without that key fell back to `auto_stub` and report `check: PASS`. All other attempts report PASS.
- netlistsvg: case 4 attempt 2, `check: PASS`.

AGENTS.md checks:

- `npm run typecheck`: passed, no output.
- `npm test`: 16 files, 449 tests, all passed (12.49 s).
- `npm run phase0`: all 8 validation cases `valid`. Case 8 reports 1 overlap and is still `valid`; the other
  validation cases report 0 overlaps. The command also printed the gate summary, which is incomplete for gates
  1-6 because the test set and the owner's ratings are outside this runner.

## Files changed

Tracked changes (the report and these are committed on the branch):

- `baselines/LOG.md`: new status table, final choices, all attempts, known defects, corrected harness notes.
- `baselines/CONNECTIONS.md`: new, validation nets and final attempts, built from the final `.check.txt` files.
- `baselines/README.md`: new, what the baselines are and how to rerun them.
- `baselines/scripts/schemdraw/validation/case01/attempt-{2,3}.py`,
  `case02/attempt-{2,3}.py`, `case04/attempt-{2,3,4}.py`, `case05/attempt-{2,3,4}.py`: new revisions.
- `baselines/scripts/schemdraw/validation/case06/attempt-{1,2,3}.py`,
  `case07/attempt-{1,2,3}.py`, `case08/attempt-{1,2,3,4}.py`: new drawings and revisions.
- `docs/agent-reports/deepseek-step2-showcase.md`: this report.

Not committed, because the repo already ignores every `out/` directory: all images, SVGs, check files,
`final.png`, the neutral netlists and the SKiDL/netlistsvg config files under `baselines/out/`. They are on
disk and rebuildable with the commands above.

## Skipped or could not do

- **SKiDL cases 4 and 7 cannot be routed in wired mode.** `generate_svg` raises `RoutingFailure` for both, with
  `auto_stub` off and `retries` 4, and falls back to label mode. All four seeds were tried. Case 7's fallback
  stacks C1-C4, R1-R3 and J1 at one point behind U1, so only the two ICs are visible. Case 4's best seed still
  has R5's value on R7 and two "12V" labels colliding. These are the tool's honest output.
- **SKiDL case 5** clips the U2 and U3 boxes at the sheet frame and their values at the edges. Seeds 2 and 3
  were worse (U1 squeezed, labels on pins), so attempt 1 is the final.
- **netlistsvg case 3** has two long source wires crossing the middle. No config lever removes them without
  making the layout worse; the check passes and no overlap hides a connection.
- **schemdraw** is hand-written, so its drawings are not comparable to the automatic tools in effort. The
  hand-written code and every revision are kept so the owner can see what was done.
- Part B was not started, as instructed.

## Open questions

1. `baselines/out/` is ignored by the repo's `out/` rule, so the images and `final.png` files are not in the
   commit. Should the final images be force-added (for example `git add -f baselines/out/*/validation/*/final.png`)
   before the blind comparison, or does the lead's kit rebuild them?
2. The judge kit wants `<tool>__caseNN.png` in one folder. I left that copy step to the lead; should I add it to
   the README or to a script?
3. SKiDL case 7's fallback hides eight parts. I kept it as the tool's honest output rather than editing the
   drawing. Is that acceptable for the comparison, or should the case be marked as a tool failure on the page?

## Rework after the lead's Part A review

This section records the rework the lead asked for after reading the Part A report. Where it conflicts
with the earlier text above, this section is the current state. The branch is still
`deepseek/step2-showcase`; Part A only, Part B not started.

### 1. schemdraw case 6: R1 now ends at the tap

Attempt 3 drew R1 from (5.6, 7) to its default end near 8.6 and then tapped the base wire at 7.5, so the
base wire left the middle of R1's lead and about 1.1 units of that lead dangled.

Attempt 4 (`baselines/scripts/schemdraw/validation/case06/attempt-4.py`) draws R1 with
`elm.Resistor().at((5.6, 7)).to((7.5, 7))` and starts the base wire at `r1.end`. The check is PASS and the
zoom on R1 shows no dangling lead. Attempt 4 is the new final.

The long 5 V and GND rails at the right of that drawing still end in space. That is a separate known
defect and is listed in `baselines/LOG.md`.

### 2. netlistsvg revisions within the budget

Only per-case config keys were used: `parts.<ref>.dirs`, `parts.<ref>.type` and `parts.<ref>.title`. The
tool-wide settings (`splitKinds`, `noSplitNets`) were not touched.

- **Case 1**: attempt 1 ran the battery value "470" into B1. Attempt 2 changes R1 to the skin's horizontal
  resistor (`r_h`), so the ref and value sit above and below the body. Check PASS. The rectangular body is a
  style difference from the zigzag `r_v` used elsewhere; that is noted in `baselines/LOG.md`. Attempt 2 is
  the new final.
- **Case 3**: attempt 2 swapped R1's `dirs` and changed nothing. Attempt 3 made R1 horizontal (`r_h`), which
  clears the text but wraps the SUM net in a closed rectangle around R1, with R1's lead crossing that wire.
  Attempt 4 (horizontal R1 plus `dirs`) is identical to attempt 3. All checks PASS, but both horizontal
  versions are more misleading than the text collision, so attempt 1 stays the final and the collision is
  listed as a known defect.
- **Case 4**: attempt 3 set M1 to 1=input, 2=output; the M1 title is still crossed and the top of the drawing
  becomes a tangle of long wires. Attempt 4 set M1 to 1=output, 2=input; M1 then sits beside Q4 and its title
  runs into Q4's "drain" label. Both checks PASS, but both are worse than attempt 2, which stays the final
  with the M1 title crossing reported.
- **Case 6**: attempt 2 (`dirs`) moved the 5 V symbols but the titles still crossed wires and a pin label ran
  into GND. Attempt 3 shortened the titles to "U1 ESP32" and "K1 relay" and both clear the wires. Attempt 4
  uses "U1 ESP32" and "K1 5 V relay", so the relay voltage is kept and only the part numbers are lost. Both
  checks PASS; attempt 4 is the new final, and the missing part numbers are listed as a known defect.
- **Case 7**: attempt 2 shortens the titles to "U1 ATmega328P" and "U2 24LC256", which removes the repeated
  part numbers and the long overhang. Check PASS. The titles still sit just above the VCC pin labels; that is
  the generic skin's fixed title position and is listed as a known defect. Attempt 2 is the new final.

The totals in `baselines/LOG.md` are now schemdraw 27 attempts, SKiDL 16 and netlistsvg 19, each within the
budget of 1 plus at most 3 revisions per case.

### 3. schemdraw case 7: SDA and SCL labels off the wires

The full-size re-review found that attempt 3 placed the SDA and SCL labels with `S.label(loc="top")` and
`S.label(loc="bottom")` but the bus wires still ran through the middle of both words. Attempt 4
(`baselines/scripts/schemdraw/validation/case07/attempt-4.py`) uses free text above SDA and below SCL
instead. Check PASS. Attempt 4 is the new final.

### 4. All 24 finals re-reviewed

I re-opened every `final.png` at full size and zoomed the places where text sits near a wire or a part. The
review corrected several earlier "clean" verdicts in `baselines/LOG.md` and added the defects it found:

- schemdraw case 6 (R1 lead, before the fix above) and case 7 (SDA/SCL labels, fixed above).
- SKiDL case 1: the PWR net label sits on the top frame line.
- SKiDL case 2: C1's "100n" value runs into the top-left corner of R2's body.
- SKiDL case 3: V1's "1V" overlaps V2's "V2" and the vertical GND label.
- SKiDL case 4: J1's five series resistors and their pin labels overlap at the top right; R5's "10k" sits on
  its own wire; two "12V" texts collide near B1.
- SKiDL case 5: U2's box touches the left frame; U1 is squeezed between the two sensors and its value crosses
  a wire; R1's "4.7k" sits on its body.
- SKiDL case 6: U1's "ESP32-DevKitC V4" value is crossed by a vertical wire.
- SKiDL case 8: Q3's "2N3906" value is crossed by its emitter wire.
- netlistsvg case 3: R1's text crosses the feedback wire; two long source wires cross the middle.
- netlistsvg case 4: the M1 title is crossed by two vertical wires.
- netlistsvg case 6 and case 7: the shortened titles named above.

The SKiDL finals were not revised again, because the review asked for corrected verdicts, not new SKiDL
attempts. Every one of the 24 final checks still reports `RESULT PASS`.

### 5. SKiDL case 7 marked as a tool failure

SKiDL case 7 is now marked in `baselines/LOG.md` and `baselines/CONNECTIONS.md` as: "tool failure: passives
stacked behind U1, only the two ICs visible". The attempt is kept as the tool's honest final and its check
still PASS, but the drawing is not presented as a fair comparison.

### Files changed in the rework

- `baselines/scripts/schemdraw/validation/case06/attempt-4.py` (new).
- `baselines/scripts/schemdraw/validation/case07/attempt-4.py` (new).
- `baselines/LOG.md`: attempt counts, status table, new attempt entries, corrected verdicts, known defects.
- `baselines/CONNECTIONS.md`: final attempt numbers (schemdraw 6 and 7 attempt 4, netlistsvg 1 attempt 2,
  6 attempt 4, 7 attempt 2) and the SKiDL case 7 tool-failure note.
- `docs/agent-reports/deepseek-step2-showcase.md`: this section.

As before, every image, SVG, check file, `final.png` and netlistsvg config under `baselines/out/` stays out
of the commit, because the repo ignores `out/` directories. They are on disk and rebuildable with the
commands in `baselines/README.md`.

### Commands run in the rework

- `baselines/scripts/run_schemdraw.sh validation 06 4`: check PASS.
- `baselines/scripts/run_schemdraw.sh validation 07 4`: check PASS.
- `baselines/scripts/run_netlistsvg.sh validation 01 2`: check PASS.
- `baselines/scripts/run_netlistsvg.sh validation 03 {2,3,4}`: check PASS for each.
- `baselines/scripts/run_netlistsvg.sh validation 04 {3,4}`: check PASS for each.
- `baselines/scripts/run_netlistsvg.sh validation 06 {2,3,4}`: check PASS for each.
- `baselines/scripts/run_netlistsvg.sh validation 07 2`: check PASS.
- `npm run typecheck`: passed, no output from `tsc`.
- `npm test`: 16 test files, 449 tests, all passed.
- `npm run phase0`: all eight validation cases `valid`; the run reports gates 1 to 6 as incomplete because
  the owner ratings and the test subset are not part of this runner.

Each copied `final.png` was hash-checked against its attempt PNG and matched.

### Skipped

Nothing from the lead's review was skipped. The SKiDL finals were not redrawn, as explained in item 4.
