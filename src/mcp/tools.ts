// The six MCP tools the engine can already answer (SPEC 11.5). schem_undo is not here:
// snapshot history is written, but there is no restore command to wrap. The component
// catalogue is not here either: listing symbols wants a command of its own.

import { readFileSync, statSync } from "node:fs";
import { fromLayoutCache } from "../io/layout-cache.js";
import { loadProject, type LoadedProject } from "../io/project.js";
import { applyEditScript, parseEditScript, type EditScript } from "../io/edit-script.js";
import { revision } from "../edit/edit.js";
import { stabilityBreaks, type ChangeReport } from "../edit/report.js";
import { toSvg } from "../render/svg.js";
import { resolvePath, showPath, type Roots } from "./roots.js";
import { exclusiveCreate, replaceFile, snapshot, withLock } from "./store.js";
import {
  commitDrawing,
  declaredPartCount,
  drawProject,
  findingIds,
  fitScale,
  focusBox,
  guardProject,
  labelPixels,
  LABEL_MIN_PX,
  MAX_FILE,
  MAX_PARTS,
  MAX_PNG_SIDE,
  PREVIEW_MAX,
  queryBody,
  rawPinGuard,
  readDetail,
  renderPng,
  sheetPayload,
  toJson,
  type Detail,
  type Drawn,
} from "./sheet.js";

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" };

export interface ToolResult {
  content: ToolContent[];
  isError: boolean;
}

const LATER = new Set(["schem_undo", "schem_components", "schem_component"]);

export const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: "schem_create",
    description: "Create a new project file from a netlist and draw it. source is JSON text or the object itself. The file must not already exist. The reply has status, revision, layoutToken, counts and, unless detail is brief, the first findings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project file to create, inside a configured root." },
        source: { description: "The netlist as a JSON string, or as an object." },
        detail: { type: "string", enum: ["brief", "normal", "full"], description: "brief is counts only. normal adds the first findings. full also adds metrics. Default normal." },
      },
      required: ["path", "source"],
    },
  },
  {
    name: "schem_edit",
    description: "Apply ops to a project file as one change and save it, keeping the rest of the drawing. Pass expectedLayout from a finding's fix, and expectedRevision when you have the file's revision. dryRun writes nothing. strict refuses an edit that moves untouched parts past the limit; the default saves it and reports the move. A mismatch of either token returns status conflict and writes nothing. Repeating a visual op changes nothing. addPart fails when that part id already exists.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ops: { type: "array", description: "Edit operations, applied in order as one transaction.", items: { type: "object" } },
        expectedRevision: { type: "string" },
        expectedLayout: { type: "string" },
        dryRun: { type: "boolean" },
        strict: { type: "boolean" },
        detail: { type: "string", enum: ["brief", "normal", "full"] },
      },
      required: ["path", "ops"],
    },
  },
  {
    name: "schem_check",
    description: "Read a project file and report status, revision, layoutToken, counts and a page of findings. cursor is a decimal offset. The default page is 5 findings. A fix on a finding was checked against layoutToken: pass that expectedLayout to schem_edit.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        detail: { type: "string", enum: ["brief", "normal", "full"] },
        cursor: { type: "string", description: "Decimal offset into the findings, such as \"5\"." },
      },
      required: ["path"],
    },
  },
  {
    name: "schem_preview",
    description: "Return a PNG of the drawing. maxSize is the longer side in pixels (default 1024, at most 8000). focus is part ids. If fitting the whole sheet would make labels smaller than 9 px, the image is still the overview and the text says to ask again with focus.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxSize: { type: "number" },
        focus: { description: "Part ids to crop to: a list, or a comma-separated string." },
      },
      required: ["path"],
    },
  },
  {
    name: "schem_query",
    description: "Read positions, pins and connections from the drawing. Pass part or net for one of them. With neither, the reply is a page of part positions and net names. cursor is a decimal offset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        part: { type: "string" },
        net: { type: "string" },
        cursor: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "schem_render",
    description: "Write an SVG or a PNG of the drawing to out, inside a configured root. format is svg or png. For png, pass scale (pixels per grid unit, default 10) or dpi, not both. overwrite must be true to replace an existing file. A PNG may be at most 8000 px per side and 40 megapixels.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        format: { type: "string", enum: ["svg", "png"] },
        out: { type: "string" },
        scale: { type: "number" },
        dpi: { type: "number" },
        overwrite: { type: "boolean" },
      },
      required: ["path", "format", "out"],
    },
  },
];

