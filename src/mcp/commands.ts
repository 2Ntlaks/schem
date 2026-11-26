// File commands used by both front ends (SPEC 11).
import { basename, dirname, join } from "node:path";
import { formatDsl } from "../core/dsl-format.js";
import { canonical, type PinDef } from "../core/model.js";
import { validate } from "../core/validate.js";
import { fromLayoutCache } from "../io/layout-cache.js";
import { saveProject } from "../io/project.js";
import { importSpice } from "../io/spice.js";
import { applyEditScript, parseEditScript, type EditScript } from "../io/edit-script.js";
import { revision } from "../edit/edit.js";
import { stabilityBreaks, type ChangeReport } from "../edit/report.js";
import { altText } from "../quality/alt-text.js";
import { toSvg, type SvgOptions } from "../render/svg.js";
import { resolveTheme, THEME_NAMES } from "../render/themes.js";
import { cmpStr } from "../geom/geom.js";
import { MODULE_LIBRARY, modulePins } from "../modules/index.js";
import { BUILTIN } from "../symbols/library.js";
import { resolvePath, showPath, type Roots } from "./roots.js";
import { exclusiveCreate, replaceWithHistory, restoreLatest, withLock, writeOutput, WriteConflict } from "./store.js";
import {
  drawProject,
  findingIds,
  fitScale,
  focusBox,
  focusPoints,
  guardProject,
  labelPixels,
  LABEL_MIN_PX,
  MAX_FILE,
  MAX_PNG_SIDE,
  PREVIEW_MAX,
  pageOf,
  queryBody,
  readDetail,
  renderPng,
  sheetPayload,
  toJson,
  type Detail,
  type Drawn,
} from "./sheet.js";

import { commitProject, formatOf, guardedProject, loadSource, loadWithin, projectText, withLayoutComment, type Failure } from "./project-files.js";

export interface CommandResult {
  body: Record<string, unknown>;
  image?: Buffer;
  isError: boolean;
}

function success(body: Record<string, unknown>, image?: Buffer): CommandResult {
  return { body, ...(image ? { image } : {}), isError: false };
}

function fail(body: string | Record<string, unknown>): CommandResult {
  const result = typeof body === "string" ? { error: body } : { error: "the command failed.", ...body };
  return { body: result, isError: true };
}

function inputFailure(failure: Failure): CommandResult {
  return fail({ error: failure.message, ...(failure.issues?.length ? { issues: failure.issues } : {}) });
}

function writeFailure(error: unknown): CommandResult {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof WriteConflict ? fail({ error: message, status: "conflict" }) : fail(message);
}

function pathOf(v: unknown, label: string): { ok: true; path: string } | { ok: false; message: string } {
  if (typeof v !== "string" || v.trim() === "") return { ok: false, message: `${label} is missing.` };
  return { ok: true, path: v };
}

function flag(v: unknown, label: string): { ok: true; value: boolean } | { ok: false; message: string } {
  if (v === undefined) return { ok: true, value: false };
  if (typeof v === "boolean") return { ok: true, value: v };
  return { ok: false, message: `${label} is true or false.` };
}

export function executeCommand(roots: Roots, name: string, args: Record<string, unknown>): CommandResult {
  switch (name) {
    case "schem_create": return schemCreate(roots, args);
    case "schem_edit": return schemEdit(roots, args);
    case "schem_check": return schemCheck(roots, args);
    case "schem_preview": return schemPreview(roots, args);
    case "schem_query": return schemQuery(roots, args);
    case "schem_render": return schemRender(roots, args);
    case "schem_undo": return schemUndo(roots, args);
    case "schem_fmt": return schemFmt(roots, args);
    case "schem_describe": return schemDescribe(roots, args);
    case "schem_components": return schemComponents(args);
    case "schem_component": return schemComponent(args);
    case "schem_import": return schemImport(roots, args);
    default: return fail(`unknown tool "${name}".`);
  }
}

