// JSON syntax errors with a line and a column. JSON.parse only gives a position for some
// errors (for "Unexpected token" it gives a snippet instead), so this small scanner finds the
// offset itself. It is only used when the text is already known to be bad JSON; JSON.parse
// remains the authority on whether the file is valid.

export interface JsonProblem {
  index: number;
  message: string;
}

export function jsonProblem(text: string): JsonProblem | null {
  let i = 0;
  const at = (message: string, index = i): JsonProblem => ({ index, message });
  const ws = (): void => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };

  const value = (): JsonProblem | null => {
    ws();
    if (i >= text.length) return at("the file ends here, where a value should start.");
    const c = text[i]!;
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || (c >= "0" && c <= "9")) return number();
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return null;
      }
    }
    if (c === "}") return at("found \"}\" where a value should be. A trailing comma is not allowed.");
    if (c === "]") return at("found \"]\" where a value should be. A trailing comma is not allowed.");
    return at(`"${c}" cannot start a value. Strings and property names need double quotes.`);
  };

  const string = (): JsonProblem | null => {
    i++; // opening quote
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        i++;
        return null;
      }
      if (c === "\n" || c === "\r") return at("a string is not closed before the end of the line.");
      if (c === "\\") {
        const next = text[i + 1];
        if (next === undefined) return at("the file ends in the middle of an escape sequence.");
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return at("\\u must be followed by four hexadecimal digits.", i + 2);
          i += 6;
        } else if ('"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          return at(`"\\${next}" is not a valid escape. Use \\" \\\\ \\/ \\b \\f \\n \\r or \\t.`, i);
        }
        continue;
      }
      if (c.charCodeAt(0) < 0x20) return at("a string contains a control character; write it as an escape such as \\n.");
      i++;
    }
    return at("the file ends before the closing double quote of a string.");
  };

  const number = (): JsonProblem | null => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || m[0].length === 0) return at("this is not a valid number.");
    i += m[0].length;
    return null;
  };

  const object = (): JsonProblem | null => {
    i++; // {
    ws();
    if (text[i] === "}") {
      i++;
      return null;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') return at("a property name must be a double-quoted string.");
      const keyError = string();
      if (keyError) return keyError;
      ws();
      if (text[i] !== ":") return at("expected \":\" after the property name.");
      i++;
      const valueError = value();
      if (valueError) return valueError;
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return null;
      }
      if (i >= text.length) return at("the file ends before the closing brace }.");
      return at("expected a comma or the closing brace } after a value.");
    }
  };

  const array = (): JsonProblem | null => {
    i++; // [
    ws();
    if (text[i] === "]") {
      i++;
      return null;
    }
    for (;;) {
      const valueError = value();
      if (valueError) return valueError;
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return null;
      }
      if (i >= text.length) return at("the file ends before the closing bracket ].");
      return at("expected a comma or the closing bracket ] after a value.");
    }
  };

  const problem = value();
  if (problem) return problem;
  ws();
  if (i < text.length) return at("there is text after the end of the JSON value.");
  return null;
}

/** 1-based line and column of an offset in text. */
export function lineColumn(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(index, text.length)));
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: index - lastNewline };
}