function textResult(body: unknown, image?: Buffer, isError = false): ToolResult {
  const content: ToolContent[] = [{ type: "text", text: JSON.stringify(body, null, 2) }];
  if (image !== undefined) content.push({ type: "image", data: image.toString("base64"), mimeType: "image/png" });
  return { content, isError };
}

function fail(body: string | Record<string, unknown>): ToolResult {
  const obj = typeof body === "string" ? { error: body } : body;
  if (typeof obj.error !== "string") obj.error = "the tool failed.";
  return textResult(obj, undefined, true);
}

function isArgs(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

/** Run one tool. Tool failures are isError results. Unexpected throws are left to the caller. */
export function callTool(roots: Roots, name: string, args: unknown): ToolResult {
  if (LATER.has(name)) return fail(`${name} is not in this server. schem_undo has no restore command yet, and the component catalogue is not included.`);
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) return fail(`unknown tool "${name}".`);
  if (!isArgs(args)) return fail("arguments must be an object.");
  switch (name) {
    case "schem_create": return schemCreate(roots, args);
    case "schem_edit": return schemEdit(roots, args);
    case "schem_check": return schemCheck(roots, args);
    case "schem_preview": return schemPreview(roots, args);
    case "schem_query": return schemQuery(roots, args);
    case "schem_render": return schemRender(roots, args);
    default: return fail(`unknown tool "${name}".`);
  }
}

function loadWithin(roots: Roots, file: string): { ok: true; real: string; project: LoadedProject; warnings: string[] } | { ok: false; message: string } {
  const opened = resolvePath(roots, file, "read");
  if (!opened.ok) return opened;
  let size: number;
  try {
    size = statSync(opened.real).size;
  } catch (e) {
    return { ok: false, message: `cannot read ${showPath(opened.real)}: ${(e as Error).message}` };
  }
  if (size > MAX_FILE) return { ok: false, message: `the file is over 2 MB (${MAX_FILE} bytes).` };
  let text: string;
  try {
    text = readFileSync(opened.real, "utf8");
  } catch (e) {
    return { ok: false, message: `cannot read ${showPath(opened.real)}: ${(e as Error).message}` };
  }
  const loaded = loadProject(text);
  if (!loaded.ok || loaded.project === undefined) {
    const why = loaded.errors.map((e) => `${e.code} ${e.message}`).join(" ");
    return { ok: false, message: why || "the file is not a schem project." };
  }
  const guards = guardProject(loaded.project);
  if (guards.length) return { ok: false, message: guards.join(" ") };
  return { ok: true, real: opened.real, project: loaded.project, warnings: loaded.warnings.map((w) => w.message) };
}

function parseSource(source: unknown): { doc: unknown } | { error: string } {
  if (typeof source === "string") {
    if (Buffer.byteLength(source, "utf8") > MAX_FILE) return { error: `the source is over 2 MB (${MAX_FILE} bytes).` };
    try {
      return { doc: JSON.parse(source) };
    } catch (e) {
      return { error: `the source is not JSON: ${(e as Error).message}` };
    }
  }
  if (typeof source === "object" && source !== null) {
    try {
      const text = JSON.stringify(source);
      if (text === undefined || Buffer.byteLength(text, "utf8") > MAX_FILE) return { error: `the source is over 2 MB (${MAX_FILE} bytes).` };
    } catch {
      return { error: "source must be a JSON string or an object." };
    }
    return { doc: source };
  }
  return { error: "source must be a JSON string or an object." };
}

