import { describe, expect, it } from "vitest";
import { toPng } from "../src/render/png.js";
import { toSvg } from "../src/render/svg.js";
import type { RenderModel } from "../src/render/model.js";

const drawing: RenderModel = {
  bounds: { x: -3, y: -3, w: 48, h: 32 }, meta: { title: "Physical export dimensions" }, art: [],
  electrical: { wires: [], dots: [], pins: [], ports: [], ncMarks: [] },
};
const dimensions = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe("physical drawing exports", () => {
  it("exports 48 x 32 G as 121.92 x 81.28 mm and 480 x 320 pixels by default", () => {
    const svg = toSvg(drawing);
    expect(svg).toContain('width="121.92mm" height="81.28mm"');
    expect(dimensions(toPng(svg))).toEqual([480, 320]);
  });

  it.each([1, 5, 20, 30])("uses the requested %i pixels per grid unit", (scale) => {
    expect(dimensions(toPng(toSvg(drawing), scale))).toEqual([48 * scale, 32 * scale]);
  });

  it.each([0, -1, Infinity, NaN])("rejects an invalid pixel scale: %s", (scale) => {
    expect(() => toPng(toSvg(drawing), scale)).toThrow(RangeError);
  });
});
