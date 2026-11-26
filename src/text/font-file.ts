// The font file's bytes. From source they are read from the dejavu-fonts-ttf package; the package
// build (scripts/build.ts) replaces this file so dist/schem.js reads from dist/fonts/.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** Path of the bundled font (DejaVu Sans). */
export function fontPath(): string {
  return createRequire(import.meta.url).resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
}

export function fontBytes(): Uint8Array {
  return readFileSync(fontPath());
}