function schemCreate(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const detail = readDetail(args.detail, "normal");
  if (detail === undefined) return fail("detail is brief, normal or full.");
  if (args.source === undefined) return fail("source is missing.");
  const opened = resolvePath(roots, path.path, "create");
  if (!opened.ok) return fail(opened.message);
  const loaded = loadSource(args.source);
  if (!loaded.ok) return inputFailure(loaded);
  if (loaded.project.unknownFields.length) {
    return fail(`this netlist uses fields this engine does not know (${loaded.project.unknownFields.join(", ")}). Nothing was written.`);
  }
  const drawn = drawProject(loaded.project);
  if (drawn.result.render === undefined || drawn.result.state === undefined || !drawn.result.status.startsWith("valid")) {
    return fail({
      error: `could not draw this circuit (${drawn.result.status}). Nothing was written.`,
      status: drawn.result.status,
      verified: false,
      issues: [...drawn.result.issues, ...drawn.result.notes],
    });
  }
  let committed: ReturnType<typeof commitProject>;
  try {
    committed = commitProject(loaded.project, drawn.result.state, "canonical", formatOf(path.path));
  } catch (e) {
    return fail(`${(e as Error).message} Nothing was written.`);
  }
  if (Buffer.byteLength(committed.text, "utf8") > MAX_FILE) return fail(`the saved file would be over 2 MB (${MAX_FILE} bytes). Nothing was written.`);
  try {
    withLock(opened.real, () => exclusiveCreate(opened.real, committed.text));
  } catch (e) {
    return writeFailure(e);
  }
  const payload = sheetPayload(loaded.project, drawn, {
    detail, revision: committed.revision, layoutToken: committed.layoutToken,
    warnings: loaded.warnings,
  });
  if (!payload.ok) return fail(payload.message);
  payload.body.saved = true;
  payload.body.path = showPath(opened.real);
  return success(payload.body);
}

function schemEdit(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const detail = readDetail(args.detail, "normal");
  if (detail === undefined) return fail("detail is brief, normal or full.");
  if (args.ops === undefined) return fail("ops is missing.");
  if (args.expectedRevision !== undefined && typeof args.expectedRevision !== "string") return fail("expectedRevision must be a string.");
  if (args.expectedLayout !== undefined && typeof args.expectedLayout !== "string") return fail("expectedLayout must be a string.");
  const dry = flag(args.dryRun, "dryRun");
  if (!dry.ok) return fail(dry.message);
  const strict = flag(args.strict, "strict");
  if (!strict.ok) return fail(strict.message);
  const opened = resolvePath(roots, path.path, "overwrite");
  if (!opened.ok) return fail(opened.message);
  const scriptInput: Record<string, unknown> = { ops: args.ops };
  if (typeof args.expectedRevision === "string") scriptInput.expectedRevision = args.expectedRevision;
  if (typeof args.expectedLayout === "string") scriptInput.expectedLayout = args.expectedLayout;
  const parsed = parseEditScript(scriptInput);
  if (!parsed.ok) return fail(parsed.issues.map((i) => `${i.code} ${i.message}`).join(" "));

  try {
    return withLock(opened.real, () => editLocked(roots, opened.real, parsed.script, detail, dry.value, strict.value));
  } catch (e) {
    return writeFailure(e);
  }
}

