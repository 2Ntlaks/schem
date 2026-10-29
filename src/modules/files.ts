// The module library's files as (name, text) pairs: every *.json in this folder. The playground
// build (scripts/web.ts) replaces this file with the same pairs written in at build time.

import { readdirSync, readFileSync } from "node:fs";

export function moduleFiles(): Array<[string, string]> {
  const dir = new URL(".", import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, readFileSync(new URL(`./${f}`, dir), "utf8")]);
}
