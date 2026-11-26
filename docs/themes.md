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

Passing an unknown theme name throws an error that lists the five valid names.

## Selecting a theme in a schematic file

In a text schematic (`.schem` file), set the theme with a `style` statement near the top of the file:

```text
circuit "Inverting summing amplifier"
style theme=blueprint

part R1 resistor 10k
```

You can combine `theme` with other style options on the same line, such as `style theme=dark symbols=ieee`.

In a JSON circuit file (`.schem.json`), store the same setting under `intent.style.theme`:

```json
{
  "intent": {
    "style": {
      "theme": "textbook"
    }
  }
}
```

## Programmatic rendering and transparency

The renderer reads the theme in this priority order:

1. `options.theme` passed to `toSvg(model, options)`.
2. `model.meta.theme` on the `RenderModel`.
3. `"clean"` when neither is set.

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

Setting `transparent: true` on `toSvg` omits the background `<rect>` element so only wires, filled shapes, and outlined text are drawn. Setting `transparent: true` or `background: null` on `toPng` omits the solid canvas fill in `resvg` so the output PNG keeps a true alpha channel. Use `theme: "clean"` with `transparent: true` for dark ink on light surfaces, or `theme: "dark"` with `transparent: true` for light ink on dark surfaces.

## Determinism and compatibility

When `toSvg(model)` and `toPng(svg)` are called without theme or transparency options, they select `"clean"` with a solid `#ffffff` canvas. Their output is byte-for-byte identical to the original renderer, and every theme produces deterministic SVG and PNG bytes across runs.
