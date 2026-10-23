// Edit scripts of the SPEC 15 kinds on the Phase 0a development cases: a value made 3x longer,
// a part added on an existing net, a part removed, an IC's pin sides changed.
// (The frozen Phase 0b scripts live in phase0/cases/edits/ and are written independently.)

import type { EditOp } from "../../src/edit/edit.js";

export const EDIT_SCRIPTS: Record<string, Record<string, EditOp[]>> = {
  "case01-led.json": {
    "longer value": [{ op: "setProp", part: "D1", key: "color", value: "red, 20 mA, 2 V" }],
    "add part": [{ op: "addPart", part: { id: "C1", type: "capacitor", props: { value: "100u" } } }, { op: "connect", endpoints: ["C1.1", "B1.+"] }, { op: "connect", endpoints: ["C1.2", "B1.-"] }],
    "remove part": [{ op: "removePart", part: "D1" }],
  },
  "case03-summing.json": {
    "longer value": [{ op: "setProp", part: "R2", key: "value", value: "10k 0.1% thin film" }],
    "add part": [{ op: "addPart", part: { id: "C1", type: "capacitor", props: { value: "1n" } } }, { op: "connect", endpoints: ["C1.1", "RL.1"] }, { op: "connect", endpoints: ["C1.2", "U1.IN+"] }],
    "remove part": [{ op: "removePart", part: "RL" }],
  },
  "case05-i2c.json": {
    "longer value": [{ op: "setProp", part: "U2", key: "label", value: "BME280 climate sensor" }],
    "add part": [{ op: "addPart", part: { id: "C1", type: "capacitor", props: { value: "100n" } } }, { op: "connect", endpoints: ["C1.1", "U2.VIN"] }, { op: "connect", endpoints: ["C1.2", "U2.GND"] }],
    "remove part": [{ op: "removePart", part: "U3" }],
    "pin sides": [{ op: "setPinSides", part: "U2", left: ["SDA", "SCL"] }],
  },
};
