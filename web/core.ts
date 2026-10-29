// The playground's engine side: what `schem draw` does, for text instead of a file, returning
// structured results for the page instead of printing. It runs in a Web Worker (web/worker.ts);
// tests/web.test.ts runs it in Node too, before and after bundling, and checks it draws every
// example byte-identically to the command line.

import { revision } from "../src/edit/edit.js";
import { jsonProblem, lineColumn } from "../src/io/json-problem.js";
import { fromLayoutCache } from "../src/io/layout-cache.js";
import { loadProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { MODULE_LIBRARY } from "../src/modules/index.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { BUILTIN } from "../src/symbols/library.js";

export interface Problem {
  kind: "error" | "warning" | "note" | "verifier" | "overlap" | "issue" | "layout";
  text: string;
  /** 1-based position in the text, for JSON syntax errors. */
  line?: number;
  column?: number;
}

export interface DrawResult {
  /** `valid`: drawn and every check passed. `problems`: drawn, with problems listed. `error`: not drawn. */
  verdict: "valid" | "problems" | "error";
  svg?: string;
  title?: string;
  problems: Problem[];
  stats?: { parts: number; nets: number; overlaps: number };
  ms: number;
}

/** Lay out, check and render a circuit file's text, as `schem draw` does. */
export function draw(text: string): DrawResult {
  const t0 = performance.now();
  const done = (r: Omit<DrawResult, "ms">): DrawResult => ({ ...r, ms: Math.round(performance.now() - t0) });

  try {
    JSON.parse(text);
  } catch {
    const p = jsonProblem(text);
    if (!p) return done({ verdict: "error", problems: [{ kind: "error", text: "The text is not valid JSON." }] });
    const { line, column } = lineColumn(text, p.index);
    return done({ verdict: "error", problems: [{ kind: "error", text: `Bad JSON at line ${line}, column ${column}: ${p.message}`, line, column }] });
  }

  const loaded = loadProject(text);
  if (!loaded.ok || !loaded.project) {
    const problems: Problem[] = [...loaded.errors.map((e) => ({ kind: "error" as const, text: e.message })), ...loaded.warnings.map((w) => ({ kind: "warning" as const, text: w.message }))];
    if (loaded.missingTypes.length) problems.push({ kind: "note", text: "Open Parts to see every part type and its pin names." });
    return done({ verdict: "error", problems });
  }
  const project = loaded.project;
  const problems: Problem[] = loaded.warnings.map((w) => ({ kind: "warning", text: w.message }));

  // A file saved by `schem edit` is drawn as it was saved, as `schem draw` does.
  const saved = fromLayoutCache(project.layoutCache, revision(project));
  if (saved.note) problems.push({ kind: "note", text: saved.note });
  let result = saved.state ? layout(project, { previous: saved.state, affected: [] }) : layout(project);
  if (saved.state && (!result.render || result.status !== "valid")) {
    problems.push({ kind: "note", text: "The saved layout no longer draws cleanly with this version of schem, so it is drawn afresh." });
    result = layout(project);
  }
  if (!result.render) {
    return done({ verdict: "error", problems: [...problems, { kind: "error", text: `Could not draw it (${result.status}).` }, ...result.issues.map((i) => ({ kind: "issue" as const, text: i }))] });
  }

  const quality = checkDrawing(project.circuit, result.pinDefs, result.render);
  const valid = quality.valid && result.status === "valid";
  if (!valid) {
    for (const e of quality.connections.errors) problems.push({ kind: "verifier", text: `${e.code} ${e.message}` });
    for (const o of quality.overlaps) problems.push({ kind: "overlap", text: `${o.code} ${o.message}` });
    for (const i of result.issues) problems.push({ kind: "issue", text: i });
    if (result.status === "valid_low_confidence") {
      // The engine's own notes say which parts it was unsure how to place, in plain words.
      const why = result.notes.filter((n) => n.includes("low confidence"));
      problems.push(...(why.length ? why : ["The layout is unsure how to place part of this circuit."]).map((text) => ({ kind: "layout" as const, text })));
    } else if (result.status !== "valid") problems.push({ kind: "layout", text: result.status });
  }
  return done({
    verdict: valid ? "valid" : "problems",
    svg: toSvg(result.render),
    ...(project.meta.title ? { title: project.meta.title } : {}),
    problems,
    stats: { parts: project.circuit.parts.length, nets: project.circuit.nets.length, overlaps: quality.overlaps.length },
  });
}

export interface PartType {
  type: string;
  /** Reference prefix for a new part's id (R for a resistor). */
  prefix: string;
  /** `symbol`: a drawn symbol; `board`: a module drawn as a box; `box`: an `ic` or `header` with its own pins. */
  kind: "symbol" | "board" | "box";
  name?: string;
  pins: Array<{ number: string; name: string; aliases?: string[] }>;
  /** The symbol's artwork, for an icon: a viewBox and its paths (fill when `fill`). */
  art?: { viewBox: string; paths: Array<{ d: string; fill: boolean }> };
}

/** Every part type the engine knows, for the Parts panel: symbols first, then boards. */
export function catalog(): PartType[] {
  const symbols = Object.values(BUILTIN)
    .filter((s) => s.kind !== "port")
    .map((s): PartType => {
      // The artwork plus every pin stub, padded so strokes are not clipped.
      const xs = [s.art.x, s.art.x + s.art.w, ...s.pins.map((p) => p.at[0])], ys = [s.art.y, s.art.y + s.art.h, ...s.pins.map((p) => p.at[1])];
      const [x0, x1, y0, y1] = [Math.min(...xs) - 0.5, Math.max(...xs) + 0.5, Math.min(...ys) - 0.5, Math.max(...ys) + 0.5];
      return {
        type: s.id, prefix: s.refPrefix, kind: "symbol",
        pins: s.pins.map((p) => ({ number: p.number, name: p.name, ...(p.aliases?.length ? { aliases: [...p.aliases] } : {}) })),
        art: { viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}`, paths: s.graphics.map((g) => ({ d: g.d, fill: g.fill === "stroke" })) },
      };
    })
    .sort((a, b) => (a.type < b.type ? -1 : 1));
  const boxes: PartType[] = [
    { type: "ic", prefix: "U", kind: "box", name: "Chip with your own pins", pins: [] },
    { type: "header", prefix: "J", kind: "box", name: "Connector with your own pins", pins: [] },
  ];
  const boards = Object.values(MODULE_LIBRARY).map((m): PartType => ({
    type: m.id, prefix: m.refPrefix, kind: "board", name: m.name,
    pins: m.pins.map((p) => ({ number: p.number, name: p.name, ...(p.aliases?.length ? { aliases: [...p.aliases] } : {}) })),
  }));
  return [...symbols, ...boxes, ...boards];
}
