# Brief: tscircuit as a fourth baseline

For: DeepSeek V4.1 Flash in opencode. Read `AGENTS.md` first; its rules apply throughout.
Branch: `deepseek/tscircuit-baseline` (create it from `main`).

## Goal

[tscircuit](https://tscircuit.com) is an open-source TypeScript tool that describes circuits in code and lays out schematics automatically. It is the closest existing project to ours, so the comparison is not credible without it. Add it to the baselines the same way SKiDL and netlistsvg were added (same netlists, same attempt budget, same rasteriser, a connection check), then add it to the showcase.

This is harder than the earlier briefs: tscircuit changes quickly and what you remember about its API is probably out of date. **Read the current documentation and the installed packages' own type definitions before writing code, and trust them over memory.**

The work has three parts. **Do only the part your prompt names, then stop and report.** The lead reviews each part before the next starts.

## Fairness rules (same as for the other tools, plus one)

- Each drawing must be tscircuit's **best honest automatic drawing** within the budget in `baselines/LOG.md`: 1 first attempt plus at most 3 revisions per case. Never make it worse on purpose.
- **No hand placement.** tscircuit lets you give parts absolute schematic positions (`schX`, `schY` and similar) and draw traces by hand. Using those turns it into a hand-drawn tool, which is what schemdraw is for. Allowed per-part settings are the kind the other automatic tools got: a part's rotation or orientation, which side its pins sit on or their order, a chip box's size, and how power and ground are shown. Anything that sets a coordinate or a trace path is not allowed. If you are unsure whether a setting counts as placement, do not use it and list it under open questions.
- **Tool-wide settings** (the converter's defaults, layout options for the whole board) are chosen on two **neutral circuits that are not cases**, before any counted attempt, and then apply to every case unchanged. Make the neutral circuits yourself in the neutral netlist format: a common-emitter amplifier and an ATtiny85 board with a crystal, decoupling and an LED. Keep them in `baselines/scripts/tscircuit/neutral/`. Record the settings and why under "Harness decisions" in `baselines/LOG.md`.
- Keep every attempt (input, SVG, PNG, `.check.txt`), and log each one in `baselines/LOG.md`. A drawing whose check fails cannot be chosen as final.
- **Validation cases 1-8 only.** Never open, list or run anything in the test set paths in `AGENTS.md`. Do not run `baselines/scripts/normalize.ts` (it also writes test-set files); the neutral netlists you need are already in `baselines/out/_netlist/validation/`.

## Where things go

- **Install tscircuit outside the repo**, in `%USERPROFILE%\schem-baselines\tscircuit` (Git Bash: `$HOME/schem-baselines/tscircuit`), with its own `package.json` and exact versions (`npm install --save-exact ...`). Nothing goes into the repo's `package.json`. If installing needs anything beyond npm packages (a browser, a native build, an account or an API key), stop and ask in your report.
- New tracked files: `baselines/scripts/run_tscircuit.sh`, `baselines/scripts/tscircuit_draw.mjs` (or `.ts` if you run it with the repo's `tsx`), and `baselines/scripts/tscircuit/neutral/*.json`. Follow `run_netlistsvg.sh` and `netlistsvg_draw.mjs` as the model, including the `SCHEM_BASELINES` variable and the home-folder default.
- Outputs: `baselines/out/tscircuit/validation/caseNN/attempt-K.{config.json,input.*,svg,png,check.txt}` and `final.png` (all gitignored, like the other tools).
- Rasterise with `baselines/scripts/rasterize.mjs`, unchanged, so the PNGs match the other tools'.
- You may edit `baselines/LOG.md`, `baselines/CONNECTIONS.md`, `baselines/README.md`, `baselines/VERSIONS.md`, and in Part C `scripts/showcase.ts`. Nothing else outside the new files. Do not edit `README.md`; in Part C, put the sentences that should change in your report.

## Part A: setup and the first two drawings

1. Read the current tscircuit docs and find a way to go from a circuit described in code to a **schematic SVG, headless, from the command line**. Expect something like `@tscircuit/core` (build the circuit and get its "circuit JSON") plus `circuit-to-svg` (schematic SVG from circuit JSON), but confirm against the docs and the installed type definitions. Record the packages, versions and the exact API calls in `baselines/VERSIONS.md`.
2. Write the converter (`tscircuit_draw`): neutral netlist plus optional `attempt-K.config.json` in, tscircuit circuit out. Put the conversion rules in the file's header comment, like `netlistsvg_draw.mjs`:
   - which of our part types map to which tscircuit component (resistor, capacitor, diode, LED, transistors, MOSFETs, sources and so on);
   - what happens to a part type tscircuit has no component for: it becomes a chip box labelled with its reference and value, with its real pin names, as the other tools do;
   - how named nets, power and ground are expressed.
3. Write the **connection check**. Rebuild connectivity from the **schematic** part of the circuit JSON (schematic ports, schematic traces, and net labels or power symbols joined by name), not from the input, and compare the groups of case pins with the case nets. tscircuit may leave a connection unrouted in the schematic; a connection that is not drawn counts as missing. Write `attempt-K.check.txt` in the same shape as the other tools' (one line per net, `OK`/`MISSING`/`EXTRA`, then `RESULT PASS` or `RESULT FAIL`). If the schematic layer cannot support this, stop and explain why in the report; do not fall back silently to checking the input.
4. Choose the tool-wide settings on the two neutral circuits (fairness rules above). Open their PNGs.
5. Run attempt 1 on **cases 1 and 3** only. Open both PNGs.
6. Run the checks in `AGENTS.md`, commit, write the report (versions, API calls, conversion rules, the check's method, the neutral-circuit decisions, both case results with their check output), and **stop**.

## Part B: all eight cases (only after the lead approves Part A)

1. Attempt 1 on cases 2 and 4-8.
2. Review every attempt-1 image **at full size**, zooming wherever text is near a wire or a part: overlapping parts, labels on wires or parts, wires through parts, clipped text, unrouted connections, ambiguous junctions. Write what you see per image in `baselines/LOG.md`. Do not call an image clean from a thumbnail.
3. Revise where an image has real defects, within the budget, using only the allowed per-part settings.
4. Choose `final.png` per case (fewest drawing errors among attempts whose check passes) and record the choice and the reason.
5. Add tscircuit to `baselines/LOG.md` (status table, attempts, known defects), `baselines/CONNECTIONS.md`, `baselines/README.md` and `baselines/VERSIONS.md`.
6. Run the checks, commit, report, **stop**.

## Part C: the showcase (only after the lead approves Part B)

1. Add tscircuit to `TOOLS` in `scripts/showcase.ts`, as the second column after ours: **schem (ours) | tscircuit | SKiDL | netlistsvg | schemdraw**.
2. Update the page text: four other tools, what tscircuit is (automatic, like SKiDL and netlistsvg), and any tscircuit case that is a tool failure, said plainly as SKiDL case 7 is.
3. `npm run showcase` from a deleted `docs/showcase/`. `comparison.png` must stay under 3 MB and readable. If five columns make the cells too small to read, say so in the report with the cell size, and do not change the layout yourself.
4. Open `comparison.png` and the page (wide and at 390 px); check every cell is the right tool and circuit.
5. Run the checks, commit, report (including the README sentences that should change), **stop**.

## Done means

Every validation case has a tscircuit `final.png` with a passing schematic-level check, made without hand placement and within the budget. Every attempt is logged. The showcase has five columns and rebuilds from scratch. Reports for each part are in `docs/agent-reports/deepseek-tscircuit-baseline.md`.