function schemCreate(roots: Roots, args: Record<string, unknown>): ToolResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const detail = readDetail(args.detail, "normal");
  if (detail === undefined) return fail("detail is brief, normal or full.");
  if (args.source === undefined) return fail("source is missing.");
  const opened = resolvePath(roots, path.path, "create");
  if (!opened.ok) return fail(opened.message);
  const parsed = parseSource(args.source);
  if ("error" in parsed) return fail(parsed.error);
  const count = declaredPartCount(parsed.doc);
  if (count !== undefined && count > MAX_PARTS) return fail(`this circuit has ${count} parts. The limit is ${MAX_PARTS}. Nothing was written.`);
  const pins = rawPinGuard(parsed.doc);
  if (pins !== undefined) return fail(`${pins} Nothing was written.`);
  const loaded = loadProject(parsed.doc);
  if (!loaded.ok || loaded.project === undefined) {
    const why = loaded.errors.map((e) => `${e.code} ${e.message}`).join(" ");
    return fail(why || "the source is not a schem project.");
  }
  if (loaded.project.unknownFields.length) {
    return fail(`this netlist uses fields this engine does not know (${loaded.project.unknownFields.join(", ")}). Nothing was written.`);
  }
  const guards = guardProject(loaded.project);
  if (guards.length) return fail(`${guards.join(" ")} Nothing was written.`);
  const drawn = drawProject(loaded.project);
  if (drawn.result.render === undefined || drawn.result.state === undefined || !drawn.result.status.startsWith("valid")) {
    return fail({
      error: `could not draw this circuit (${drawn.result.status}). Nothing was written.`,
      status: drawn.result.status,
      verified: false,
      issues: [...drawn.result.issues, ...drawn.result.notes],
    });
  }
  let committed: ReturnType<typeof commitDrawing>;
  try {
    committed = commitDrawing(loaded.project, drawn.result.state, "canonical");
  } catch (e) {
    return fail(`${(e as Error).message} Nothing was written.`);
  }
  if (Buffer.byteLength(committed.text, "utf8") > MAX_FILE) return fail(`the saved file would be over 2 MB (${MAX_FILE} bytes). Nothing was written.`);
  try {
    withLock(opened.real, () => exclusiveCreate(opened.real, committed.text));
  } catch (e) {
    return fail((e as Error).message);
  }
  const payload = sheetPayload(loaded.project, drawn, {
    detail, revision: committed.revision, layoutToken: committed.layoutToken,
    warnings: loaded.warnings.map((w) => w.message),
  });
  if (!payload.ok) return fail(payload.message);
  payload.body.saved = true;
  payload.body.path = showPath(opened.real);
  return textResult(payload.body);
}

function schemEdit(roots: Roots, args: Record<string, unknown>): ToolResult {
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
    return fail((e as Error).message);
  }
}