function editLocked(roots: Roots, file: string, script: EditScript, detail: Detail, dryRun: boolean, strict: boolean): CommandResult {
  const loaded = loadWithin(roots, file);
  if (!loaded.ok) return inputFailure(loaded);
  const project = loaded.project;
  const drawn = drawProject(project);
  const saved = fromLayoutCache(project.layoutCache, revision(project));
  const previous = saved.state ?? drawn.result.state;
  const beforeIds = drawn.check ? findingIds(drawn.check) : [];
  const run = applyEditScript(project, script, previous, { strict });
  const result = run.result;
  const edited = run.project;
  const state = result.layout?.state;
  const render = result.layout?.render;
  const fileRevision = revision(project);

  if (!result.saved || edited === undefined || state === undefined || render === undefined) {
    return fail({
      error: result.issues[0] ?? `edit refused (${result.status}). Nothing was written.`,
      status: result.status,
      saved: false,
      dryRun,
      verified: false,
      revision: result.revision,
      ...(result.layoutToken ? { layoutToken: result.layoutToken } : {}),
      issues: result.issues,
      ...(result.status === "unstable" && result.report ? { stability: stabilityView(result.report, result.mode) } : {}),
    });
  }

  let committed: ReturnType<typeof commitProject>;
  try {
    committed = commitProject(edited, state, result.mode ?? "canonical", loaded.format);
  } catch (e) {
    return fail(`${(e as Error).message} Nothing was written.`);
  }
  if (Buffer.byteLength(committed.text, "utf8") > MAX_FILE) return fail(`the saved file would be over 2 MB (${MAX_FILE} bytes). Nothing was written.`);
  if (!dryRun) {
    replaceWithHistory(file, committed.text);
  }

  const after: Drawn = { result: { ...result.layout!, render, state }, check: result.check };
  const payload = sheetPayload(edited, after, {
    detail, revision: committed.revision, layoutToken: committed.layoutToken, warnings: loaded.warnings,
  });
  if (!payload.ok) return fail(payload.message);
  const afterIds = result.check ? findingIds(result.check) : [];
  const before = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  payload.body.saved = !dryRun;
  payload.body.dryRun = dryRun;
  payload.body.path = showPath(file);
  if (dryRun) payload.body.fileRevision = fileRevision;
  payload.body.mode = result.mode;
  payload.body.affected = result.affected;
  payload.body.removedHints = run.removedHints;
  payload.body.findingsAdded = afterIds.filter((id) => !before.has(id));
  payload.body.findingsResolved = beforeIds.filter((id) => !afterSet.has(id));
  if (result.report && result.mode !== "canonical") payload.body.stability = stabilityView(result.report, result.mode);
  if (detail === "full" && result.report) payload.body.report = toJson(result.report);
  if (result.issues.length) payload.body.issues = result.issues;
  return success(payload.body);
}

function stabilityView(report: ChangeReport, mode: string | undefined): Record<string, unknown> {
  const breaks = mode === "canonical" ? [] : stabilityBreaks(report);
  return {
    stable: breaks.length === 0,
    breaks,
    untouched: report.untouched,
    otherNetsRerouted: report.routesChanged.other,
  };
}

function schemCheck(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const detail = readDetail(args.detail, "normal");
  if (detail === undefined) return fail("detail is brief, normal or full.");
  const cursor = args.cursor === undefined ? undefined : args.cursor;
  if (cursor !== undefined && typeof cursor !== "string") return fail("cursor must be a string.");
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return inputFailure(loaded);
  const drawn = drawProject(loaded.project);
  if (drawn.result.render === undefined) {
    return fail({ error: `could not draw this circuit (${drawn.result.status}).`, status: drawn.result.status, verified: false, issues: [...drawn.result.issues, ...drawn.result.notes] });
  }
  const payload = sheetPayload(loaded.project, drawn, { detail, ...(typeof cursor === "string" ? { cursor } : {}), warnings: loaded.warnings });
  if (!payload.ok) return fail(payload.message);
  payload.body.path = showPath(loaded.real);
  return success(payload.body);
}

function focusIds(v: unknown): string[] | undefined | { error: string } {
  if (v === undefined) return undefined;
  if (typeof v === "string") {
    const ids = v.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (ids.length === 0) return { error: "focus is empty." };
    return ids;
  }
  if (Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "")) return [...v];
  return { error: "focus is a list of part ids, or a comma-separated string." };
}

