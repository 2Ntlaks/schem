// SVG -> PNG with resvg, pinned font, no system fonts (SPEC 9.6). Text is already outlined.

import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

export interface PngOptions {
  transparent?: boolean;
  background?: string | null;
}

export function toPng(svg: string, pxPerGrid = 10, options?: PngOptions): Buffer {
  if (!Number.isFinite(pxPerGrid) || pxPerGrid <= 0) throw new RangeError("pixels per grid unit must be a positive finite number");
  // toSvg exports 1 G as 2.54 mm. At SVG's 96 CSS px/in that is 9.6 px,
  // so scale from physical units rather than from the viewBox's 10 drawing units/G.
  const cssPixelsPerGrid = 96 * 2.54 / 25.4;
  const background = options?.transparent || options?.background === null
    ? undefined
    : (options?.background ?? "#ffffff");
  const resvgOptions: ResvgRenderOptions = {
    fitTo: { mode: "zoom", value: pxPerGrid / cssPixelsPerGrid },
    font: { loadSystemFonts: false },
    ...(background !== undefined ? { background } : {}),
  };
  const r = new Resvg(svg, resvgOptions);
  return r.render().asPng();
}
