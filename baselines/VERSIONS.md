# Baseline tool versions (pinned, installed outside the repo)

Installed 2026-10-25 under `%USERPROFILE%\schem-baselines`. Nothing is installed in the repo.

| Tool | Version | Where |
|---|---|---|
| Python | 3.12.10 | `%LOCALAPPDATA%\Programs\Python\Python312\python.exe` (venv base) |
| skidl | 3.0.0 | venv `%USERPROFILE%\schem-baselines\venv` |
| schematizer (SKiDL's placer/router/SVG writer, pulled in by skidl) | 0.2.0 | venv |
| hierplace (skidl dependency) | 1.1.0 | venv |
| schemdraw | 0.23 | venv |
| matplotlib | 3.11.2 | venv |
| KiCad symbol library | tag 10.0.7, commit e1bb0a65cb243525367c5dc7294665b9fd57fc4d | `%USERPROFILE%\schem-baselines\kicad-symbols` (SKiDL reads it through `KICAD10_SYMBOL_DIR`; SKiDL 3.0.0's default tool is kicad10) |
| netlistsvg (analog skin `lib/analog.svg`, unmodified) | 1.0.2 | `%USERPROFILE%\schem-baselines\netlistsvg` (own `package.json`, `--save-exact`) |
| @tscircuit/core (tscircuit's circuit builder and schematic layout) | 0.0.2229 | `%USERPROFILE%\schem-baselines\tscircuit` (own `package.json`, `--save-exact`) |
| circuit-to-svg (circuit JSON to schematic SVG) | 0.0.454 | same folder |
| tscircuit (meta-package, installed to satisfy @tscircuit/core's undeclared transitive imports) | 0.0.3035 | same folder |
| circuit-json (types and error shapes both packages import) | 0.0.537 | same folder |
| @tscircuit/soup-util, @tscircuit/infer-cable-insertion-point, format-si-unit (undeclared transitive imports) | 0.0.41, 0.0.5, 0.0.14 | same folder |
| Node.js / npm | 24.14.0 / 11.9.0 | system |
| @resvg/resvg-js (rasteriser, from the repo) | 2.6.2 | repo `node_modules` |
| DejaVu fonts (rasteriser fonts, from the repo) | dejavu-fonts-ttf 2.37.3 | repo `node_modules` |

KiCad itself is not installed and not needed: SKiDL 3.0.0's `generate_svg()` renders through schematizer.

## Install commands

```
%LOCALAPPDATA%\Programs\Python\Python312\python.exe -m venv %USERPROFILE%\schem-baselines\venv
%USERPROFILE%\schem-baselines\venv\Scripts\python.exe -m pip install --upgrade pip
%USERPROFILE%\schem-baselines\venv\Scripts\python.exe -m pip install skidl==3.0.0 schemdraw==0.23 matplotlib==3.11.2
git clone --depth 1 --branch 10.0.7 https://gitlab.com/kicad/libraries/kicad-symbols.git %USERPROFILE%\schem-baselines\kicad-symbols
cd %USERPROFILE%\schem-baselines\netlistsvg && npm init -y && npm install --save-exact netlistsvg@1.0.2
cd %USERPROFILE%\schem-baselines\tscircuit && npm init -y && npm install --save-exact @tscircuit/core@0.0.2229 circuit-to-svg@0.0.454 tscircuit@0.0.3035 circuit-json@0.0.537 @tscircuit/soup-util@0.0.41 @tscircuit/infer-cable-insertion-point@0.0.5 format-si-unit@0.0.14
```

## tscircuit API calls used

No browser, account or API key is needed: everything runs in Node.

```js
const { Circuit, Board, Resistor, Capacitor, Inductor, Diode, Led, Battery, VoltageSource,
        Transistor, Mosfet, OpAmp, Crystal, Chip, Trace, Net } = await import(coreIndexJs);
const { convertCircuitJsonToSchematicSvg } = await import(circuitToSvgIndexJs);

const circuit = new Circuit();
circuit.add(new Board({ width: "200mm", height: "150mm" }));
board.add(new Resistor({ name: "R1", resistance: "470" }));
board.add(new Trace({ name: "SUM", from: "R1.pin2", to: "U1.pin2" })); // Current Trace API: from/to, not connect()
board.add(new Net({ name: "GND", connectsTo: ["B1.pin2"], isGroundNet: true }));
board.add(new Chip({ name: "U1", manufacturerPartNumber: "ATtiny85",
  pinLabels: { pin8: "VCC", pin5: "PB0", pin4: "GND" },
  schPinArrangement: { leftSide: { pins: [8, 5], direction: "top-to-bottom" },
                       rightSide: { pins: [4], direction: "bottom-to-top" } } }));
const circuitJson = circuit.getCircuitJson();
const svg = convertCircuitJsonToSchematicSvg(circuitJson);
```

`circuit.getCircuitJson()` is synchronous. `new Trace(...).connect(...)` from older examples is gone: the
constructor validates `from`/`to` (or `path`, `start`, `end`) immediately. `Chip` pin keys are `pin<number>`;
a key such as `pin8` makes tscircuit report pin number 8, and a sparse set of keys draws only those pins.
`manufacturerPartNumber` is what the box prints as its second text (after the reference); `value` is ignored.
`Net` with `isPowerNet`/`isGroundNet` draws the `rail_up`/`rail_down` symbols. A `Net` without those flags,
or a named `Trace`, is drawn as a short wire ending in a net label whose text is the net name. The schematic
layers used by the check are `schematic_port`, `schematic_trace` (with `edges` and `junctions`) and
`schematic_net_label` (`text`, `anchor_position`, `anchor_side`, `symbol_name`).

tscircuit 0.0.3035's package set has three undeclared imports (`@tscircuit/soup-util`,
`@tscircuit/infer-cable-insertion-point`, `format-si-unit`) and a `circuit-json` version mismatch with
`@tscircuit/checks`; installing the versions above at the top level makes the headless import work.

## Verify

```
%USERPROFILE%\schem-baselines\venv\Scripts\python.exe -m pip freeze | findstr /i "skidl schematizer hierplace schemdraw matplotlib"
cd %USERPROFILE%\schem-baselines\netlistsvg && npm ls --depth=0
git -C %USERPROFILE%\schem-baselines\kicad-symbols describe --tags
```

Checked 2026-10-25: pip freeze shows hierplace==1.1.0, matplotlib==3.11.2, schematizer==0.2.0, schemdraw==0.23,
skidl==3.0.0; `npm ls` shows netlistsvg@1.0.2; kicad-symbols describes as 10.0.7.
