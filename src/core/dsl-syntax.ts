// Tokenise one physical source into logical statements (SPEC 8.1).
import type { Issue } from "./model.js";

export interface Span {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface DslIssue extends Issue { span: Span }

export interface Token {
  text: string;
  quoted?: string;
  span: Span;
}

export class DslError extends Error {
  constructor(public readonly issue: DslIssue) { super(issue.message); }
}

export function diagnostic(code: string, message: string, span: Span): DslIssue {
  const { start, end } = span;
  return { code, message, at: `${start.line}:${start.column}-${end.line}:${end.column}`, span };
}

export function fail(token: Token, message: string, code = "E101"): never {
  throw new DslError(diagnostic(code, message, token.span));
}

export function lex(source: string): Token[][] {
  const input = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines: Token[][] = [];
  let tokens: Token[] = [];
  let offset = 0, line = 1, column = 1;
  const pos = () => ({ line, column });
  const peek = () => input[offset];
  const advance = () => {
    const char = input[offset++]!;
    if (char === "\n") { line++; column = 1; }
    else column++;
    return char;
  };
  const horizontal = (c: string | undefined) => c === " " || c === "\t";
  const continuation = () => peek() === "\\" && /^\\[ \t]*\n/.test(input.slice(offset));
  const arrow = () => tokens[0]?.text === "chain" && input.startsWith("->", offset);

  while (offset < input.length) {
    const start = pos();
    if (peek() === "\n") {
      if (tokens.length) lines.push(tokens);
      tokens = [];
      advance();
    } else if (horizontal(peek())) {
      advance();
    } else if (peek() === "#") {
      while (peek() !== undefined && peek() !== "\n") advance();
    } else if (continuation()) {
      while (advance() !== "\n") { /* consume the physical newline */ }
    } else {
      let text = "";
      let quoted: string | undefined;
      const token = (): Token => ({ text, ...(quoted !== undefined ? { quoted } : {}), span: { start, end: pos() } });
      if (arrow()) text = advance() + advance();
      else {
        while (peek() !== undefined && peek() !== "\n" && !horizontal(peek()) && !arrow() && !continuation()) {
          if (peek() !== '"') { text += advance(); continue; }
          if (text && !text.endsWith("=")) fail(token(), "A quoted string must start a token or follow an option's =.");
          advance();
          quoted = "";
          while (peek() !== undefined && peek() !== "\n" && peek() !== '"') {
            const c = advance();
            if (c !== "\\") { quoted += c; continue; }
            const escaped = peek();
            if (escaped !== '"' && escaped !== "\\") fail(token(), 'Supported string escapes are \\\\ and \\".');
            quoted += advance();
          }
          if (peek() !== '"') fail(token(), "Unterminated string.");
          advance();
          if (peek() !== undefined && peek() !== "\n" && !horizontal(peek()) && !arrow() && !continuation())
            fail(token(), "Expected whitespace after the quoted string.");
          break;
        }
      }
      tokens.push(token());
    }
  }
  if (tokens.length) lines.push(tokens);
  return lines;
}
