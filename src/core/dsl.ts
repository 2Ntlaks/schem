// Compile text to the same project and circuit model used by the JSON loader (SPEC 8).
import { cmpNatural, cmpStr } from "../geom/geom.js";
import { loadProject, NEAR_HINT_SCHEMA, SCHEMA, type LoadResult } from "../io/project.js";
import { solve, type Constraint } from "../layout/solver.js";
import { BUILTIN } from "../symbols/library.js";
import type { Hint, Intent, Lock, NetStyle, Side } from "./intent.js";
import { canonical, CircuitError, type Circuit, type Endpoint, type Issue, type Net, type Part, type PinDefs } from "./model.js";
import { applyOps } from "./ops.js";
import { parseQuantity, quantityOf } from "./quantity.js";
import { classOf, resolveEndpoint, validate } from "./validate.js";
import { parse, PART_ID, TERMINAL, type Statement } from "./dsl-parser.js";
import { diagnostic, DslError, fail, lex, type DslIssue, type Token } from "./dsl-syntax.js";

export type { DslIssue, Span } from "./dsl-syntax.js";
export interface DslResult extends LoadResult { errors: DslIssue[]; warnings: DslIssue[] }

const FILE_START: Token = { text: "", span: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } };
const issueAt = (issue: Issue, token: Token): DslIssue => diagnostic(issue.code, issue.message, token.span);

function select<K extends Statement["type"]>(statements: readonly Statement[], type: K): Statement<K>[] {
  return statements.filter((statement): statement is Statement<K> => statement.type === type);
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(row[j + 1]! + 1, next[j]! + 1, row[j]! + Number(a[i] !== b[j])));
    row = next;
  }
  return row[b.length]!;
}

function partIssue(issue: Issue, parts: readonly Statement<"part">[]): DslIssue {
  const statement = [...parts].reverse().find((candidate) => candidate.part.id === issue.at) ?? parts.at(-1);
  if (statement && issue.code === "E201") {
    const type = statement.part.type;
    const match = Object.keys(BUILTIN)
      .map((name) => ({ name, distance: distance(type, name) }))
      .sort((a, b) => a.distance - b.distance || cmpStr(a.name, b.name))[0];
    const suggestion = match && match.distance <= 2 ? ` Did you mean "${match.name}"?` : "";
    return diagnostic(issue.code, `unknown part type "${type}".${suggestion}`, statement.typeToken.span);
  }
  return issueAt(issue, statement?.pins ?? statement?.source ?? FILE_START);
}