function schemPreview(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  let maxSize = PREVIEW_MAX;
  if (args.maxSize !== undefined) {
    if (typeof args.maxSize !== "number" || !Number.isFinite(args.maxSize) || args.maxSize <= 0) return fail("maxSize is a positive number of pixels.");
    if (args.maxSize > MAX_PNG_SIDE) return fail(`maxSize cannot be more than ${MAX_PNG_SIDE}.`);
    maxSize = args.maxSize;
  }
  const focus = focusIds(args.focus);
  if (focus !== undefined && !Array.isArray(focus)) return fail(focus.error);
  const finding = args.finding;
  if (finding !== undefined && (typeof finding !== "string" || finding === "")) return fail("finding is an id from check.");
  if (finding !== undefined && focus !== undefined) return fail("give focus or finding, not both.");
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return inputFailure(loaded);
  const drawn = drawProject(loaded.project);
  const render = drawn.result.render;
  if (render === undefined || drawn.result.state === undefined) {
    return fail({ error: `could not draw this circuit (${drawn.result.status}).`, status: drawn.result.status, verified: false });
  }
  if (focus !== undefined) {
    const missing = focus.filter((id) => !loaded.project.circuit.parts.some((p) => p.id === id));
    if (missing.length) return fail(`no part ${missing.join(", ")}.`);
  }
  let crop = focus === undefined ? undefined : focusBox(render, focus);
  if (focus !== undefined && crop === undefined) return fail("those parts have no drawn box to crop.");
  if (finding !== undefined) {
    const check = drawn.check;
    if (!check || !findingIds(check).includes(finding)) return fail(`no finding ${finding}.`);
    const convention = check.conventions.find((entry) => entry.id === finding);
    const breach = check.breaches.find((entry) => `L-${entry.metric}` === finding);
    if (convention) crop = focusBox(render, convention.parts);
    if (breach) crop = focusPoints(render, breach.at);
  }
  const box = crop ?? render.bounds;
  const fitted = fitScale(box.w, box.h, maxSize);
  if (!fitted.ok) return fail(fitted.message);
  const image = renderPng(render, fitted.pxPerGrid, crop);
  if (!image.ok) return fail(image.message);
  const tall = labelPixels(render, image.pxPerGrid);
  let note: string | undefined;
  if (tall < LABEL_MIN_PX) {
    const px = tall.toFixed(1);
    note = focus === undefined
      ? `Labels on the whole sheet would be about ${px} px tall, under 9 px. This image is the overview. Ask again with focus set to the part ids you want to read.`
      : `Labels in this crop would be about ${px} px tall, under 9 px. The crop already fills maxSize. Ask for a larger maxSize if you need to read them.`;
  }
  const payload = sheetPayload(loaded.project, drawn, { detail: "brief", warnings: loaded.warnings });
  if (!payload.ok) return fail(payload.message);
  payload.body.path = showPath(loaded.real);
  payload.body.png = { width: image.width, height: image.height, pxPerGrid: round3(image.pxPerGrid) };
  if (focus !== undefined) payload.body.focus = focus;
  if (finding !== undefined) payload.body.finding = finding;
  if (finding !== undefined && crop === undefined) payload.body.note = "This finding applies to the whole sheet.";
  if (note !== undefined) payload.body.note = payload.body.note === undefined ? note : `${payload.body.note} ${note}`;
  if (typeof args.out === "string") {
    try { payload.body.out = showPath(writeOutput(roots, args.out, loaded.real, image.png, false)); }
    catch (error) { return writeFailure(error); }
    return success(payload.body);
  }
  return success(payload.body, image.png);
}

function schemQuery(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  if (args.part !== undefined && typeof args.part !== "string") return fail("part must be a string.");
  if (args.net !== undefined && typeof args.net !== "string") return fail("net must be a string.");
  if (args.cursor !== undefined && typeof args.cursor !== "string") return fail("cursor must be a string.");
  if (typeof args.part === "string" && typeof args.net === "string") return fail("pass part or net, not both.");
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return inputFailure(loaded);
  const drawn = drawProject(loaded.project);
  const body = queryBody(loaded.project, drawn, {
    ...(typeof args.part === "string" ? { part: args.part } : {}),
    ...(typeof args.net === "string" ? { net: args.net } : {}),
    ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
  });
  if (!body.ok) return fail(body.message);
  body.body.path = showPath(loaded.real);
  return success(body.body);
}

function readScale(args: Record<string, unknown>): { ok: true; px: number; dpi?: number } | { ok: false; message: string } {
  const hasScale = args.scale !== undefined;
  const hasDpi = args.dpi !== undefined;
  if (hasScale && hasDpi) return { ok: false, message: "give scale or dpi, not both." };
  if (hasDpi) {
    if (typeof args.dpi !== "number" || !Number.isFinite(args.dpi) || args.dpi <= 0) return { ok: false, message: "dpi must be a positive number." };
    return { ok: true, px: args.dpi * 0.1, dpi: args.dpi };
  }
  if (hasScale) {
    if (typeof args.scale !== "number" || !Number.isFinite(args.scale) || args.scale <= 0) return { ok: false, message: "scale must be a positive number of pixels per grid unit." };
    return { ok: true, px: args.scale };
  }
  return { ok: true, px: 10 };
}

