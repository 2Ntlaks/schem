// Browser replacement for src/text/font-file.ts (see scripts/lib/web-bundle.ts): the worker
// fetches the font and hands its bytes over before the first drawing.

let bytes: Uint8Array | undefined;

export function setFontBytes(b: Uint8Array): void {
  bytes = b;
}

export function fontPath(): string {
  return "fonts/DejaVuSans.ttf";
}

export function fontBytes(): Uint8Array {
  if (!bytes) throw new Error("the font has not been loaded yet");
  return bytes;
}
