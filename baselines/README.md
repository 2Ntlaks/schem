# Baselines: SKiDL, netlistsvg, schemdraw and tscircuit

These are independent drawings of the eight Phase 0 validation circuits, made with four open-source tools
that also turn a netlist into a schematic. They are the comparison side of the showcase; our engine's own
drawings are made by `npm run phase0`. tscircuit is being added in three parts; Parts A and B are done, so this
file and the rest of the folder describe the full tscircuit baseline. Six cases have a passing final; cases 5
and 8 are tool failures and have no final.

- `LOG.md`: the attempt budget, the tool-wide settings, every attempt and the final choice per case.
- `CONNECTIONS.md`: the nets each final drawing shows, taken from the final `.check.txt` files.
- `VERSIONS.md`: pinned tool versions and where the tools are installed.

The tools are installed outside the repo (see `VERSIONS.md`); nothing was added to the repo's dependencies.

## What is here

```
baselines/
  scripts/
    normalize.ts              frozen case -> flat netlist (the only input every tool gets)
    run_schemdraw.sh          run one schemdraw attempt
    run_skidl.sh              run one SKiDL attempt
    run_netlistsvg.sh         run one netlistsvg attempt
    run_tscircuit.sh          run one tscircuit attempt
    rasterize.mjs             SVG -> PNG with the repo's resvg and DejaVu fonts
    skidl_draw.py             netlist -> SKiDL circuit -> generate_svg
    netlistsvg_draw.mjs       netlist -> Yosys JSON -> netlistsvg with the analog skin
    tscircuit_draw.mjs        netlist -> tscircuit circuit JSON -> circuit-to-svg
    tscircuit/neutral/*.json  the two neutral circuits that chose the tscircuit settings
    schemdraw_kit.py          drawing helpers plus the geometry-based connection check
    schemdraw/validation/caseNN/attempt-K.py   hand-written schemdraw code
  out/
    _netlist/validation/caseNN.json            neutral netlist used by every tool
    <tool>/validation/caseNN/attempt-K.png     every attempt
    <tool>/validation/caseNN/attempt-K.svg     every attempt
    <tool>/validation/caseNN/attempt-K.check.txt
    <tool>/validation/caseNN/final.png         the chosen attempt
    <tool>/validation/caseNN/attempt-K.config.json   SKiDL, netlistsvg and tscircuit inputs
```

`baselines/out/` is generated and is gitignored (the repo ignores every `out/` directory). The scripts and
logs are tracked; rerun the steps below to rebuild the images.

## Rerun

Run from the repo root in Git Bash. Install the tools as `VERSIONS.md` describes, or set `SCHEM_BASELINES`
to the folder that holds `venv`, `netlistsvg` and `tscircuit` (default `%USERPROFILE%\schem-baselines`).

1. Rebuild the neutral netlists. They are already on disk; this step is needed only when a case or its
   loader changes.

   ```
   npx tsx baselines/scripts/normalize.ts
   ```

   This reads `phase0/cases/` and writes `baselines/out/_netlist/validation` and
   `baselines/out/_netlist/test`. The test-set outputs are for the end gate only; do not open them early
   (see `AGENTS.md`).

2. Run one attempt, for example:

   ```
   baselines/scripts/run_skidl.sh validation 04 2
   baselines/scripts/run_netlistsvg.sh validation 04 2
   baselines/scripts/run_schemdraw.sh validation 04 2
   baselines/scripts/run_tscircuit.sh validation 04 2
   ```

   Each runner writes `attempt-K.svg`, `attempt-K.png` and `attempt-K.check.txt` under
   `baselines/out/<tool>/validation/caseNN/`, then prints `check: PASS` or `check: FAIL`. The schemdraw
   runner takes its code from `baselines/scripts/schemdraw/validation/caseNN/attempt-K.py`; the others
   take an optional config file from the output folder and create an empty one if it is missing.

   To run a tscircuit neutral circuit, pass `neutral` and the file name instead of a set and case number:

   ```
   baselines/scripts/run_tscircuit.sh neutral common-emitter 1
   baselines/scripts/run_tscircuit.sh neutral attiny85 1
   ```

3. To make a chosen attempt final, copy it to `final.png` in the same folder:

   ```
   cp baselines/out/skidl/validation/case04/attempt-4.png baselines/out/skidl/validation/case04/final.png
   ```

## The checks

The check answers one question: does the drawing show exactly the case's nets? It is not a picture test.

- **schemdraw** (`schemdraw_kit.py`): rebuilds connectivity from the drawing as a reader would. A pin joins
  a wire that touches it, wire ends join wires they touch, crossing wires do not join, and supply symbols or
  labels with the same text join. The groups of case pins are compared with the case nets.
- **SKiDL** (`skidl_draw.py`): builds the circuit, draws it, then takes the netlist SKiDL used, maps its pins
  back to the case pin numbers and compares.
- **netlistsvg** (`netlistsvg_draw.mjs`): builds the Yosys JSON input, joins bits through same-named supply
  symbols, maps the ports back to case pins and compares. It also checks that every cell appears in the SVG.
- **tscircuit** (`tscircuit_draw.mjs`): reads only the schematic layer of the circuit JSON (schematic ports,
  schematic traces, schematic net labels), joins same-named net labels, maps schematic ports back to case pins
  through the source ports and compares. A pin with neither a wire nor a label stays alone and counts as
  missing. The source netlist is used only for the expected groups and the pin names.

A FAIL cannot be chosen as final. All 24 finals of the first three tools PASS. tscircuit's finals PASS in cases
1, 2, 3, 4, 6 and 7; cases 5 and 8 have no final because every attempt's check fails. See `CONNECTIONS.md`.

## Config levers used in the revisions

- **schemdraw**: copy `attempt-K.py` to the next number and edit it. Positions are in drawing units.
  `S.text` adds free text that is not a net label; `S.label` adds a net label that joins nets of the same
  name.
- **SKiDL** (`attempt-K.config.json`): `options` is passed to `generate_svg`. The schematizer accepts
  `retries`, `auto_stub`, `auto_stub_fanout`, `auto_stub_max_wire_pins`, `auto_stub_max_wire_dist`,
  `auto_stub_fallback` and `label_clearance`. `parts.<ref>` can override `sides`, `lib`, `name`, `pinmap`,
  `box` and `generic`. `expansion_factor` is internal and must not be passed; it raises `TypeError`.
- **netlistsvg** (`attempt-K.config.json`): `splitKinds`, `noSplitNets`, `symbolOf`, and
  `parts.<ref>.dirs`, `generic`, `type`, `title`, `attributes`, `pins`, `value`. `dirs` is keyed by case pin
  number for generic boxes and by skin port for mapped parts.
- **tscircuit** (`attempt-K.config.json`): `signalTopology` (`star` default or `chain`), `signalNetLabels`
  (default true), `signalElements` (`trace` default or `net`), `orientations.<part type>` (default
  `horizontal` for resistors, capacitors, polarised capacitors and inductors), `chip.width`/`chip.height`,
  and `parts.<ref>.orientation`, `rotation`, `generic`, `schWidth`, `schHeight`, `pinSides`
  (`{ left: [case pins], right: [case pins], leftDirection, rightDirection }`). A per-part `rotation` wins
  over the tool-wide orientation. None of these sets a coordinate or a trace path.

The final drawings keep the tool's own layout. Where a tool's placer or router produced a bad result, the
defect is recorded in `LOG.md` rather than patched by hand.
