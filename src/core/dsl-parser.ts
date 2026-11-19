// Statement grammar (SPEC 8.2). The compiler binds every reference after parsing.
import type { Hint, HintPriority, Intent, Lock, NetStyle, Side } from "./intent.js";
import type { NetKind, Part, PinDef, Role } from "./model.js";
import { fail, type Token } from "./dsl-syntax.js";
import { defaultRole } from "../io/project.js";

export const PART_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
export const TYPE = /^[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)?$/;
export const NET_NAME = /^[A-Za-z0-9_+.-]+$/;
export const PIN = /^[A-Za-z0-9_+-]+$/;
export const TERMINAL = /^[A-Za-z][A-Za-z0-9_]*\[[A-Za-z0-9_+-]+\]$/;
const ENDPOINT = /^(?:[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_+-]+|\{[A-Za-z0-9_+-]+\}))$/;
export const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PIN_DECL = /^(?:([A-Za-z0-9_+-]+):)?([A-Za-z0-9_+-]+)(?:\/([A-Za-z0-9_+-]+))?(?:@([A-Za-z0-9_+-]+))?$/;
const ROLES = new Set<string>(["power_in", "power_out", "ground", "input", "output", "bidir", "passive", "nc"]);
const SIDES = ["left", "right", "top", "bottom"] as const;
const RELATIONS = ["right-of", "left-of", "above", "below"] as const;
const LABEL_SIDES = ["above", "below", "left", "right"] as const;
const STYLES = ["wire", "port", "label"] as const;
type LabelSide = NonNullable<NonNullable<Intent["overrides"]>["labelSide"]>[string];
type HintBody =
  | Omit<Extract<Hint, { type: "relative" }>, "id" | "priority">
  | Omit<Extract<Hint, { type: "align" }>, "id" | "priority">
  | { type: "orient"; part: string; orientation: "vertical" | "horizontal" }
  | { type: "decouples"; part: string; pin: Token }
  | { type: "pinSides"; part: string; sides: Partial<Record<Side, Token[]>> }
  | { type: "near"; part: string; of: string }
  | { type: "flow"; direction: "input" | "output"; part: string };

type Body =
  | { type: "circuit"; title: string }
  | { type: "style"; options: Record<string, string> }
  | { type: "part"; part: Part; typeToken: Token; properties: Map<string, Token>; pins?: Token }
  | { type: "net"; name: string; kind?: NetKind; domain?: string; endpoints: Token[] }
  | { type: "connect"; endpoints: Token[] }
  | { type: "chain"; links: Token[] }
  | { type: "nc"; terminals: Token[] }
  | { type: "hint"; priority: HintPriority; body: HintBody }
  | { type: "group"; name: string; parts: string[] }
  | { type: "lock"; lock: Lock }
  | { type: "labelSide"; part: string; side: LabelSide }
  | { type: "netStyle"; name: string; endpoint?: Token; style: NetStyle["style"] };

export type Statement<K extends Body["type"] = Body["type"]> = Extract<Body, { type: K }> & { source: Token };

class Line {
  private index = 1;
  constructor(private readonly tokens: readonly Token[]) {}

  get done(): boolean { return this.index >= this.tokens.length; }
  peek(): Token | undefined { return this.tokens[this.index]; }
  is(text: string): boolean { return this.peek()?.text === text && this.peek()?.quoted === undefined; }
  take(label: string): Token {
    const token = this.peek();
    if (!token) {
      const end = this.tokens.at(-1)!.span.end;
      fail({ text: "", span: { start: end, end } }, `Expected ${label}.`);
    }
    this.index++;
    return token;
  }
  bare(label: string, pattern: RegExp): Token {
    const token = this.take(label);
    if (token.quoted !== undefined || !pattern.test(token.text)) fail(token, `Expected ${label}.`);
    return token;
  }
  id(): string { return this.bare("a part id", PART_ID).text; }
  endpoint(terminalOnly = false): Token {
    const token = this.take(terminalOnly ? "a terminal" : "an endpoint");
    if (token.quoted !== undefined || (!TERMINAL.test(token.text) && (terminalOnly || !ENDPOINT.test(token.text))))
      fail(token, `"${token.text}" is not a ${terminalOnly ? "terminal" : "pin reference"}.`, "E104");
    return token;
  }
  exact(text: string): void {
    const token = this.take(`"${text}"`);
    if (token.text !== text || token.quoted !== undefined) fail(token, `Expected "${text}".`);
  }
  string(): string {
    const token = this.take("a quoted string");
    if (token.text || token.quoted === undefined) fail(token, "Expected a quoted string.");
    return token.quoted;
  }
  optionAhead(): boolean {
    const text = this.peek()?.text ?? "";
    return text.indexOf("=") > 0;
  }
  option(): { key: string; value: string; token: Token } {
    const token = this.take("an option in key=value form");
    const equals = token.text.indexOf("=");
    const key = token.text.slice(0, equals), value = token.quoted ?? token.text.slice(equals + 1);
    if (equals < 1 || !OPTION_KEY.test(key) || (token.quoted === undefined && !value)
      || (token.quoted !== undefined && !token.text.endsWith("=")))
      fail(token, "Expected key=value with no spaces around =.");
    return { key, value, token };
  }
  gather<T>(read: () => T): T[] {
    const values: T[] = [];
    while (!this.done) values.push(read());
    return values;
  }
}

