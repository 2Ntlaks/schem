# Rendering themes

A rendering theme sets the colour palette used when `schem` turns a verified drawing into SVG (Scalable Vector Graphics) or PNG (Portable Network Graphics) output. All five themes from SPEC 12.1 are built in.

## Available themes

| Theme | Background | Stroke | Fill | Text | Use |
| --- | --- | --- | --- | --- | --- |
| `clean` | `#ffffff` | `#000000` | `#000000` | `#000000` | Default black ink on white paper. |
| `dark` | `#0f172a` | `#e2e8f0` | `#e2e8f0` | `#f8fafc` | High-contrast light ink on deep slate for dark pages and slides. |
| `blueprint` | `#0b2545` | `#eef6ff` | `#eef6ff` | `#ffffff` | Pale blue-white ink on navy blueprint paper. |
| `textbook` | `#faf7f0` | `#1c1917` | `#1c1917` | `#1c1917` | Deep charcoal ink on warm off-white paper. |
| `mono-print` | `#ffffff` | `#000000` | `#000000` | `#000000` | Pure monochrome black on white for laser and offset printing. |

Passing an unknown theme name fails with an error that lists the five valid names.

## CLI and MCP usage

Pass `--theme <name>` and optionally `--transparent` to `schem render`, `schem draw` or `schem watch` (see [Installation and MCP setup](install.md) for running from a repo clone with `npm run schem --`):

```sh
# Render a dark-mode SVG and a transparent 300 DPI PNG
schem render examples/led.schem -o led-dark.svg --theme dark
schem render examples/led.schem -o led-dark.png --dpi 300 --theme dark --transparent --overwrite

# Draw both SVG and PNG with a theme
schem draw examples/led.schem -o out --theme blueprint --transparent

# Watch a schematic and redraw on every save with a theme
schem watch examples/led.schem -o out --theme dark
```

In MCP (Model Context Protocol), pass `theme` and `transparent` to `schem_render`:

```json
{
  "path": "/path/to/your/circuits/led.schem",
  "format": "png",
  "out": "/path/to/your/circuits/led-dark.png",
  "dpi": 300,
  "theme": "dark",
  "transparent": true,
  "overwrite": true
}
```

Setting `--transparent` (or `transparent: true`) omits the background rectangle from SVG output and preserves an RGBA alpha channel in PNG output. Use `clean` with transparency for dark ink on light surfaces, or `dark` with transparency for light ink on dark surfaces.

## Selecting a theme in a schematic file

You can also store a default theme inside the circuit file so every render picks it up automatically.

In a text schematic (`.schem` file; see [Text schematics](dsl.md)), set the theme with a `style` statement near the top of the file:

```text
circuit "Inverting summing amplifier"
style theme=blueprint

part R1 resistor 10k
```

You can combine `theme` with other style options on the same line, such as `style theme=dark symbols=ieee`.

In a JSON circuit file (`.schem.json`; see [Circuit file format](netlist-format.md)), store the same setting under `intent.style.theme`:

```json
{
  "intent": {
    "style": {
      "theme": "textbook"
    }
  }
}
```

Theme priority order:

1. An explicit `--theme` flag on the CLI, `theme` argument on `schem_render`, or `options.theme` passed to `toSvg()`.
2. The theme stored in the schematic file (`style theme=...` or `intent.style.theme`, copied onto `model.meta.theme`).
3. `"clean"` when neither is set.

## Programmatic TypeScript API (advanced)

When calling the renderer directly in TypeScript:

```ts
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";

// Solid themed SVG and PNG
const svg = toSvg(model, { theme: "dark" });
const png = toPng(svg, 20);

// Transparent background (no background <rect>, RGBA PNG with alpha = 0)
const transparentSvg = toSvg(model, { theme: "dark", transparent: true });
const transparentPng = toPng(transparentSvg, 20, { transparent: true });
```

Setting `transparent: true` on `toSvg` omits the background `<rect>` element so only wires, filled shapes and outlined text are drawn. Setting `transparent: true` or `background: null` on `toPng` omits the solid canvas fill in `resvg` so the output PNG keeps a true alpha channel.

When `toSvg(model)` and `toPng(svg)` are called without theme or transparency options, they select `"clean"` with a solid `#ffffff` canvas. Their output is byte-for-byte identical to the original renderer, and every theme produces deterministic SVG and PNG bytes across runs.
