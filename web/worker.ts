// The playground's Web Worker: loads the font once, then draws on request, so the page stays
// responsive while a large circuit is laid out. Messages:
//   page -> worker  { type: "draw", id, text }
//   worker -> page  { type: "ready", catalog } | { type: "drawn", id, result } | { type: "failed", message }

import { catalog, draw, type DrawResult } from "./core.js";
import { setFontBytes } from "./shims/font-file.js";

interface Scope {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: { type: "draw"; id: number; text: string } }) => void) | null;
}
const scope = self as unknown as Scope;

async function start(): Promise<void> {
  try {
    const res = await fetch(new URL("fonts/DejaVuSans.ttf", self.location.href));
    if (!res.ok) throw new Error(`the font could not be loaded (HTTP ${res.status})`);
    setFontBytes(new Uint8Array(await res.arrayBuffer()));
    scope.postMessage({ type: "ready", catalog: catalog() });
  } catch (e) {
    scope.postMessage({ type: "failed", message: e instanceof Error ? e.message : String(e) });
  }
}

scope.onmessage = (e) => {
  const { id, text } = e.data;
  let result: DrawResult;
  try {
    result = draw(text);
  } catch (err) {
    // An engine bug, not a problem with the circuit: say so plainly.
    result = { verdict: "error", problems: [{ kind: "error", text: `Internal error, please report it: ${err instanceof Error ? err.message : String(err)}` }], ms: 0 };
  }
  scope.postMessage({ type: "drawn", id, result });
};

void start();