function schemRender(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const out = pathOf(args.out, "out");
  if (!out.ok) return fail(out.message);
  if (args.format !== "svg" && args.format !== "png") return fail("format is svg or png.");
  if (args.format === "svg" && (args.scale !== undefined || args.dpi !== undefined)) return fail("scale and dpi are for png. svg is vector.");
  const scale = readScale(args);
  if (!scale.ok) return fail(scale.message);
  let theme: string | undefined;
  if (args.theme !== undefined) {
    if (typeof args.theme !== "string" || args.theme.trim() === "") return fail(`theme must be one of: ${THEME_NAMES.join(", ")}.`);
    try { theme = resolveTheme(args.theme).id; }
    catch (e) { return fail((e as Error).message); }
  }
  const transparent = flag(args.transparent, "transparent");
  if (!transparent.ok) return fail(transparent.message);
  const svgOpts: SvgOptions | undefined = theme !== undefined || transparent.value
    ? { ...(theme !== undefined ? { theme } : {}), ...(transparent.value ? { transparent: true } : {}) }
    : undefined;
  const overwrite = flag(args.overwrite, "overwrite");
  if (!overwrite.ok) return fail(overwrite.message);
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return inputFailure(loaded);
  const drawn = drawProject(loaded.project);
  const render = drawn.result.render;
  if (render === undefined || drawn.result.state === undefined) {
    return fail({ error: `could not draw this circuit (${drawn.result.status}). Nothing was written.`, status: drawn.result.status, verified: false });
  }
  if (args.requireValid === true && (drawn.result.status !== "valid" || !drawn.check?.valid))
    return fail({ error: "The drawing is not valid. Use --draft to export it.", status: drawn.result.status, verified: false });
  const payload = sheetPayload(loaded.project, drawn, { detail: "brief" });
  if (!payload.ok) return fail(payload.message);
  try {
    if (args.format === "svg") {
      const svg = toSvg(render, svgOpts);
      payload.body.format = "svg";
      payload.body.out = showPath(writeOutput(roots, out.path, loaded.real, svg, overwrite.value));
      payload.body.bytes = Buffer.byteLength(svg, "utf8");
      payload.body.grid = [render.bounds.w, render.bounds.h];
      return success(payload.body);
    }
    const image = renderPng(render, scale.px, undefined, svgOpts);
    if (!image.ok) return fail(image.message);
    const png = scale.dpi === undefined ? image.png : pngWithDpi(image.png, scale.dpi);
    payload.body.format = "png";
    payload.body.out = showPath(writeOutput(roots, out.path, loaded.real, png, overwrite.value));
    payload.body.bytes = png.length;
    payload.body.png = { width: image.width, height: image.height, pxPerGrid: round3(image.pxPerGrid), ...(scale.dpi !== undefined ? { dpi: scale.dpi } : {}) };
    return success(payload.body);
  } catch (e) {
    return writeFailure(e);
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A pHYs chunk records pixels per metre immediately after the fixed-size IHDR chunk. */
function pngWithDpi(png: Buffer, dpi: number): Buffer {
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9);
  chunk.write("pHYs", 4, "ascii");
  const density = Math.round(dpi / 0.0254);
  chunk.writeUInt32BE(density, 8);
  chunk.writeUInt32BE(density, 12);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 17);
  const headerEnd = 33;
  return Buffer.concat([png.subarray(0, headerEnd), chunk, png.subarray(headerEnd)]);
}

function schemUndo(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const opened = resolvePath(roots, path.path, "overwrite");
  if (!opened.ok) return fail(opened.message);
  try {
    return withLock(opened.real, () => restoreLatest(opened.real, (bytes) => {
      if (bytes.length > MAX_FILE) throw new Error("The saved version is over 2 MB.");
      const loaded = guardedProject(projectText(bytes.toString("utf8"), formatOf(path.path)));
      if (!loaded.ok) throw new Error(loaded.message);
      const drawn = drawProject(loaded.project);
      const payload = sheetPayload(loaded.project, drawn, { detail: "brief" });
      if (!payload.ok || drawn.result.status !== "valid" || !drawn.check?.valid)
        throw new Error("The saved version does not draw validly. Nothing was restored.");
      return success({ ...payload.body, saved: true, path: showPath(opened.real) });
    }));
  } catch (error) { return writeFailure(error); }
}

