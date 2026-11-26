// The playground's Web Worker: loads the font once, then draws, tidies and converts on request,
// so the page stays responsive and keeps the engine bundle out of main.js. Messages:
//   page -> worker  { type: "draw", id, text }
//                 | { type: "tidy", id, text }
//                 | { type: "convert", id, text, to, purpose }
//   worker -> page  { type: "ready", catalog }
//                 | { type: "drawn", id, result }
//                 | { type: "tidied", id, result }
//                 | { type: "converted", id, to, purpose, result }
//                 | { type: "failed", message }

import {
  catalog, convertCircuit, draw, tidyCircuit,
  type CircuitFormat, type ConvertResult, type DrawResult, type TidyResult,
} from "./core.js";
import { setFontBytes } from "./shims/font-file.js";

type Incoming =
  | { type: "draw"; id: number; text: string }
  | { type: "tidy"; id: number; text: string }
  | { type: "convert"; id: number; text: string; to: CircuitFormat; purpose: "edit" | "download" };

interface Scope {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: Incoming }) => void) | null;
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
  const msg = e.data;
  if (msg.type === "draw") {
    let result: DrawResult;
    try {
      result = draw(msg.text);
    } catch (err) {
      // An engine bug, not a problem with the circuit: say so plainly.
      result = { verdict: "error", problems: [{ kind: "error", text: `Internal error, please report it: ${err instanceof Error ? err.message : String(err)}` }], ms: 0 };
    }
    scope.postMessage({ type: "drawn", id: msg.id, result });
  } else if (msg.type === "tidy") {
    let result: TidyResult;
    try {
      result = tidyCircuit(msg.text);
    } catch (err) {
      result = { ok: false, error: `Internal error: ${err instanceof Error ? err.message : String(err)}` };
    }
    scope.postMessage({ type: "tidied", id: msg.id, result });
  } else if (msg.type === "convert") {
    let result: ConvertResult;
    try {
      result = convertCircuit(msg.text, msg.to);
    } catch (err) {
      result = { ok: false, error: `Internal error: ${err instanceof Error ? err.message : String(err)}` };
    }
    scope.postMessage({ type: "converted", id: msg.id, to: msg.to, purpose: msg.purpose, result });
  }
};

void start();
