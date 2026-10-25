// The findings of validation cases 1-8 and gate 6's generated circuit (seed 30, 16 patterns), as
// review() gives them: every finding, the fix it offers and the fix's checked effect. The snapshot in
// tests/snapshots/findings.json was written by `npx tsx scripts/findings-snapshot.ts` before review()
// was made faster; tests/findings-snapshot.test.ts checks the output still matches it byte for byte.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { cmpStr } from "../../src/geom/geom.js";
import { layout, type Project } from "../../src/layout/layout.js";
import { review, type ReviewFinding } from "../../src/edit/findings.js";
import { readProject } from "../../src/io/project.js";
import { generate } from "./generate.js";

const VALIDATION = join(import.meta.dirname, "..", "..", "phase0", "cases", "validation");

export interface SnapshotEntry { status: string; findings: ReviewFinding[] }

function one(project: Project): SnapshotEntry {
  const r = layout(project);
  if (!r.render || !r.state) return { status: r.status, findings: [] };
  return { status: r.status, findings: review(project, r.state, r.render) };
}

/** Names of the snapshot entries, in order: validation cases 1-8, then the generated circuit. */
export function snapshotNames(): string[] {
  const cases = readdirSync(VALIDATION).filter((f) => /^case0[1-8].*\.json$/.test(f)).sort(cmpStr).map((f) => f.replace(/\.json$/, ""));
  return [...cases, "generated-30-16"];
}

export function findingsOf(name: string): SnapshotEntry {
  if (name === "generated-30-16") return one({ circuit: generate(30, 16).circuit });
  const r = readProject(join(VALIDATION, `${name}.json`));
  if (!r.ok || !r.project) throw new Error(`${name}: ${r.errors[0]?.code ?? "load error"}`);
  return one(r.project);
}

export function findingsSnapshot(): Record<string, SnapshotEntry> {
  return Object.fromEntries(snapshotNames().map((n) => [n, findingsOf(n)]));
}
