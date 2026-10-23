// The SPEC Appendix A worked examples as fixed placements (rev C.2). Every coordinate below
// follows from the constraints written in the appendix; comments name the constraint.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layout, type Placement, type Prewire, type Project } from "../../src/layout/layout.js";

const cases = join(import.meta.dirname, "..", "..", "cases");
const load = (f: string) => JSON.parse(readFileSync(join(cases, f), "utf8")) as Project;
const up = { rot: 90 as const, flip: false };

// A.1: U1 at (30, 20), so INm = (30, 19), INp = (30, 21), OUT = (36, 20).
const INm: [number, number] = [30, 19];
const S = INm[0] - 3;               // node column
const T = INm[0] + 6 + 2;           // output tap column, OUT.x + 2
export const A1 = {
  project: load("case03-summing.json"),
  place: {
    U1: { at: [30, 20] },
    R1: { at: [S - 8, INm[1] - 2] },  // pin2.x = S - 2; R1.y = INm.y - 2
    R2: { at: [S - 8, INm[1] + 3] },  // R2.y - R1.y = 5 (R2's two-line label sits above it)
    R3: { at: [S - 8, INm[1] + 8] },  // R3.y - R2.y = 5
    Rf: { at: [S + 2, INm[1] - 5] },  // Rf.y = INm.y - 5; pin1.x = S + 2; pin2.x = S + 8 <= T - 1
    RL: { at: [T + 3, 22], orient: up }, // load to the right of the tap, pin 1 up
    V1: { at: [2, INm[1]], orient: up },  // sources: "+" up, one bend into R_i[1]
    V2: { at: [10, INm[1] + 5], orient: up },
    V3: { at: [18, INm[1] + 10], orient: up },
  } satisfies Placement,
  prewire: undefined as Prewire | undefined,
  expect: { dots: 4, crossings: 0 },
};

// A.2: generated IC boxes, so pin offsets are read from a first layout at the origin.
export function A2() {
  const project = load("case05-i2c.json");
  const sides: Placement = {
    U1: { at: [0, 0], sides: { right: ["3", "4"] } },                       // GPIO21 (SDA) above GPIO22 (SCL)
    U2: { at: [0, 0], sides: { top: ["3", "4"], right: ["1"], bottom: ["2"] } }, // SCL left of SDA; supply on the right
    U3: { at: [0, 0], sides: { top: ["3", "4"], right: ["1"], bottom: ["2"] } },
    R1: { at: [0, 0], orient: up },
    R2: { at: [0, 0], orient: up },
  };
  const probe = layout(project, { place: sides });
  const pin = (part: string, n: string) => probe.render!.electrical.pins.find((p) => p.part === part && p.number === n)!.at;
  const box = (part: string) => probe.render!.electrical.keepouts!.find((k) => k.part === part)!;
  const sda = 20;                                     // SDA trunk row, U1 GPIO21
  const u1: [number, number] = [4 - box("U1").x, sda - pin("U1", "3")[1]];
  const r1x = u1[0] + pin("U1", "3")[0] + 4;
  const r2x = r1x + 8;                                // R1's label width + 2, rounded up
  const pinTop = sda + 2 + 5;                         // U2.top >= SCL + 5 (the label above the box)
  const u2: [number, number] = [r2x + 8 - box("U2").x, pinTop - pin("U2", "3")[1]];
  const u3: [number, number] = [u2[0] + box("U2").w + 6, u2[1]];
  const place: Placement = {
    U1: { ...sides.U1!, at: u1 },
    R1: { at: [r1x, sda - 8], orient: up },          // pin2 two rows above the SDA trunk
    R2: { at: [r2x, sda - 8], orient: up },
    U2: { ...sides.U2!, at: u2 },
    U3: { ...sides.U3!, at: u3 },
  };
  // Trunks as pre-routed runs: from each controller pin's approach point to the last peripheral's tap.
  const at = (p: [number, number], part: string, n: string): [number, number] => [p[0] + pin(part, n)[0], p[1] + pin(part, n)[1]];
  const scl = sda + 2;
  const prewire: Prewire = {
    n3: [[[at(u1, "U1", "3")[0] + 1, sda], [at(u3, "U3", "4")[0], sda]]],  // SDA
    n4: [[[at(u1, "U1", "4")[0] + 1, scl], [at(u3, "U3", "3")[0], scl]]],  // SCL
  };
  // Crossings = number of peripherals: R2's drop, plus each SDA tap except the last one's.
  return { project, place, prewire, expect: { dots: 4, crossings: 2 } };
}
