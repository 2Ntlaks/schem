// Shared project input and persistence for the CLI and the MCP server.
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { compileDsl } from "../core/dsl.js";
import { formatDsl } from "../core/dsl-format.js";
import type { LayoutState } from "../core/intent.js";
import type { Issue, Net } from "../core/model.js";
import { layoutToken, revision } from "../edit/edit.js";
import { fromLayoutCache, toLayoutCache } from "../io/layout-cache.js";
import { loadProject, projectDocument, type LoadedProject, type LoadResult } from "../io/project.js";
import { resolvePath, showPath, type Roots } from "./roots.js";
import { commitDrawing, declaredPartCount, guardProject, MAX_FILE, MAX_PARTS, rawPinGuard } from "./sheet.js";

export type ProjectFormat = "dsl" | "json";
export type Failure = { ok: false; message: string; issues?: Issue[] };
const CACHE_PREFIX = "# schem-layout: ";

export function formatOf(path: string): ProjectFormat {
  return extname(path).toLowerCase() === ".schem" ? "dsl" : "json";
}

export function issueText(issue: Issue): string {
  const sourceSpan = "span" in issue && issue.at ? ` ${issue.at}` : "";
  return `${issue.code}${sourceSpan} ${issue.message}`;
}

export function projectText(text: string, format: ProjectFormat): LoadResult {
  if (format === "json") return loadProject(text.replace(/^\uFEFF/, ""));
  const loaded = compileDsl(text);
  if (!loaded.project) return loaded;
  const last = text.trimEnd().split(/\r?\n/).at(-1);
  if (last?.startsWith(CACHE_PREFIX)) {
    try { loaded.project.layoutCache = JSON.parse(last.slice(CACHE_PREFIX.length)); }
    catch { loaded.project.layoutCache = null; }
  }
  return loaded;
}

export function readWithin(roots: Roots, path: string): { ok: true; real: string; text: string } | Failure {
  const opened = resolvePath(roots, path, "read");
  if (!opened.ok) return opened;
  try {
    if (statSync(opened.real).size > MAX_FILE) return { ok: false, message: `the file is over 2 MB (${MAX_FILE} bytes).` };
    const text = readFileSync(opened.real, "utf8");
    if (Buffer.byteLength(text) > MAX_FILE) return { ok: false, message: `the file is over 2 MB (${MAX_FILE} bytes).` };
    return { ok: true, real: opened.real, text };
  } catch (error) {
    return { ok: false, message: `cannot read ${showPath(opened.real)}: ${(error as Error).message}` };
  }
}

export interface OpenProject {
  ok: true;
  project: LoadedProject;
  warnings: string[];
}

export function guardedProject(loaded: LoadResult): OpenProject | Failure {
  if (!loaded.project) return {
    ok: false,
    message: loaded.errors.map(issueText).join(" ") || "the source is not a schem project.",
    issues: loaded.errors,
  };
  const guards = guardProject(loaded.project);
  if (guards.length) return { ok: false, message: guards.join(" ") };
  return { ok: true, project: loaded.project, warnings: loaded.warnings.map((w) => "span" in w ? issueText(w) : w.message) };
}

export function loadWithin(roots: Roots, path: string): (OpenProject & { real: string; format: ProjectFormat; source: string }) | Failure {
  const opened = readWithin(roots, path);
  if (!opened.ok) return opened;
  const format = formatOf(path);
  const guarded = guardedProject(projectText(opened.text, format));
  if (!guarded.ok) return guarded;
  return { ...guarded, real: opened.real, format, source: opened.text };
}

export function loadSource(source: unknown): OpenProject | Failure {
  let doc: unknown = source;
  if (typeof source === "string") {
    if (Buffer.byteLength(source) > MAX_FILE) return { ok: false, message: `the source is over 2 MB (${MAX_FILE} bytes).` };
    const text = source.replace(/^\uFEFF/, "");
    try { doc = JSON.parse(text); }
    catch {
      const format = /^\s*[\[{]/.test(text) ? "json" : "dsl";
      return guardedProject(projectText(text, format));
    }
  } else if (typeof source === "object" && source !== null) {
    try {
      if (Buffer.byteLength(JSON.stringify(source)) > MAX_FILE)
        return { ok: false, message: `the source is over 2 MB (${MAX_FILE} bytes).` };
    } catch { return { ok: false, message: "source must be text or a JSON object." }; }
  } else {
    return { ok: false, message: "source must be text or a JSON object." };
  }
  const count = declaredPartCount(doc);
  if (count !== undefined && count > MAX_PARTS) return { ok: false, message: `this circuit has ${count} parts. The limit is ${MAX_PARTS}. Nothing was written.` };
  const pins = rawPinGuard(doc);
  if (pins !== undefined) return { ok: false, message: `${pins} Nothing was written.` };
  return guardedProject(loadProject(doc));
}

function netKeys(project: LoadedProject): Map<string, string> {
  const { nets } = projectDocument(project).circuit as { nets: Net[] };
  return new Map(nets.map((net) => [JSON.stringify(net.endpoints), net.id]));
}

export function withLayoutComment(source: string, cache: unknown): string {
  return cache === undefined ? source : `${source}${CACHE_PREFIX}${JSON.stringify(cache)}\n`;
}

export function commitProject(project: LoadedProject, state: LayoutState, mode: string, format: ProjectFormat): ReturnType<typeof commitDrawing> {
  if (format === "json") return commitDrawing(project, state, mode);
  const { layoutCache: _old, ...semantic } = project;
  const formatted = formatDsl(semantic);
  if (!formatted.ok) throw new Error(`DSL cannot represent: ${formatted.fields.join(", ")}.`);
  const compiled = compileDsl(formatted.source);
  if (!compiled.project) throw new Error(compiled.errors.map(issueText).join(" ") || "the text could not be read back.");
  const ids = netKeys(compiled.project);
  const routes: LayoutState["routes"] = {};
  for (const [key, oldId] of netKeys(project)) {
    const newId = ids.get(key);
    if (newId !== undefined && state.routes[oldId] !== undefined) routes[newId] = state.routes[oldId];
  }
  const basis = revision(compiled.project);
  const cache = toLayoutCache({ ...state, routes }, basis, mode);
  const back = fromLayoutCache(cache, basis).state;
  if (back === undefined) throw new Error("the layout just written could not be read back.");
  return {
    text: withLayoutComment(formatted.source, cache),
    revision: basis,
    layoutToken: layoutToken(compiled.project, back),
  };
}
