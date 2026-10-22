// SVG -> PNG with resvg, pinned font, no system fonts (SPEC 9.6). Text is already outlined.

import { Resvg } from "@resvg/resvg-js";

export function toPng(svg: string, pxPerGrid = 10): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "zoom", value: pxPerGrid / 10 * 2 }, font: { loadSystemFonts: false }, background: "#ffffff" });
  return r.render().asPng();
}
