// Shared format detection and syntax highlighting for JSON and .schem text schematics.
// Pure ES2022 with no DOM or Node imports, so it works in the browser page, the worker, and
// the docs generator (scripts/lib/docs-page.ts).

export type CircuitFormat = "json" | "dsl";

/** Detect whether circuit text is JSON or .schem text DSL. */
export function detectFormat(text: string): CircuitFormat {
  return /^\uFEFF?\s*[{[]/.test(text) ? "json" : "dsl";
}

export const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])/g;

/** Highlight JSON text (one line or multi-line). Token spans are colour-only for caret alignment. */
export function highlightJson(code: string): string {
  let out = "", last = 0;
  for (const m of code.matchAll(JSON_TOKEN)) {
    out += escHtml(code.slice(last, m.index));
    if (m[1]) out += `<span class="${m[2] ? "t-key" : "t-str"}">${escHtml(m[1])}</span>${m[2] ? `<span class="t-pun">${escHtml(m[2])}</span>` : ""}`;
    else if (m[3]) out += `<span class="t-num">${m[3]}</span>`;
    else if (m[4]) out += `<span class="t-lit">${m[4]}</span>`;
    else out += `<span class="t-pun">${escHtml(m[5]!)}</span>`;
    last = m.index! + m[0].length;
  }
  return out + escHtml(code.slice(last));
}

const DSL_KEYWORDS = new Set([
  "circuit", "style", "part", "net", "connect", "chain", "nc", "hint", "group", "lock", "override",
]);

const DSL_SUBWORDS = new Set([
  "strict", "row", "column", "near", "right-of", "left-of", "above", "below",
  "horizontal", "vertical", "decouples", "pins-left", "pins-right", "pins-top", "pins-bottom",
  "at", "rotate", "flip", "input", "output",
]);

const ENDPOINT = /^[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_+-]+\]|\.[A-Za-z0-9_+-]+|\{[A-Za-z0-9_+-]+\})$/;
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
const DSL_NUM = /^(?:[+-]?\d+(?:\.\d+)?(?:[pnumkMGT]?(?:[A-Za-z]+|Ω)?)?|\d+[pnumkMGT]\d+|[+-]?\d+,[+-]?\d+)$/;

function scanQuoted(line: string, from: number): number {
  let i = from + 1;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "\\" && i + 1 < line.length) { i += 2; continue; }
    i++;
    if (ch === '"') break;
  }
  return i;
}

/** Highlight one line of .schem text DSL, preserving every character verbatim. */
export function highlightDslLine(line: string): string {
  let out = "", i = 0, tokenIndex = 0, stmt = "";
  const n = line.length;

  while (i < n) {
    const ch = line[i]!;

    // Horizontal whitespace
    if (ch === " " || ch === "\t") {
      let j = i + 1;
      while (j < n && (line[j] === " " || line[j] === "\t")) j++;
      out += line.slice(i, j);
      i = j;
      continue;
    }

    // Comment starting a token
    if (ch === "#") {
      out += `<span class="t-com">${escHtml(line.slice(i))}</span>`;
      break;
    }

    // Trailing line continuation backslash
    if (ch === "\\" && /^[ \t]*$/.test(line.slice(i + 1))) {
      out += `<span class="t-pun">\\</span>${line.slice(i + 1)}`;
      break;
    }

    // Quoted string token
    if (ch === '"') {
      const end = scanQuoted(line, i);
      out += `<span class="t-str">${escHtml(line.slice(i, end))}</span>`;
      tokenIndex++;
      i = end;
      continue;
    }

    // Chain arrow operator
    if (ch === "-" && line[i + 1] === ">" && (stmt === "chain" || tokenIndex > 0)) {
      out += `<span class="t-pun">-&gt;</span>`;
      tokenIndex++;
      i += 2;
      continue;
    }

    // Read a bare token (supporting key="quoted value" and stopping at whitespace or chain arrow)
    const start = i;
    let eqQuotedAt = -1;
    while (i < n && line[i] !== " " && line[i] !== "\t") {
      if (stmt === "chain" && line[i] === "-" && line[i + 1] === ">") break;
      if (line[i] === "\\" && /^[ \t]*$/.test(line.slice(i + 1))) break;
      if (line[i] === '"' && i > start && line[i - 1] === "=") {
        eqQuotedAt = i - 1;
        i = scanQuoted(line, i);
        break;
      }
      i++;
    }
    const tok = line.slice(start, i);

    if (eqQuotedAt !== -1) {
      const key = line.slice(start, eqQuotedAt);
      const val = line.slice(eqQuotedAt + 1, i);
      if (OPTION_KEY.test(key)) {
        out += `<span class="t-key">${escHtml(key)}</span><span class="t-pun">=</span><span class="t-str">${escHtml(val)}</span>`;
      } else {
        out += escHtml(tok);
      }
      tokenIndex++;
      continue;
    }

    if (tokenIndex === 0) {
      stmt = tok;
      if (DSL_KEYWORDS.has(tok)) out += `<span class="t-key">${escHtml(tok)}</span>`;
      else out += escHtml(tok);
      tokenIndex++;
      continue;
    }

    if (tok === "=") {
      out += `<span class="t-pun">=</span>`;
    } else if (tok === "pins:") {
      out += `<span class="t-key">pins</span><span class="t-pun">:</span>`;
    } else if (tok.includes("=")) {
      const eq = tok.indexOf("=");
      const key = tok.slice(0, eq);
      const val = tok.slice(eq + 1);
      if (eq > 0 && OPTION_KEY.test(key) && val) {
        const valCls = DSL_NUM.test(val) ? "t-num" : "t-str";
        out += `<span class="t-key">${escHtml(key)}</span><span class="t-pun">=</span><span class="${valCls}">${escHtml(val)}</span>`;
      } else {
        out += escHtml(tok);
      }
    } else if (ENDPOINT.test(tok)) {
      out += `<span class="t-ep">${escHtml(tok)}</span>`;
    } else if (DSL_SUBWORDS.has(tok) || (stmt === "override" && tok === "net")) {
      out += `<span class="t-lit">${escHtml(tok)}</span>`;
    } else if (!(stmt === "net" && tokenIndex === 1) && DSL_NUM.test(tok)) {
      out += `<span class="t-num">${escHtml(tok)}</span>`;
    } else {
      out += escHtml(tok);
    }
    tokenIndex++;
  }
  return out;
}

/** Highlight multi-line .schem text DSL. */
export function highlightDsl(code: string): string {
  return code.split("\n").map(highlightDslLine).join("\n");
}