function editLocked(roots: Roots, file: string, script: EditScript, detail: Detail, dryRun: boolean, strict: boolean): ToolResult {
  const loaded = loadWithin(roots, file);
  if (!loaded.ok) return fail(loaded.message);
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

  let committed: ReturnType<typeof commitDrawing>;
  try {
    committed = commitDrawing(edited, state, result.mode ?? "canonical");
  } catch (e) {
    return fail(`${(e as Error).message} Nothing was written.`);
  }
  if (Buffer.byteLength(committed.text, "utf8") > MAX_FILE) return fail(`the saved file would be over 2 MB (${MAX_FILE} bytes). Nothing was written.`);
  if (!dryRun) {
    snapshot(file);
    replaceFile(file, committed.text);
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
  return textResult(payload.body);
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

function schemCheck(roots: Roots, args: Record<string, unknown>): ToolResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const detail = readDetail(args.detail, "normal");
  if (detail === undefined) return fail("detail is brief, normal or full.");
  const cursor = args.cursor === undefined ? undefined : args.cursor;
  if (cursor !== undefined && typeof cursor !== "string") return fail("cursor must be a string.");
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return fail(loaded.message);
  const drawn = drawProject(loaded.project);
  if (drawn.result.render === undefined) {
    return fail({ error: `could not draw this circuit (${drawn.result.status}).`, status: drawn.result.status, verified: false, issues: [...drawn.result.issues, ...drawn.result.notes] });
  }
  const payload = sheetPayload(loaded.project, drawn, { detail, ...(typeof cursor === "string" ? { cursor } : {}), warnings: loaded.warnings });
  if (!payload.ok) return fail(payload.message);
  payload.body.path = showPath(loaded.real);
  return textResult(payload.body);
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

function schemPreview(roots: Roots, args: Record<string, unknown>): ToolResult {
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
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return fail(loaded.message);
  const drawn = drawProject(loaded.project);
  const render = drawn.result.render;
  if (render === undefined || drawn.result.state === undefined) {
    return fail({ error: `could not draw this circuit (${drawn.result.status}).`, status: drawn.result.status, verified: false });
  }
  if (focus !== undefined) {
    const missing = focus.filter((id) => !loaded.project.circuit.parts.some((p) => p.id === id));
    if (missing.length) return fail(`no part ${missing.join(", ")}.`);
  }
  const crop = focus === undefined ? undefined : focusBox(render, focus);
  if (focus !== undefined && crop === undefined) return fail("those parts have no drawn box to crop.");
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
  if (note !== undefined) payload.body.note = payload.body.note === undefined ? note : `${payload.body.note} ${note}`;
  return textResult(payload.body, image.png);
}

function schemQuery(roots: Roots, args: Record<string, unknown>): ToolResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  if (args.part !== undefined && typeof args.part !== "string") return fail("part must be a string.");
  if (args.net !== undefined && typeof args.net !== "string") return fail("net must be a string.");
  if (args.cursor !== undefined && typeof args.cursor !== "string") return fail("cursor must be a string.");
  if (typeof args.part === "string" && typeof args.net === "string") return fail("pass part or net, not both.");
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return fail(loaded.message);
  const drawn = drawProject(loaded.project);
  const body = queryBody(loaded.project, drawn, {
    ...(typeof args.part === "string" ? { part: args.part } : {}),
    ...(typeof args.net === "string" ? { net: args.net } : {}),
    ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
  });
  if (!body.ok) return fail(body.message);
  body.body.path = showPath(loaded.real);
  return textResult(body.body);
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

function schemRender(roots: Roots, args: Record<string, unknown>): ToolResult {
  const path = pathOf(args.path, "path");
  if (!path.ok) return fail(path.message);
  const out = pathOf(args.out, "out");
  if (!out.ok) return fail(out.message);
  if (args.format !== "svg" && args.format !== "png") return fail("format is svg or png.");
  if (args.format === "svg" && (args.scale !== undefined || args.dpi !== undefined)) return fail("scale and dpi are for png. svg is vector.");
  const scale = readScale(args);
  if (!scale.ok) return fail(scale.message);
  const overwrite = flag(args.overwrite, "overwrite");
  if (!overwrite.ok) return fail(overwrite.message);
  const loaded = loadWithin(roots, path.path);
  if (!loaded.ok) return fail(loaded.message);
  const dest = resolvePath(roots, out.path, overwrite.value ? "overwrite" : "create");
  if (!dest.ok) return fail(dest.message);
  const drawn = drawProject(loaded.project);
  const render = drawn.result.render;
  if (render === undefined || drawn.result.state === undefined) {
    return fail({ error: `could not draw this circuit (${drawn.result.status}). Nothing was written.`, status: drawn.result.status, verified: false });
  }
  const payload = sheetPayload(loaded.project, drawn, { detail: "brief" });
  if (!payload.ok) return fail(payload.message);
  try {
    if (args.format === "svg") {
      const svg = toSvg(render);
      withLock(dest.real, () => writeOut(dest.real, svg, overwrite.value));
      payload.body.format = "svg";
      payload.body.out = showPath(dest.real);
      payload.body.bytes = Buffer.byteLength(svg, "utf8");
      payload.body.grid = [render.bounds.w, render.bounds.h];
      return textResult(payload.body);
    }
    const image = renderPng(render, scale.px);
    if (!image.ok) return fail(image.message);
    withLock(dest.real, () => writeOut(dest.real, image.png, overwrite.value));
    payload.body.format = "png";
    payload.body.out = showPath(dest.real);
    payload.body.bytes = image.png.length;
    payload.body.png = { width: image.width, height: image.height, pxPerGrid: round3(image.pxPerGrid), ...(scale.dpi !== undefined ? { dpi: scale.dpi } : {}) };
    return textResult(payload.body);
  } catch (e) {
    return fail((e as Error).message);
  }
}

function writeOut(file: string, data: string | Buffer, overwrite: boolean): void {
  if (overwrite) {
    try {
      statSync(file);
      replaceFile(file, data);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  exclusiveCreate(file, data);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