function endpoint(token: Token, definitions: PinDefs, parts: ReadonlyMap<string, Part>): Endpoint {
  const found = resolveEndpoint(token.text, definitions);
  if (found.ok) return found.ep;
  const part = parts.get(token.text.split(/[.[{]/, 1)[0]!);
  const message = found.issue.code === "E104" && part
    ? found.issue.message.replace(`. ${part.id} has pins `, `. ${part.id} (${part.type}) has pins `)
    : found.issue.message;
  return fail(token, message, found.issue.code);
}

function endpointOrder(a: Endpoint, b: Endpoint): number {
  return cmpStr(a.part, b.part)
    || cmpNatural(a.kind === "terminal" ? a.number : a.group, b.kind === "terminal" ? b.number : b.group)
    || cmpStr(a.kind, b.kind);
}

interface Declaration { net: Net; token: Token; ep: Endpoint; source: Token }

function namedNets(
  statements: readonly Statement<"net">[], circuit: Circuit, definitions: PinDefs, parts: ReadonlyMap<string, Part>,
): { errors: DslIssue[]; declarations: Declaration[] } {
  const byName = new Map<string, Net>(), declarations: Declaration[] = [];
  for (const statement of statements) {
    let net = byName.get(statement.name);
    if (!net) {
      net = { id: `n${byName.size + 1}`, name: statement.name, endpoints: [] };
      byName.set(statement.name, net);
      circuit.nets.push(net);
    }
    for (const key of ["kind", "domain"] as const) {
      const value = statement[key];
      if (value === undefined) continue;
      if (net[key] !== undefined && net[key] !== value)
        fail(statement.source, `Net ${statement.name} already has a different ${key}.`, "E240");
      Object.assign(net, { [key]: value });
    }
    for (const token of statement.endpoints) {
      const ep = endpoint(token, definitions, parts);
      const value = canonical(ep);
      if (!net.endpoints.includes(value)) net.endpoints.push(value);
      declarations.push({ net, token, ep, source: statement.source });
    }
  }

  const { issues } = validate(circuit, definitions);
  const errors = issues.map((issue) => {
    const collision = declarations.find((d) => canonical(d.ep) === issue.at);
    if (!collision || (issue.code !== "E220" && issue.code !== "E222"))
      return issueAt(issue, collision?.token ?? FILE_START);
    const group = classOf(collision.ep, definitions);
    const first = declarations.find((d) => classOf(d.ep, definitions) === group)!;
    const second = declarations.find((d) => d.net !== first.net && classOf(d.ep, definitions) === group)!;
    const earlier = `${first.net.name} (line ${first.token.span.start.line})`;
    const later = `${second.net.name} (line ${second.token.span.start.line})`;
    const message = issue.code === "E220"
      ? `${second.token.text} is already in net ${earlier}. It cannot also be in net ${later}.`
      : `${second.token.text} is connected inside ${second.ep.part} to ${first.token.text}, which is in net ${earlier}. Putting it in net ${later} would short them.`;
    return diagnostic(issue.code, message, second.source.span);
  });
  return { errors, declarations };
}

function connect(
  statements: readonly Statement[], initial: Circuit, definitions: PinDefs, parts: ReadonlyMap<string, Part>,
): { circuit: Circuit; sources: Map<string, Token>; warnings: DslIssue[] } {
  let circuit = initial;
  const warnings: DslIssue[] = [], sources = new Map<string, Token>();
  for (const statement of statements) {
    if (statement.type !== "connect" && statement.type !== "chain") continue;
    const link = (token: Token) => {
      if (!PART_ID.test(token.text)) {
        const pin = canonical(endpoint(token, definitions, parts));
        sources.set(pin, token);
        return { input: pin, output: pin };
      }
      const part = parts.get(token.text);
      if (!part) fail(token, `unknown part "${token.text}".`, "E251");
      const pins = Object.hasOwn(BUILTIN, part.type) ? definitions[part.id] ?? [] : [];
      const input = pins.find((pin) => pin.chain === "in"), output = pins.find((pin) => pin.chain === "out");
      if (pins.length !== 2 || !input || !output)
        fail(token, `${part.id} (${part.type}) needs an explicit pin in a chain.`, "E206");
      const pair = { input: `${part.id}[${input.number}]`, output: `${part.id}[${output.number}]` };
      for (const pin of Object.values(pair)) sources.set(pin, token);
      return pair;
    };
    const ops = [];
    if (statement.type === "connect") {
      const endpoints = statement.endpoints.map((token) => {
        const pin = canonical(endpoint(token, definitions, parts));
        sources.set(pin, token);
        return pin;
      });
      ops.push({ op: "connect" as const, endpoints });
    } else {
      const links = statement.links.map(link);
      for (let i = 1; i < links.length; i++)
        ops.push({ op: "connect" as const, endpoints: [links[i - 1]!.output, links[i]!.input] });
      for (const [index, side] of [[0, "input"], [links.length - 1, "output"]] as const) {
        const token = statement.links[index]!;
        if (PART_ID.test(token.text))
          warnings.push(diagnostic("W411", `Chain leaves outer pin ${links[index]![side]} unconnected.`, token.span));
      }
    }
    try { circuit = applyOps(circuit, definitions, ops).circuit; }
    catch (error) {
      if (!(error instanceof CircuitError)) throw error;
      throw new DslError(issueAt(error.issues[0]!, statement.source));
    }
  }
  return { circuit, sources, warnings };
}

function parseHint(statement: Statement<"hint">, id: string, definitions: PinDefs, parts: ReadonlyMap<string, Part>): Hint {
  const { body, priority, source } = statement;
  const basics = { id, priority };
  switch (body.type) {
    case "align":
    case "near":
    case "relative": return { ...body, ...basics };
    case "orient":
      return { id, priority, type: "orient", part: body.part, rot: body.orientation === "vertical" ? 90 : 0, flip: false };
    case "flow": return fail(source, `The project model does not yet support a ${body.type} hint.`, "E260");
    case "decouples": return { ...body, ...basics, pin: canonical(endpoint(body.pin, definitions, parts)) };
    case "pinSides": {
      const part = parts.get(body.part);
      if (!part) fail(source, `unknown part "${body.part}".`, "E251");
      if (part.type !== "ic" && part.type !== "header" && !part.type.startsWith("module:"))
        fail(source, `${body.part} (${part.type}) has fixed pin sides.`, "E270");
      const sides: Partial<Record<Side, string[]>> = {}, seen = new Set<string>();
      for (const [side, tokens] of Object.entries(body.sides) as Array<[Side, Token[]]>) {
        sides[side] = tokens.map((token) => {
          const ref = TERMINAL.test(token.text) ? token.text : `${body.part}.${token.text}`;
          const pin = endpoint({ ...token, text: ref }, definitions, parts);
          if (pin.kind !== "terminal" || pin.part !== body.part)
            fail(token, `Pin side needs one physical pin of ${body.part}.`, "E104");
          if (seen.has(pin.number)) fail(token, `Pin ${canonical(pin)} occurs more than once.`, "E270");
          seen.add(pin.number);
          return pin.number;
        });
      }
      return { type: "pinSides", part: body.part, ...basics, sides };
    }
  }
}

function intentOf(
  statements: readonly Statement[], circuit: Circuit, definitions: PinDefs, parts: ReadonlyMap<string, Part>,
): { intent: Intent; sources: Map<string, Token> } {
  const intent: Intent = {}, sources = new Map<string, Token>();
  const styles = new Map<string, string>(), labels = new Map<string, "above" | "below" | "left" | "right">();
  const nets = new Map(circuit.nets.map((net) => [net.name, net])), overrides: NetStyle[] = [];
  const hints: Hint[] = [], locks: Lock[] = [];
  for (const statement of statements) {
    switch (statement.type) {
      case "style":
        for (const [key, value] of Object.entries(statement.options)) {
          if (styles.has(key)) fail(statement.source, `Style option "${key}" is set twice.`);
          styles.set(key, value);
        }
        break;
      case "group": fail(statement.source, "The project model does not yet support group hints.", "E260");
      case "hint": {
        const id = `h${hints.length + 1}`;
        const hint = parseHint(statement, id, definitions, parts);
        sources.set(id, statement.source);
        if (hint.type === "orient" && hint.priority === "strict"
          && hints.some((old) => old.type === "orient" && old.part === hint.part && old.priority === "strict" && old.rot !== hint.rot))
          fail(statement.source, `Conflicting strict orientation hints for ${hint.part}.`, "E263");
        hints.push(hint);
        break;
      }
      case "lock":
        if (!parts.has(statement.lock.part)) fail(statement.source, `unknown part "${statement.lock.part}".`, "E251");
        if (locks.some((l) => l.part === statement.lock.part)) fail(statement.source, `${statement.lock.part} is already locked.`);
        locks.push(statement.lock);
        break;
      case "labelSide":
        if (!parts.has(statement.part)) fail(statement.source, `unknown part "${statement.part}".`, "E251");
        if (labels.has(statement.part)) fail(statement.source, `${statement.part} already has a label-side override.`);
        labels.set(statement.part, statement.side);
        break;
      case "netStyle": {
        const net = nets.get(statement.name);
        if (!net) fail(statement.source, `unknown net "${statement.name}".`, "E241");
        const pin = statement.endpoint && canonical(endpoint(statement.endpoint, definitions, parts));
        if (pin && !net.endpoints.includes(pin)) fail(statement.endpoint!, `${pin} is not in net ${statement.name}.`, "E104");
        if (overrides.some((item) => item.net === net.id && item.endpoint === pin))
          fail(statement.source, `Duplicate style override for net ${statement.name}.`);
        overrides.push({ net: net.id, ...(pin ? { endpoint: pin } : {}), style: statement.style });
        break;
      }
    }
  }
  if (styles.size) intent.style = Object.fromEntries(styles);
  if (locks.length) intent.locks = locks;
  if (hints.length) intent.hints = hints;
  if (labels.size || overrides.length) intent.overrides = {
    ...(labels.size ? { labelSide: Object.fromEntries(labels) } : {}),
    ...(overrides.length ? { netStyle: overrides } : {}),
  };
  return { intent, sources };
}

/** A strict relation must separate the alignment points. A row or column makes them equal. */
function checkStrictPlacement(hints: readonly Hint[], sources: ReadonlyMap<string, Token>): void {
  const constraints: Constraint[] = [], variables = new Set<string>();
  for (const hint of hints) {
    if (hint.priority !== "strict") continue;
    const add = (axis: string, after: string, before: string, gap: number) => {
      const a = `${axis}:${after}`, b = `${axis}:${before}`;
      variables.add(a);
      variables.add(b);
      constraints.push({ a, b, c: gap, priority: "strict", why: hint.id });
    };
    if (hint.type === "relative") {
      const { rel, part, of } = hint;
      const axis = rel === "above" || rel === "below" ? "y" : "x";
      if (rel === "left-of" || rel === "above") add(axis, of, part, 1);
      else add(axis, part, of, 1);
    } else if (hint.type === "align") {
      const axis = hint.axis === "row" ? "y" : "x";
      for (const part of hint.parts.slice(1)) {
        add(axis, hint.parts[0]!, part, 0);
        add(axis, part, hint.parts[0]!, 0);
      }
    }
  }
  if (!constraints.length) return;
  const result = solve([...variables], constraints);
  if (result.ok) return;
  const cycle = new Set(result.cycle.map((entry) => entry.why));
  const members = hints.filter((hint) => cycle.has(hint.id)).map((hint) => sources.get(hint.id)!);
  const lines = members.map((token) => token.span.start.line).join(", ");
  fail(members.at(-1)!, `Strict placement constraints conflict on lines ${lines}.`, "E263");
}

function compile(statements: Statement[]): DslResult {
  const partStatements = select(statements, "part");
  const parts = partStatements.map((statement) => statement.part).sort((a, b) => cmpStr(a.id, b.id));
  const titles = select(statements, "circuit");
  if (titles.length > 1) fail(titles[1]!.source, "The circuit title is already set.");
  const initial: Circuit = { parts, nets: [] };
  const base = loadProject({ schema: SCHEMA, circuit: initial });
  const errors = base.errors.map((issue) => partIssue(issue, partStatements)), warnings: DslIssue[] = [];
  if (!base.ok) return { ...base, errors, warnings };
  const definitions = base.pinDefs!, partMap = new Map(parts.map((part) => [part.id, part]));

  for (const statement of partStatements) {
    const value = statement.part.props?.value, unit = quantityOf(statement.part.type, "value");
    if (value === undefined || !unit) continue;
    const parsed = parseQuantity(value, unit);
    if (!parsed.ok) {
      const at = statement.properties.get("value")!;
      const issue = diagnostic(parsed.code, parsed.message, at.span);
      if (issue.code.startsWith("W")) warnings.push(issue);
      else errors.push(issue);
    }
  }
  if (errors.length) return { ok: false, errors, warnings, missingTypes: [] };
  const named = namedNets(select(statements, "net"), initial, definitions, partMap);
  if (named.errors.length) return { ok: false, errors: named.errors, warnings, missingTypes: [] };
  const connected = connect(statements, initial, definitions, partMap);
  const circuit = connected.circuit;
  warnings.push(...connected.warnings);
  const sources = new Map(named.declarations.map((d) => [canonical(d.ep), d.token]));
  for (const [pin, token] of connected.sources) sources.set(pin, token);

  const noConnect = select(statements, "nc").flatMap((statement) => statement.terminals);
  if (noConnect.length) circuit.nc = [...new Set(noConnect.map((token) => {
    const pin = canonical(endpoint(token, definitions, partMap));
    sources.set(pin, token);
    return pin;
  }))].sort(cmpNatural);

  const keys = new Map(circuit.nets.map((net) => {
    const pins = net.endpoints.map((text) => {
      const resolved = resolveEndpoint(text, definitions);
      if (!resolved.ok) throw new CircuitError([resolved.issue]);
      return resolved.ep;
    }).sort(endpointOrder);
    net.endpoints = pins.map(canonical);
    return [net, pins[0]!];
  }));
  circuit.nets.sort((a, b) => endpointOrder(keys.get(a)!, keys.get(b)!));
  for (const [i, net] of circuit.nets.entries()) net.id = `n${i + 1}`;

  const { intent, sources: hints } = intentOf(statements, circuit, definitions, partMap);
  const meta = { ...(titles[0] && { title: titles[0].title }), nextNetId: circuit.nets.length + 1, nextHintId: (intent.hints?.length ?? 0) + 1 };
  const schema = intent.hints?.some((hint) => hint.type === "near") ? NEAR_HINT_SCHEMA : SCHEMA;
  const loaded = loadProject({ schema, meta, circuit, intent });
  const location = (issue: Issue) => hints.get(issue.at ?? "") ?? sources.get(issue.at ?? "") ?? FILE_START;
  errors.push(...loaded.errors.map((issue) => issueAt(issue, location(issue))));
  warnings.push(...loaded.warnings.map((issue) => issueAt(issue, location(issue))));
  if (!loaded.ok) return { ...loaded, errors, warnings };

  checkStrictPlacement(intent.hints ?? [], hints);
  for (const net of circuit.nets) {
    const pin = net.endpoints[0]!;
    if (net.endpoints.length === 1) {
      const at = sources.get(pin) ?? FILE_START;
      const suggestion = TERMINAL.test(pin) ? ` or mark it: nc ${pin}` : "";
      warnings.push(diagnostic("W410", `net ${net.name ?? net.id} has one endpoint (${at.text || pin}). Connect it${suggestion}.`, at.span));
    }
  }
  return { ...loaded, errors, warnings };
}

export function compileDsl(source: string): DslResult {
  try {
    const statements: Statement[] = [], errors: DslIssue[] = [];
    for (const line of lex(source)) {
      try { statements.push(parse(line)); }
      catch (error) {
        if (!(error instanceof DslError)) throw error;
        errors.push(error.issue);
      }
    }
    return errors.length ? { ok: false, errors, warnings: [], missingTypes: [] } : compile(statements);
  } catch (error) {
    if (!(error instanceof DslError)) throw error;
    return { ok: false, errors: [error.issue], warnings: [], missingTypes: [] };
  }
}
