import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isNegativeSupply, netKind, type Circuit, type Net } from "../src/core/model.js";
import { xformPath } from "../src/geom/geom.js";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { drawnAsPorts } from "../src/layout/ports.js";
import { checkDrawing } from "../src/quality/index.js";
import { BUILTIN } from "../src/symbols/library.js";

describe("negative supplies", () => {
  it.each(["VEE", "vee", "V-", "-12V", "-3V3", "-1.5v"])("%s is a negative power net", (name) => {
    const net = { id: "rail", name, endpoints: [] };
    expect(netKind(net)).toBe("power");
    expect(isNegativeSupply(net)).toBe(true);
  });

  it("keeps explicit kinds and recognises VSS as negative power when declared", () => {
    const vss: Net = { id: "rail", name: "VSS", endpoints: [] };
    expect(netKind(vss)).toBe("ground");
    expect(isNegativeSupply(vss)).toBe(false);
    expect(isNegativeSupply({ ...vss, kind: "power" })).toBe(true);
    expect(isNegativeSupply({ ...vss, name: "VEE", kind: "signal" })).toBe(false);
    expect(isNegativeSupply({ ...vss, name: "+12V" })).toBe(false);
  });

  it("keeps a two-terminal loop through a source wired", () => {
    const net = { id: "rail", name: "-12V", endpoints: ["R1[2]", "V1[-]"] };
    expect(drawnAsPorts(net, net.endpoints, (part) => part === "V1" ? "vsource" : "resistor")).toBe(false);
  });

  it("draws the push-pull bias string and lower transistor down to VEE", () => {
    const project = readProject(join(import.meta.dirname, "..", "bench", "circuits", "pushpull.schem.json")).project!;
    const r = layout(project);
    expect(r.status).toBe("valid");
    const m = r.render!;
    const quality = checkDrawing(project.circuit, r.pinDefs, m);
    expect(quality.valid).toBe(true);
    expect(quality.conventions).toEqual([]);
    const pin = (part: string, number: string) => m.electrical.pins.find((p) => p.part === part && p.number === number)!;
    const upper = pin("Q1", "C"), lower = pin("Q2", "C"), tail = pin("R5", "2");
    expect(upper.dir).toBe("up");
    expect(lower.dir).toBe("down");
    expect(lower.at[1]).toBeGreaterThan(upper.at[1]);
    expect(tail.at[0]).toBe(pin("R4", "1").at[0]);
    expect(tail.at[1]).toBeGreaterThan(pin("D2", "K").at[1]);
    const ports = m.electrical.ports.filter((p) => p.text === "VEE");
    expect(ports).toHaveLength(2);
    for (const port of ports) {
      expect(port.kind).toBe("power");
      expect([lower.at, tail.at]).toContainEqual(port.at);
      const d = xformPath(BUILTIN.supply!.graphics[0]!.d, port.at, { rot: 180, flip: false });
      expect(m.art).toContainEqual({ t: "path", d, fill: "none" });
      expect(m.art).toContainEqual(expect.objectContaining({ t: "text", text: "VEE", x: port.at[0], y: port.at[1] + 1.3, baseline: "top" }));
    }
  });

  it("orients a lone negative pull-down towards its port", () => {
    const circuit: Circuit = {
      parts: [{ id: "R1", type: "resistor" }, { id: "V1", type: "vsource" }, { id: "U1", type: "opamp" }],
      nets: [
        { id: "rail", name: "-12V", endpoints: ["R1[2]"] },
        { id: "signal", endpoints: ["R1[1]", "U1[2]", "V1[+]"] },
        { id: "ground", name: "GND", endpoints: ["U1[3]", "V1[-]"] },
      ],
    };
    const r = layout({ circuit });
    expect(r.status).toBe("valid");
    const pin = r.render!.electrical.pins.find((p) => p.part === "R1" && p.number === "2")!;
    expect(pin.dir).toBe("down");
    expect(r.render!.electrical.ports).toContainEqual({ at: pin.at, kind: "power", text: "-12V", domain: null });
  });
});
