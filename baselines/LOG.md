# Baselines log (validation cases 1-8)

Test-case entries (cases 9-12) are in `LOG-test.md`, which the layout builder must not open before the end gate.

Budget (SPEC 15): 1 initial attempt + at most 3 revisions per tool per case. Every attempt keeps its image
(`out/<tool>/validation/caseNN/attempt-K.png`), its input or code, and its connection check (`attempt-K.check.txt`).

## Harness decisions made before any counted attempt

These are tool-wide settings, chosen on neutral circuits that are not cases (a common-emitter amplifier and an
ATtiny85 board) or forced by bugs in the harness, and they apply to every case equally:

- **Rasteriser** (`scripts/rasterize.mjs`): view box set to the drawn content (text included) plus 4 % padding,
  longer side 1600 px, white background, DejaVu fonts only. Earlier runs used a fixed 1600 px width and clipped
  netlistsvg's outer labels; all images were re-rendered with the final settings.
- **SKiDL**: `generate_svg(flatness=1.0, seed=1, auto_stub=False)`; when the wired router raises
  `RoutingFailure`, the same attempt falls back to `auto_stub=True` (generate_svg's own default). On the neutral
  circuits the wired mode was clearly better; label mode overlaps parts. Title block text is "Case N", because the
  default text names SKiDL and would unblind the judges. Generated box symbols put their outline in unit 1
  (in unit 0 SKiDL drew the outline twice, the second copy hiding the pin names). Probe parts are templates (a probe
  had stolen reference Q1, renaming the real part Q1_1).
- **netlistsvg**: analog skin unmodified; conversion rules in `scripts/netlistsvg_draw.mjs` header.
- **schemdraw**: hand-written per case; `scripts/schemdraw_kit.py` checks connections from the drawing geometry.

## Status (STOPPED on the lead's instruction, 2026-10-26; nothing committed)

Attempts used so far: every cell below has used **1** attempt (the initial one) unless it says todo. No revisions yet.

| Case | SKiDL | netlistsvg | schemdraw |
|---|---|---|---|
| 1 | 1 used; check PASS (wired) | 1 used; PASS | 1 used; PASS (defect to fix: battery "+" text drawn at the wrong end) |
| 2 | 1 used; PASS (wired) | 1 used; PASS | 1 used; PASS (VOUT label overlaps wire; "+" text far from plate) |
| 3 | 1 used; PASS (wired) | 1 used; PASS | 1 used; PASS (good) |
| 4 | 1 used; PASS (fell back to labels; parts overlap) | 1 used; PASS | 1 used; PASS (Q2/Q4 labels collide with R6/R8; 12V/OUTB text on wires) |
| 5 | 1 used; PASS (wired) | 1 used; PASS | 1 used; **check FAIL**: SDA and SCL merged; the sensor drops end on the wrong bus lines (fix in attempt 2) |
| 6 | 1 used; PASS (wired) | 1 used; PASS | todo |
| 7 | 1 used; PASS (fell back to labels) | 1 used; PASS | todo |
| 8 | 1 used; PASS (wired) | 1 used; PASS | todo |

"check PASS" for SKiDL and netlistsvg = the tool's input netlist matches the case (`attempt-1.check.txt`); for
schemdraw = connectivity rebuilt from the drawing geometry matches the case. Nobody has yet reviewed the SKiDL or
netlistsvg images for drawing-level errors (overlaps can hide connections); do that before final.png.

### Next steps for whoever continues
1. schemdraw attempt 1 for cases 6, 7, 8 (code in `scripts/schemdraw/validation/caseNN/attempt-1.py`, run
   `baselines/scripts/run_schemdraw.sh validation NN 1`) and test cases 9-12 (code goes in
   `out/schemdraw/test/caseNN/attempt-1.py`).
2. Review all attempt-1 images; spend up to 3 revisions per tool per case (SKiDL: `attempt-K.config.json` keys
   `options` (seed, auto_stub, auto_stub_fanout, auto_stub_max_wire_pins, auto_stub_max_wire_dist,
   label_clearance, expansion_factor), `parts.<ref>.sides|lib|name|pinmap|box`, `power_nets`; netlistsvg:
   `noSplitNets`, `splitKinds`, `parts.<ref>.dirs|generic|type|attributes` (ELK attributes); schemdraw: edit a copy
   of the code as attempt-K.py). Run with `run_skidl.sh` / `run_netlistsvg.sh` / `run_schemdraw.sh <set> <NN> <K>`.
3. Copy the chosen attempt to `final.png` per tool and case; write CONNECTIONS.md / CONNECTIONS-test.md from the
   final attempts' `.check.txt`; write README.md (rerun steps, `npx tsx baselines/scripts/normalize.ts` first).
4. Note for the judge kit: it wants `<tool>__caseNN.png` in one folder; copy the final.png files that way.

## Attempts

(per case and tool: what changed and why; filled in as revisions are made)