function choice<T extends string>(token: Token, value: string, choices: readonly T[]): T {
  if (!(choices as readonly string[]).includes(value)) fail(token, `Expected ${choices.join(", ")}.`);
  return value as T;
}

function part(line: Line): Body {
  const id = line.id(), typeToken = line.bare("a part type", TYPE);
  const props = new Map<string, string>(), properties = new Map<string, Token>();
  if (!line.done && !line.optionAhead() && !line.is("pins:")) {
    const value = line.take("a part value");
    props.set("value", value.quoted ?? value.text);
    properties.set("value", value);
  }
  while (line.optionAhead()) {
    const { key, value, token } = line.option();
    if (props.has(key)) fail(token, `Part property "${key}" is set twice.`);
    props.set(key, value);
    properties.set(key, token);
  }
  const pins = line.is("pins:") ? line.take("pins:") : undefined;
  const definition: Part = { id, type: typeToken.text, ...(props.size ? { props: Object.fromEntries(props) } : {}) };
  if (pins) {
    if (line.done) fail(pins, "Expected at least one pin declaration.");
    definition.pins = [];
    for (const [i, token] of line.gather(() => line.bare("a pin declaration", PIN_DECL)).entries()) {
      const [, number, name, role, group] = PIN_DECL.exec(token.text)!;
      if (role !== undefined && !ROLES.has(role)) fail(token, `Unknown pin role "${role}".`);
      const pin: PinDef = { number: number ?? String(i + 1), name: name!, role: (role as Role | undefined) ?? defaultRole(name!) };
      if (group !== undefined) pin.group = group;
      definition.pins.push(pin);
    }
  }
  return { type: "part", part: definition, typeToken, properties, pins };
}

function net(line: Line): Body {
  const name = line.bare("a net name", NET_NAME).text;
  let kind: NetKind | undefined, domain: string | undefined;
  while (line.optionAhead()) {
    const { key, value, token } = line.option();
    if (key === "kind" && kind === undefined) kind = choice(token, value, ["signal", "power", "ground"] as const);
    else if (key === "domain" && domain === undefined) domain = value;
    else fail(token, `Unknown or repeated net option "${key}".`);
  }
  line.exact("=");
  return { type: "net", name, kind, domain, endpoints: [line.endpoint(), ...line.gather(() => line.endpoint())] };
}

function chain(line: Line): Body {
  const link = () => PART_ID.test(line.peek()?.text ?? "") ? line.bare("a chain link", PART_ID) : line.endpoint();
  const links = [link()];
  do {
    line.exact("->");
    links.push(link());
  } while (!line.done);
  return { type: "chain", links };
}

function hintBody(line: Line): HintBody {
  if (line.is("near")) {
    line.exact("near");
    return { type: "near", part: line.id(), of: line.id() };
  }
  if (line.is("input") || line.is("output")) {
    const direction = line.take("input or output").text as "input" | "output";
    return { type: "flow", direction, part: line.id() };
  }
  if (line.is("row") || line.is("column")) {
    const axis = line.take("row or column").text as "row" | "column";
    const parts = [line.id(), line.id()];
    while (!line.done && !line.optionAhead()) parts.push(line.id());
    return { type: "align", axis, parts };
  }
  const part = line.id(), relation = line.take("a hint relation or pin side");
  if (relation.quoted !== undefined) fail(relation, "Expected a hint relation or pin side.");
  switch (relation.text) {
    case "horizontal":
    case "vertical": return { type: "orient", part, orientation: relation.text };
    case "decouples": return { type: "decouples", part, pin: line.endpoint() };
    case "pins-left":
    case "pins-right":
    case "pins-top":
    case "pins-bottom": {
      const sides: Partial<Record<Side, Token[]>> = {};
      let token: Token | undefined = relation;
      while (token) {
        const side = choice(token, token.text.slice(5), SIDES);
        if (sides[side]) fail(token, `Pin side "${side}" is listed twice.`);
        const selected: Token[] = [];
        while (!line.done && !SIDES.some((s) => line.is(`pins-${s}`)) && !line.optionAhead())
          selected.push(line.bare("a pin name or numbered terminal", /^[A-Za-z0-9_+-]+$|^[A-Za-z][A-Za-z0-9_]*\[[A-Za-z0-9_+-]+\]$/));
        if (!selected.length) fail(token, "Expected at least one pin.");
        sides[side] = selected;
        token = SIDES.some((s) => line.is(`pins-${s}`)) ? line.take("a pin side") : undefined;
      }
      return { type: "pinSides", part, sides };
    }
    default: return { type: "relative", part, rel: choice(relation, relation.text, RELATIONS), of: line.id() };
  }
}

