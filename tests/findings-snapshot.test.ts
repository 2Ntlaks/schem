// review() output must not change when the fix dry-runs are made faster: every finding, every
// offered fix and its checked effect (expect, tradeoff, changesCircuit, expectedLayout) must match the
// snapshot taken before the speed-up (tests/snapshots/findings.json), on validation cases 1-8 and on
// gate 6's generated 30-part circuit.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findingsOf, snapshotNames, type SnapshotEntry } from "./support/findings-snapshot.js";

const saved = JSON.parse(readFileSync(join(import.meta.dirname, "snapshots", "findings.json"), "utf8")) as Record<string, SnapshotEntry>;

describe("findings snapshot (SPEC 10.2 output unchanged by the gate 6 speed-up)", () => {
  it("covers validation cases 1-8 and the generated circuit", () => {
    expect(snapshotNames()).toEqual(Object.keys(saved));
    expect(Object.keys(saved)).toHaveLength(9);
  });
  for (const name of snapshotNames()) {
    it(name, () => {
      expect(JSON.stringify(findingsOf(name), null, 2)).toBe(JSON.stringify(saved[name], null, 2));
    }, 120_000);
  }
});
