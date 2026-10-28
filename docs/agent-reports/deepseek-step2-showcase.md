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
