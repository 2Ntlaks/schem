// The font file's bytes. In Node they are read from the dejavu-fonts-ttf package; the playground
// build (scripts/web.ts) replaces this file with one that returns bytes the page fetched.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** Path of the bundled font (DejaVu Sans). */
export function fontPath(): string {
  return createRequire(import.meta.url).resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
}

export function fontBytes(): Uint8Array {
  return readFileSync(fontPath());
}