function schemFmt(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const from = formatOf(path.path), to = args.to ?? from;
  if (to !== "dsl" && to !== "json") return fail("format is dsl or json.");
  const opened = resolvePath(roots, path.path, to === from ? "overwrite" : "read");
  if (!opened.ok) return fail(opened.message);
  const format = (): CommandResult => {
    const loaded = loadWithin(roots, path.path);
    if (!loaded.ok) return inputFailure(loaded);
    const project = loaded.project;
    let text: string;
    if (to === "dsl") {
      // A text file already has a revision-bound cache. Keep it on a same-format write.
      const { layoutCache, ...semantic } = project;
      const formatted = formatDsl(from === "dsl" ? semantic : project);
      if (!formatted.ok) return fail({ error: `DSL cannot represent: ${formatted.fields.join(", ")}.`, fields: formatted.fields });
      const verifiedCache = fromLayoutCache(layoutCache, revision(project)).state ? layoutCache : undefined;
      text = withLayoutComment(formatted.source, verifiedCache);
    } else {
      const previous = from === "dsl" ? fromLayoutCache(project.layoutCache, revision(project)).state : undefined;
      text = previous ? commitProject(project, previous, "incremental", "json").text : saveProject(project);
    }
    if (Buffer.byteLength(text) > MAX_FILE) return fail("The formatted file would be over 2 MB.");
    const body = { status: "valid", format: to, path: showPath(loaded.real) };
    if (to === from) {
      if (text === loaded.source) return success({ ...body, saved: false });
      replaceWithHistory(loaded.real, text);
      return success({ ...body, saved: true });
    }
    const name = basename(loaded.real).replace(/(?:\.schem)?\.json$|\.schem$/i, "");
    const dest = join(dirname(loaded.real), `${name}${to === "dsl" ? ".schem" : ".schem.json"}`);
    const written = writeOutput(roots, dest, loaded.real, text, false);
    return success({ ...body, out: showPath(written), saved: true });
  };
  try { return to === from ? withLock(opened.real, format) : format(); }
  catch (error) { return writeFailure(error); }
}

function schemDescribe(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const table = flag(args.table, "table");
  if (!table.ok) return fail(table.message);
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return inputFailure(loaded);
  const { project } = loaded, drawn = drawProject(project);
  const { state, render, status, pinDefs } = drawn.result;
  if (!state || !render || !drawn.check?.valid)
    return fail({ error: "A verified drawing is required for a description.", status, verified: false });
  const circuit = validate(project.circuit, pinDefs).valid!;
  const neighbours = new Map(project.circuit.parts.map((part) => [part.id, new Set<string>()]));
  const rows = project.circuit.nets.map((net) => {
    const endpoints = circuit.endpoints.get(net.id)!;
    for (const first of endpoints) for (const second of endpoints)
      if (first.part !== second.part) neighbours.get(first.part)!.add(second.part);
    const route = state.routes[net.id];
    return { id: net.id, name: net.name ?? net.id, presentation: !route ? "undrawn" : route.ports ? "ports" : "wires", pins: endpoints.map(canonical) };
  });
  const { w, h } = render.bounds, crossings = drawn.check.metrics.crossings;
  const lines = [`Sheet ${w} × ${h} grid units. ${crossings} wire crossings.`];
  for (const part of project.circuit.parts) {
    const placed = state.parts[part.id];
    if (!placed) continue;
    const linked = [...neighbours.get(part.id)!].sort(cmpStr).join(", ") || "none";
    lines.push(`${part.id} (${part.type}) at ${placed.at.join(", ")}, rotated ${placed.orient.rot}°${placed.orient.flip ? ", mirrored" : ""}. Neighbours ${linked}.`);
  }
  for (const net of rows) lines.push(`${net.name} uses ${net.presentation} and connects ${net.pins.join(", ")}.`);
  const payload = sheetPayload(project, drawn, { detail: "brief" });
  if (!payload.ok) return fail(payload.message);
  return success({
    ...payload.body,
    description: lines.join("\n"),
    altText: altText(project.circuit, pinDefs, render, drawn.result.notes),
    ...(table.value ? { table: rows } : {}),
  });
}

