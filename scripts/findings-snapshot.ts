// Writes tests/snapshots/findings.json (see tests/support/findings-snapshot.ts). Run it only when the
// findings are meant to change; the snapshot test is there to catch changes that were not meant.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingsSnapshot } from "../tests/support/findings-snapshot.js";
import { ROOT } from "./lib/case-run.js";

const dir = join(ROOT, "tests", "snapshots");
mkdirSync(dir, { recursive: true });
const path = join(dir, "findings.json");
writeFileSync(path, `${JSON.stringify(findingsSnapshot(), null, 2)}\n`);
console.log(`wrote ${path}`);
