// Writes phase0/MANIFEST.sha256: SHA-256 of every file under phase0/cases/, one "<hex>  <path>" line each,
// paths relative to phase0/ with forward slashes, sorted by code point. Run once, at the freeze:
//   npx tsx phase0/write-manifest.ts
// Refuses to overwrite an existing manifest (frozen files never change; see AUTHOR-NOTES.md).

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestLines, PHASE0 } from "./check-cases.js";

const path = join(PHASE0, "MANIFEST.sha256");
if (existsSync(path) && !process.argv.includes("--force-before-commit")) {
  console.error("MANIFEST.sha256 already exists. The cases are frozen; add corrections as new files instead.");
  process.exit(1);
}
const lines = manifestLines();
writeFileSync(path, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} entries to MANIFEST.sha256`);