function schemComponents(args: Record<string, unknown>): CommandResult {
  const query = args.query ?? "", limit = args.limit ?? 20, cursor = args.cursor;
  if (typeof query !== "string") return fail("query must be text.");
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) return fail("limit must be a positive integer.");
  if (cursor !== undefined && typeof cursor !== "string") return fail("cursor must be a decimal offset.");
  const entries = [
    ...Object.entries(BUILTIN).map(([id, symbol]) => ({ id, kind: symbol.kind, pins: symbol.pins.map(({ at: _at, dir: _dir, ...pin }) => pin) })),
    ...Object.entries(MODULE_LIBRARY).map(([id, module]) => ({ id, kind: "module", name: module.name, pins: modulePins(module) })),
    ...["header", "ic"].map((id) => ({ id, kind: id, inlinePins: true, pins: [] })),
  ].filter((entry) => `${entry.id} ${"name" in entry ? entry.name : ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => cmpStr(a.id, b.id));
  const page = pageOf(entries, typeof cursor === "string" ? cursor : undefined, limit);
  if (!page.ok) return fail(page.message);
  return success({ components: page.items, total: entries.length, cursor: page.next });
}

function componentPin(pin: PinDef): Record<string, unknown> {
  return {
    number: pin.number,
    name: pin.name,
    role: pin.role,
    ...(pin.aliases?.length ? { aliases: [...pin.aliases] } : {}),
    ...(pin.group !== undefined ? { group: pin.group } : {}),
    ...(pin.iface?.length ? { iface: [...pin.iface] } : {}),
    ...(pin.chain !== undefined ? { chain: pin.chain } : {}),
    ...(pin.representative ? { representative: true } : {}),
  };
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(row[j + 1]! + 1, next[j]! + 1, row[j]! + Number(a[i] !== b[j])));
    }
    row = next;
  }
  return row[b.length]!;
}

function closeComponentMatches(query: string): string[] {
  const q = query.toLowerCase();
  const qBare = q.startsWith("module:") ? q.slice("module:".length) : q;
  const tokens = qBare.split(/[-_:\s]+/).filter((t) => t.length >= 2);
  const all: Array<{ id: string; names: string[] }> = [
    ...Object.keys(BUILTIN).map((id) => ({ id, names: [id] })),
    ...Object.entries(MODULE_LIBRARY).map(([id, mod]) => ({
      id,
      names: [id, id.slice("module:".length), mod.name],
    })),
    { id: "header", names: ["header"] },
    { id: "ic", names: ["ic"] },
  ];
  const candidates: Array<{ id: string; tier: number; score: number }> = [];
  for (const entry of all) {
    const lowers = entry.names.map((n) => n.toLowerCase());
    const idLower = entry.id.toLowerCase();
    const idBare = idLower.startsWith("module:") ? idLower.slice("module:".length) : idLower;
    if (lowers.some((n) => n.includes(q) || (qBare.length >= 2 && n.includes(qBare)) || (n.length >= 3 && q.includes(n)))) {
      candidates.push({ id: entry.id, tier: 0, score: Math.abs(idBare.length - qBare.length) });
      continue;
    }
    const dist = Math.min(editDistance(q, idLower), editDistance(qBare, idBare));
    const maxDist = qBare.length <= 2 ? 1 : Math.max(2, Math.floor(Math.min(qBare.length, idBare.length) / 3));
    if (dist <= maxDist) {
      candidates.push({ id: entry.id, tier: 1, score: dist });
      continue;
    }
    if (tokens.some((tok) => lowers.some((n) => n.includes(tok)))) {
      candidates.push({ id: entry.id, tier: 2, score: dist });
    }
  }
  candidates.sort((a, b) => a.tier - b.tier || a.score - b.score || cmpStr(a.id, b.id));
  return candidates.slice(0, 5).map((c) => c.id);
}

function schemComponent(args: Record<string, unknown>): CommandResult {
  if (args.type === undefined) return fail("type is missing.");
  if (typeof args.type !== "string" || args.type.trim() === "") return fail("type must be a non-empty string.");
  const type = args.type.trim();
  if (Object.hasOwn(BUILTIN, type)) {
    const symbol = BUILTIN[type]!;
    return success({
      id: symbol.id,
      kind: symbol.kind,
      refPrefix: symbol.refPrefix,
      inlinePins: false,
      pins: symbol.pins.map(componentPin),
    });
  }
  if (Object.hasOwn(MODULE_LIBRARY, type)) {
    const mod = MODULE_LIBRARY[type]!;
    const pins = modulePins(mod);
    const groups = [...new Set(pins.map((p) => p.group).filter((g): g is string => g !== undefined))].sort(cmpStr);
    const interfaces = [...new Set(pins.flatMap((p) => p.iface ?? []))].sort(cmpStr);
    return success({
      id: mod.id,
      kind: "module",
      name: mod.name,
      refPrefix: mod.refPrefix,
      controller: Boolean(mod.controller),
      inlinePins: false,
      doc: mod.doc,
      ...(groups.length ? { groups } : {}),
      ...(mod.representatives ? { representatives: mod.representatives } : {}),
      ...(interfaces.length ? { interfaces } : {}),
      pins: pins.map(componentPin),
    });
  }
  if (type === "ic" || type === "header") {
    return success({
      id: type,
      kind: type,
      refPrefix: type === "ic" ? "U" : "J",
      inlinePins: true,
      pins: [],
      note: "Declare pins inline on the part. In .schem use pins: [NUMBER:]NAME[/ROLE][@GROUP]; in JSON set the part's pins array.",
    });
  }
  const suggestions = closeComponentMatches(type);
  const hint = suggestions.length
    ? ` Close matches: ${suggestions.join(", ")}.`
    : " Call schem_components to list available types.";
  return fail({
    error: `unknown component type "${type}".${hint}`,
    ...(suggestions.length ? { suggestions } : {}),
  });
}

function schemImport(roots: Roots, args: Record<string, unknown>): CommandResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const detail = readDetail(args.detail, "normal");
  if (detail === undefined) return fail("detail is brief, normal or full.");
  if (args.spice === undefined) return fail("spice is missing.");
  if (typeof args.spice !== "string" || args.spice.trim() === "") return fail("spice must be a non-empty string.");
  if (Buffer.byteLength(args.spice, "utf8") > MAX_FILE) {
    return fail(`the SPICE netlist is over 2 MB (${MAX_FILE} bytes). Nothing was written.`);
  }
  const opened = resolvePath(roots, path.path, "create");
  if (!opened.ok) return fail(opened.message);
  const imported = importSpice(args.spice);
  if (!imported.ok || imported.project === undefined) {
    return fail({
      error: imported.errors[0] ?? "could not import SPICE netlist. Nothing was written.",
      errors: imported.errors,
      ...(imported.warnings.length ? { warnings: imported.warnings } : {}),
    });
  }
  const guards = guardProject(imported.project);
  if (guards.length) return fail(`${guards.join(" ")} Nothing was written.`);
  const drawn = drawProject(imported.project);
  if (drawn.result.render === undefined || drawn.result.state === undefined || !drawn.result.status.startsWith("valid")) {
    return fail({
      error: `could not draw this circuit (${drawn.result.status}). Nothing was written.`,
      status: drawn.result.status,
      verified: false,
      issues: [...drawn.result.issues, ...drawn.result.notes],
      ...(imported.warnings.length ? { warnings: imported.warnings } : {}),
    });
  }
  let committed: ReturnType<typeof commitProject>;
  try {
    committed = commitProject(imported.project, drawn.result.state, "canonical", formatOf(path.path));
  } catch (e) {
    return fail(`${(e as Error).message} Nothing was written.`);
  }
  if (Buffer.byteLength(committed.text, "utf8") > MAX_FILE) {
    return fail(`the saved file would be over 2 MB (${MAX_FILE} bytes). Nothing was written.`);
  }
  try {
    withLock(opened.real, () => exclusiveCreate(opened.real, committed.text));
  } catch (e) {
    return writeFailure(e);
  }
  const payload = sheetPayload(imported.project, drawn, {
    detail,
    revision: committed.revision,
    layoutToken: committed.layoutToken,
    warnings: imported.warnings,
  });
  if (!payload.ok) return fail(payload.message);
  payload.body.saved = true;
  payload.body.path = showPath(opened.real);
  payload.body.warnings = imported.warnings;
  return success(payload.body);
}
