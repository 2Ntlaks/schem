// SVG -> PNG with resvg, pinned font, no system fonts (SPEC 9.6). Text is already outlined.

import { Resvg } from "@resvg/resvg-js";

export function toPng(svg: string, pxPerGrid = 10): Buffer {
  if (!Number.isFinite(pxPerGrid) || pxPerGrid <= 0) throw new RangeError("pixels per grid unit must be a positive finite number");
  // toSvg exports 1 G as 2.54 mm. At SVG's 96 CSS px/in that is 9.6 px,
  // so scale from physical units rather than from the viewBox's 10 drawing units/G.
  const cssPixelsPerGrid = 96 * 2.54 / 25.4;
  const r = new Resvg(svg, { fitTo: { mode: "zoom", value: pxPerGrid / cssPixelsPerGrid }, font: { loadSystemFonts: false }, background: "#ffffff" });
  return r.render().asPng();
}