function hint(line: Line): Body {
  const strict = line.is("strict");
  if (strict) line.exact("strict");
  const body = hintBody(line);
  if (line.done) return { type: "hint", priority: strict ? "strict" : "normal", body };
  const { key, value, token } = line.option();
  if (key !== "priority") fail(token, "Expected priority=high or priority=normal.");
  if (strict) fail(token, "Use strict or a priority option.");
  return { type: "hint", priority: choice(token, value, ["normal", "high"]), body };
}

function lock(line: Line): Body {
  const part = line.id();
  line.exact("at");
  const point = line.take("two comma-separated grid coordinates");
  let coords = point.text;
  if (!coords.includes(",")) coords += line.take("a comma and the second coordinate").text;
  if (coords.endsWith(",")) coords += line.take("the second coordinate").text;
  const match = /^([+-]?\d+),([+-]?\d+)$/.exec(coords);
  if (!match || point.quoted !== undefined || !match.slice(1).every((n) => Number.isSafeInteger(Number(n))))
    fail(point, "Expected two integer grid coordinates, for example 20,10.");
  let rot: Lock["rot"] = 0;
  if (line.is("rotate")) {
    line.exact("rotate");
    rot = Number(line.bare("a rotation of 0, 90, 180 or 270", /^(?:0|90|180|270)$/).text) as Lock["rot"];
  }
  const flip = line.is("flip");
  if (flip) line.exact("flip");
  return { type: "lock", lock: { part, x: Number(match[1]), y: Number(match[2]), rot, flip } };
}

function override(line: Line): Body {
  if (line.is("net")) {
    line.exact("net");
    const name = line.bare("a net name", NET_NAME).text;
    let endpoint: Token | undefined;
    if (line.is("at")) { line.exact("at"); endpoint = line.endpoint(true); }
    const { key, value, token } = line.option();
    if (key !== "style") fail(token, "Expected a style option.");
    return { type: "netStyle", name, endpoint, style: choice(token, value, STYLES) };
  }
  const part = line.id(), { key, value, token } = line.option();
  if (key !== "label-side") fail(token, "Expected a label-side option.");
  return { type: "labelSide", part, side: choice(token, value, LABEL_SIDES) };
}

export function parse(tokens: readonly Token[]): Statement {
  const head = tokens[0]!, line = new Line(tokens);
  const source = { ...head, span: { start: head.span.start, end: tokens.at(-1)!.span.end } };
  let body: Body;
  switch (head.text) {
    case "circuit": body = { type: "circuit", title: line.string() }; break;
    case "style": {
      const first = line.option();
      const options = [first, ...line.gather(() => line.option())];
      const entries = new Map<string, string>();
      for (const { key, value, token } of options) {
        if (entries.has(key)) fail(token, `Style option "${key}" is set twice.`);
        entries.set(key, value);
      }
      body = { type: "style", options: Object.fromEntries(entries) };
      break;
    }
    case "part": body = part(line); break;
    case "net": body = net(line); break;
    case "connect": body = { type: "connect", endpoints: [line.endpoint(), line.endpoint(), ...line.gather(() => line.endpoint())] }; break;
    case "chain": body = chain(line); break;
    case "nc": body = { type: "nc", terminals: [line.endpoint(true), ...line.gather(() => line.endpoint(true))] }; break;
    case "hint": body = hint(line); break;
    case "group": body = { type: "group", name: line.string(), parts: [line.id(), ...line.gather(() => line.id())] }; break;
    case "lock": body = lock(line); break;
    case "override": body = override(line); break;
    default: fail(head, `Unknown statement "${head.quoted ?? head.text}".`);
  }
  if (!line.done) fail(line.take("end of statement"), "Unexpected token at the end of the statement.");
  return { ...body, source };
}
