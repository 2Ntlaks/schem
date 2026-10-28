# Brief: comparison showcase (step 2 of the open-source plan)

For: DeepSeek V4.1 Flash in opencode. Read `AGENTS.md` first; its rules apply throughout.
Branch: `deepseek/step2-showcase` (create it from `main`).

## Goal

A picture that shows, at a glance, how our engine's drawings compare with three existing open-source tools that also draw schematics from a netlist: **SKiDL** (Python, automatic placement and routing), **netlistsvg** (JavaScript, automatic layout) and **schemdraw** (Python, the drawing is written by hand in code). Same circuits, side by side. It becomes the centrepiece of the README.

The work has two parts. **Do only the part your prompt names, then stop and report.** The lead reviews Part A before Part B starts.

## Fairness rules (these matter more than the picture)

These baseline drawings are also used for the owner's blind comparison (SPEC section 15, gate 5). A rigged comparison is worse than none.

- Each tool gets its **best honest drawing**, made within the budget in `baselines/LOG.md`: 1 first attempt plus at most 3 revisions per tool per case. Every revision must be a real attempt to make that tool's drawing better, using the options listed in `baselines/LOG.md` ("Next steps", item 2). Never make a baseline worse on purpose.
- Keep every attempt (image, input or code, `.check.txt`), and log each revision in `baselines/LOG.md` under "Attempts": what you changed and why.
- A drawing whose connection check fails (`attempt-K.check.txt` says FAIL) cannot be chosen as final.
- Our drawings are used **exactly as `npm run phase0` makes them**. Do not tweak circuits, options or code to make ours look better.
- **Validation cases 1-8 only.** Never touch the test set (see `AGENTS.md`).

## Part A: finish the validation baselines

Tools are installed outside the repo (`baselines/VERSIONS.md`); run the scripts from Git Bash at the repo root.

1. **schemdraw, cases 6, 7, 8, attempt 1.** Write `baselines/scripts/schemdraw/validation/caseNN/attempt-1.py` in the style of the existing case 1-5 files (they use `baselines/scripts/schemdraw_kit.py`, which checks the drawing's connections against the circuit). The circuits are `phase0/cases/validation/caseNN-*.json` (read only). Run `baselines/scripts/run_schemdraw.sh validation NN 1`.
2. **schemdraw case 5, attempt 2:** attempt 1 failed its check (SDA and SCL merged). Fix it as `attempt-2.py`.
3. **Review every attempt-1 image** of all three tools for cases 1-8 (`baselines/out/<tool>/validation/caseNN/attempt-1.png`). Look for drawing-level errors the netlist check cannot see: parts overlapping, labels on top of wires or parts, wires running through parts, text cut off, connections that are ambiguous to a reader. Write what you see per image in `baselines/LOG.md`.
4. **Revise where an image has real defects**, within the budget, using the tool's options (SKiDL: `attempt-K.config.json`; netlistsvg: its config keys; schemdraw: a copied and edited `attempt-K.py`). Run with `run_skidl.sh` / `run_netlistsvg.sh` / `run_schemdraw.sh <set> <NN> <K>`. Stop revising when the image is clean or the budget is used.
5. **Choose `final.png`** per tool and case: the attempt with the fewest drawing errors among those whose check passes. Copy it to `baselines/out/<tool>/validation/caseNN/final.png` and record the choice and the reason in `baselines/LOG.md`.
6. Write `baselines/CONNECTIONS.md` (validation only) from the final attempts' `.check.txt` files, and `baselines/README.md` (what the baselines are, how to rerun them; run `npx tsx baselines/scripts/normalize.ts` first).
7. Update the status table in `baselines/LOG.md` (validation rows only).
8. Run the checks in `AGENTS.md`, commit, write the report, **stop**.

## Part B: build the showcase (only after the lead approves Part A)

1. Run `npm run phase0`; our drawings are `out/phase0/validation/caseNN-*.png`.
2. Showcase circuits: cases 1 (LED), 3 (op-amp summing amplifier), 4 (H-bridge motor driver), 5 (I2C sensors), 6 (ESP32 relay), 7 (two chips with decoupling). Case 8 is left out (our drawing of it is weak); say so on the page rather than hiding it.
3. Write `scripts/showcase.ts` (run with `npx tsx scripts/showcase.ts`) that copies the six circuits' images into `docs/showcase/img/` (ours plus each tool's `final.png`, named `caseNN-<tool>.png`) and builds:
   - `docs/showcase/comparison.png`: one grid, a row per circuit, columns **schem (ours) | SKiDL | netlistsvg | schemdraw**, each cell scaled to fit the same box on a white background, circuit name at the left, tool name on top. Build it as an SVG that embeds the PNGs and rasterise it with `@resvg/resvg-js`, which is already a dependency (see `src/render/png.ts`). Keep the file under 3 MB.
   - `docs/showcase/index.html`: one self-contained page (inline CSS, no external scripts) with the same comparison at full size, a short intro (what each tool is, that schemdraw drawings are written by hand while the other three are automatic, that the baselines were made with a fixed attempt budget recorded in `baselines/LOG.md`), and the note about case 8. Light theme; a distinctive but readable font pair from Google Fonts (not Inter, Roboto or Arial); works at phone width.
4. Add `"showcase": "tsx scripts/showcase.ts"` to the `scripts` in `package.json` (no new dependencies).
5. Open `comparison.png` and the page, check every cell shows the right image for the right tool and circuit.
6. Run the checks in `AGENTS.md`, commit, write the report, **stop**.

## Done means

Part A: every validation case has a `final.png` for SKiDL, netlistsvg and schemdraw with a passing check, every attempt is logged, and the report lists each final choice with its reason. Part B: `npm run showcase` rebuilds `docs/showcase/` from scratch, and the image and page are correct.
