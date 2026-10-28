# Session handoff (agent A, lead session)

For the next Claude Code session (any account) that continues Phase 0b. Read this first, then `SPEC.md` (rev C.3), `docs/PHASE0B-NOTES.md`, `phase0/HANDOFF.md`.

Last updated: 2026-10-28.

## Update 2026-10-28: both branches merged

The templates branch and the gate 6 branch are on `main` (`6fe468c`, `09cffef`). The branch table below is history. Current state: 449 tests pass; validation cases 1-8 all `valid`; 12 of 12 validation edits pass gate 4; gate 6 passes (generated 30-part circuit warm p95 about 1.8 s). Merge fixes and the speed-up are in `docs/PHASE0B-NOTES.md` (last two sections). Next: the steps under "Next steps after the branches land", from step 2.

The owner chose the **MIT licence** and plans to open the repo to contributors once it can be shown off: README with comparison pictures, one-command try-out, LICENSE, CONTRIBUTING, good-first-issue list (symbols, modules, example circuits, templates), docs tidied.

## Standing rules

- **Test-set hygiene:** the layout builder (you) must not open `phase0/cases/test/` or `phase0/cases/edits/case11-*` until the Phase 0b end gate. Never run `npm run gates -- --test` or `npm run phase0 -- --test` before then.
- Never edit `phase0/` (frozen by agent B, SHA-256 manifest) or `tests/fixtures/` (written independently from the spec).
- Self-verify before showing the owner anything: tests, typecheck, `npm run phase0`, look at the PNGs, then blind AI judges.
- No em or en dashes in docs. Commit messages end with the Co-Authored-By line. Do not push without the owner's say-so.
- The owner also commits to `main` directly (for example `522217b`, decoupling child slots). Check `git status` before merging; if the main checkout has someone else's uncommitted changes, ask.

## State of `main`

Merged: spec rev C.3 (owner confirmed all six rulings), 15 Phase 0b symbols, SPEC 6.5 loader + modules + `decouples` hints + edit-script runner (`src/io`, `src/modules`), `npm run phase0`, the owner's decoupling child slots, the gate runner `npm run gates` (`scripts/gates.ts`, `scripts/lib/case-run.ts`, `scripts/lib/gate-math.ts`, owner's `scripts/lib/phase0-gates.ts`).

Validation set on main: all 8 cases pass the verifier; case 4 (H-bridge) is still `valid_low_confidence` (gate 1 fails on it); 12 of 12 validation edit scripts pass gate 4; gate 6 fails (findings fix dry-runs take 3-10 s).

## Work on branches, not yet on `main`

Worktrees live in `.claude/worktrees/<name>`; branches are `worktree-agent-<id>`.

| Branch | What | Status / next step |
|---|---|---|
| `worktree-agent-a64ae799f724ab560` (head `ee3fbe8`, WIP) | Pattern templates (SPEC 9.4): engine in `src/layout/templates/`, op-amp inverting/summing, non-inverting, I2C pull-ups, divider, pull-up/down, LED. Round 2 (WIP): H-bridge, low-side switch, bridge rectifier templates switched on; case 4 now `valid` (legs side by side), one squeezed-run breach left; case 6 relay above Q1 with flyback diode, squeezed runs + 3 crossings left. | Round 2 next: (1) run `npm test` (not rerun since the round-2 templates); (2) fix squeezed runs in cases 4 and 6 (case 6 with J1 on the right needs at least 2 crossings: aim for tight loops); (3) bridge-rectifier test circuit + template tests; (4) module-name label for case 6's U1 from `assets.definitions[type].name`; (5) notes. Then `git merge main`: 8 conflict hunks in `src/layout/layout.ts` against the owner's decoupling child slots (`522217b`). Keep both behaviours, feed the IC cluster envelope (`clusterEnv`) into the template block envelopes, remove the templates' own decoupling stub (and its stub test in `tests/templates.test.ts`); never edit the owner's tests to pass. Case 7 must stay `valid` with caps at the pins. Then merge into main. |
| `worktree-agent-a18f81d0292fbac91` (head `d8c609b`, WIP) | Gate 6 performance. Done: merge of main + gate runner + templates round 1 (`bc56910`); snapshot of `review()` output on cases 1-8 + the generated 30-part circuit, `tests/findings-snapshot.test.ts` (`8c6d6eb`). Profiled, nothing optimised yet: case 4 p95 7.4 s, generated p95 8.7 s; layout alone about 50 ms. About 90% of the time is failed path searches in `src/layout/router.ts` inside fix dry-runs that are rejected anyway (case 4: the "rotate J1 180" candidate, 5.8 s, 40 failed searches expanding 1.1M states; generated: "place C5 left of U1", 6.0 s). | Next (none may change results; the snapshot test proves it): (1) cheap reachability pre-check before each search with the same move rules, skip strict/relaxed search when no terminal is reachable; (2) rasterise obstacles to a grid once per route call; (3) memoise dry-runs with identical ops inside one `review()`; (4) snapshot test, full tests, typecheck, `npm run gates` (gate 6 target warm p95 < 3 s). Merge after the templates branch. |
| (no branch) baselines, committed in `baselines/` | Installed and pinned in `C:\Users\ntlak\schem-baselines\` (skidl 3.0.0 with schematizer 0.2.0, schemdraw 0.23, matplotlib 3.11.2, KiCad symbols 10.0.7, netlistsvg 1.0.2 analog skin); see `baselines/VERSIONS.md`. Attempt 1 done for SKiDL and netlistsvg on all 12 cases (SKiDL's router failed on 4, 7, 9-12 and fell back to its label mode); schemdraw attempt 1 on cases 1-5 (case 5 merges SDA/SCL: attempt 2 must fix). No `final.png` yet; README, CONNECTIONS*.md not written. | Continue from `baselines/LOG.md` (layout builder: never open `LOG-test.md`, `baselines/out/*/test/` or `baselines/out/_netlist/test/`; run the test-set part from a separate agent that reports only case numbers and pass/fail). Owner to accept two settings: SKiDL wired mode first with label fallback; images cropped to the drawing + 4% margin and scaled to 1600 px long side. Review each attempt image for drawing errors before choosing `final.png`; at most 1 + 3 attempts per tool per case. |

If a branch's last commit is marked WIP, its agent was stopped by a usage limit: read its last commit message and `docs/PHASE0B-NOTES.md`, then finish the step.

## Next steps after the branches land

1. `npm run gates` on the validation set: gate 1 8/8, gate 4 12/12, gate 6 < 3 s.
2. Blind AI judge panel on the validation pack (`phase0/judge/README.md`), fix what judges flag, repeat.
3. Owner's blind rating of the validation set (gate 3: 7 of 8 at 4+), with baselines (gate 5).
4. Only then the end gate: run `--test` once, owner rates all 12 (gates 2 and 5).
