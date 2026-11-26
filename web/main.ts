// The playground page: a circuit file (.schem or JSON) on the left, the verified drawing on the
// right. The engine runs in a Web Worker (web/worker.ts); this file is the editor, the drawing
// view, the title block, the parts panel, share links and downloads. Nothing leaves the browser:
// a share link carries the circuit itself, compressed, after the #.

import { EXAMPLES } from "virtual:examples";
import type { CircuitFormat, ConvertResult, DrawResult, PartType, Problem, TidyResult } from "./core.js";
import { detectFormat, escHtml, highlightDslLine, highlightJson } from "./highlight.js";
import { pack, unpack } from "./share.js";
import { isJsonObj, tidyJson, type Json } from "./tidy-json.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const src = $<HTMLTextAreaElement>("src");
const hl = $("hl"), gutter = $("gutter"), hlPre = hl.parentElement!;
const desk = document.querySelector<HTMLElement>(".desk")!;
const viewport = $("viewport"), stage = $("stage"), sheet = $("sheet");
const stamp = $("stamp"), tbTitle = $("tb-title"), tbStats = $("tb-stats"), tbMs = $("tb-ms"), problemsEl = $<HTMLOListElement>("problems");
const fileNameEl = $("file-name"), convertBtn = $<HTMLButtonElement>("convert-btn"), tidyBtn = $<HTMLButtonElement>("tidy-btn");

const DRAFT_KEY = "schem-playground-draft";
const DEFAULT_EXAMPLE = "summing-amp.schem.json";

// ---------------------------------------------------------------------------------------------
// The editor: a transparent textarea over a highlighted copy, with line numbers.

function syncFormatUi(fmt: CircuitFormat): void {
  fileNameEl.dataset.format = fmt;
  convertBtn.textContent = fmt === "json" ? "To .schem" : "To JSON";
  convertBtn.title = fmt === "json" ? "Convert this JSON circuit to .schem text" : "Convert this .schem circuit to JSON";
  tidyBtn.title = fmt === "json" ? "One part and one net per line" : "Format .schem statements";
  src.setAttribute("aria-label", fmt === "json" ? "Circuit file, JSON" : "Circuit file, .schem");
}

function renameFileForFormat(fmt: CircuitFormat): void {
  const cur = fileNameEl.textContent ?? "circuit.schem.json";
  if (fmt === "dsl") {
    fileNameEl.textContent = cur.replace(/\.schem\.json$|\.json$/, ".schem");
    if (!fileNameEl.textContent.endsWith(".schem")) fileNameEl.textContent = `${cur}.schem`;
  } else {
    fileNameEl.textContent = cur.replace(/\.schem$/, ".schem.json");
    if (!fileNameEl.textContent.endsWith(".json")) fileNameEl.textContent = `${cur}.schem.json`;
  }
}

let errorLine = 0, addedLine = 0;
function paint(): void {
  const fmt = detectFormat(src.value);
  syncFormatUi(fmt);
  const highlightLine = fmt === "json" ? highlightJson : highlightDslLine;
  const lines = src.value.split("\n");
  // Long lines wrap; the highlighted copy must wrap at the same width, so it stops where the
  // textarea's scrollbar starts, and each line number takes its line's wrapped height.
  hlPre.style.right = `${src.offsetWidth - src.clientWidth}px`;
  hl.innerHTML = lines.map((l, i) => `<span class="line${i + 1 === errorLine ? " err" : ""}${i + 1 === addedLine ? " added" : ""}">${highlightLine(l) || " "}</span>`).join("");
  const rows = [...hl.children] as HTMLElement[];
  gutter.innerHTML = lines.map((_, i) => `<div${i + 1 === errorLine ? ' class="err"' : ""} style="height:${rows[i]?.offsetHeight ?? 20}px">${i + 1}</div>`).join("");
  syncScroll();
}
window.addEventListener("resize", () => paint());
function syncScroll(): void {
  hlPre.style.transform = `translate(${-src.scrollLeft}px, ${-src.scrollTop}px)`;
  gutter.style.transform = `translateY(${-src.scrollTop}px)`;
}
src.addEventListener("scroll", syncScroll);

function setText(text: string, drawNow = true): void {
  src.value = text;
  errorLine = 0;
  paint();
  src.scrollTop = 0;
  if (drawNow) request(true);
}

/** Put the caret at a line and column and bring it into view. */
function goTo(line: number, column = 1): void {
  const lines = src.value.split("\n");
  const offset = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0) + column - 1;
  showView("code");
  src.focus();
  src.setSelectionRange(offset, offset);
  const row = hl.children[line - 1] as HTMLElement | undefined;
  src.scrollTop = Math.max(0, (row?.offsetTop ?? 0) - 3 * parseFloat(getComputedStyle(src).lineHeight));
}

src.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    src.setRangeText("  ", src.selectionStart, src.selectionEnd, "end");
    onEdit();
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    request(true);
  }
});
src.addEventListener("input", onEdit);

let typingTimer = 0;
function onEdit(): void {
  dismissCoach();
  paint();
  saveDraft();
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => request(false), 380);
}

function saveDraft(): void {
  try { localStorage.setItem(DRAFT_KEY, src.value); } catch { /* storage may be off; drafts are a convenience */ }
}
function loadDraft(): string | null {
  try { return localStorage.getItem(DRAFT_KEY); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// The engine worker. One drawing at a time; the newest text waits while one is running.

const worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
let ready = false, busy = false, pending: string | null = null, seq = 0, opSeq = 0;
let lastSvg = "", lastTitle = "", lastProblems: Problem[] = [];
let catalog: PartType[] = [];
let fitNext = true;

function request(refit: boolean): void {
  if (refit) fitNext = true;
  pending = src.value;
  pump();
}
function pump(): void {
  if (!ready || busy || pending === null) return;
  busy = true;
  setStamp("busy", "Drawing");
  worker.postMessage({ type: "draw", id: ++seq, text: pending });
  pending = null;
}

type WorkerMessage =
  | { type: "ready"; catalog: PartType[] }
  | { type: "drawn"; id: number; result: DrawResult }
  | { type: "tidied"; id: number; result: TidyResult }
  | { type: "converted"; id: number; to: CircuitFormat; purpose: "edit" | "download"; result: ConvertResult }
  | { type: "failed"; message: string };

function showConversionFailure(to: CircuitFormat, result: ConvertResult): void {
  if (result.lostFields?.length) {
    const fields = result.lostFields.join(", ");
    toast(`Cannot convert to ${to === "dsl" ? ".schem" : "JSON"}: unsupported fields (${fields}).`);
    const notice: Problem = {
      kind: "note",
      text: `Could not convert to ${to === "dsl" ? ".schem" : "JSON"} because these fields have no ${to === "dsl" ? "text" : "JSON"} form: ${fields}.`,
    };
    renderProblems([notice, ...lastProblems]);
    return;
  }
  toast(result.error ?? "Fix the circuit file before converting.");
  request(false);
}

worker.onmessage = (e: MessageEvent) => {
  const m = e.data as WorkerMessage;
  if (m.type === "ready") {
    ready = true;
    catalog = m.catalog;
    renderParts("");
    pump();
  } else if (m.type === "failed") {
    setStamp("error", "Not started");
    tbTitle.textContent = "The engine could not start";
    tbStats.textContent = m.message;
  } else if (m.type === "drawn") {
    busy = false;
    if (pending === null) show(m.result);
    pump();
  } else if (m.type === "tidied") {
    if (m.id !== opSeq) return;
    if (m.result.ok && m.result.text !== undefined) {
      setText(m.result.text, false);
      saveDraft();
    } else {
      toast(m.result.error ?? "Tidy needs a valid circuit file. The title block points at the problem.");
      request(false);
    }
  } else if (m.type === "converted") {
    if (m.id !== opSeq) return;
    if (m.purpose === "download") {
      if (m.result.ok && m.result.text !== undefined) {
        if (m.to === "dsl") save(new Blob([m.result.text], { type: "text/plain;charset=utf-8" }), `${baseName()}.schem`);
        else save(new Blob([m.result.text], { type: "application/json" }), `${baseName()}.schem.json`);
      } else {
        showConversionFailure(m.to, m.result);
      }
      return;
    }
    if (m.result.ok && m.result.text !== undefined) {
      renameFileForFormat(m.to);
      setText(m.result.text, false);
      saveDraft();
      request(false);
      toast(m.to === "dsl" ? "Converted to .schem text." : "Converted to JSON.");
    } else {
      showConversionFailure(m.to, m.result);
    }
  }
};
worker.onerror = () => {
  busy = false;
  setStamp("error", "Stopped");
  tbStats.textContent = "The engine stopped unexpectedly. Reload the page to try again.";
};

// ---------------------------------------------------------------------------------------------
// Showing a result: the sheet, the title block, the problem list.

function setStamp(verdict: string, text: string): void {
  stamp.dataset.verdict = verdict;
  stamp.textContent = text;
  $("tab-dot").dataset.verdict = verdict;
}

function show(r: DrawResult): void {
  const counts = r.stats ? `${r.stats.parts} parts, ${r.stats.nets} nets` : "";
  tbMs.textContent = r.ms ? `${r.ms} ms` : "";
  if (r.svg) {
    lastSvg = r.svg;
    lastTitle = r.title ?? "";
    sheet.innerHTML = r.svg;
    sheet.classList.remove("stale", "fresh");
    void sheet.offsetWidth;
    sheet.classList.add("fresh");
    sizeSheet();
  } else if (lastSvg) {
    sheet.classList.add("stale");
  }
  tbTitle.textContent = r.title ?? (r.svg ? "Untitled circuit" : lastTitle || "Untitled circuit");
  if (r.verdict === "valid") {
    setStamp("valid", "Verified");
    tbStats.textContent = `Every connection checked against the netlist. ${r.stats!.overlaps} overlaps. ${counts}.`;
  } else if (r.verdict === "problems") {
    const onlyLayout = r.problems.every((p) => p.kind === "layout" || p.kind === "note" || p.kind === "warning");
    setStamp("problems", "See notes");
    tbStats.textContent = onlyLayout
      ? `Every connection checked, but the layout is unsure of part of it. ${counts}.`
      : `Drawn, but the checks found problems. ${counts}.`;
  } else {
    setStamp("error", "Not drawn");
    tbStats.textContent = lastSvg ? "Showing the last drawing that worked." : "Fix the circuit file to see a drawing.";
  }
  stamp.classList.remove("thud");
  void stamp.offsetWidth;
  stamp.classList.add("thud");

  lastProblems = r.problems;
  const locatedErr = r.problems.find((p) => p.kind === "error" && p.line) ?? r.problems.find((p) => p.line);
  errorLine = locatedErr?.line ?? 0;
  paint();
  renderProblems(r.problems);
  // Fit last, once the title block has its final height.
  if (r.svg && fitNext) { fit(); fitNext = false; }
}

function renderProblems(list: Problem[]): void {
  problemsEl.replaceChildren(...list.map((p) => {
    const li = document.createElement("li");
    const kind = document.createElement("span");
    kind.className = `kind k-${p.kind}`;
    kind.textContent = p.kind;
    li.append(kind, p.text);
    if (p.line) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "show me";
      b.addEventListener("click", () => goTo(p.line!, p.column));
      li.append(" ", b);
    }
    return li;
  }));
}

// ---------------------------------------------------------------------------------------------
// Pan and zoom. The SVG is sized in grid units (10 user units = 0.1 inch); 1 user unit = 1 px at 100%.

const view = { k: 1, x: 0, y: 0 };
function sizeSheet(): void {
  const svg = sheet.querySelector("svg");
  if (!svg) return;
  const vb = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
  svg.setAttribute("width", String(vb[2]));
  svg.setAttribute("height", String(vb[3]));
}
function apply(): void {
  stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
}
function fit(): void {
  const r = viewport.getBoundingClientRect();
  const w = sheet.offsetWidth, h = sheet.offsetHeight;
  if (!w || !h || !r.width) return;
  const tb = $("titleblock").getBoundingClientRect();
  if (r.width < 760) {
    // Phone: as wide as the screen allows, near the top, under the zoom buttons.
    const top = 56, availH = tb.top - r.top - top - 12;
    view.k = Math.max(0.15, Math.min(2.2, (r.width - 16) / w, availH / h));
    view.x = (r.width - w * view.k) / 2;
    view.y = top;
  } else {
    // Wide: the sheet sits above the title block with their right edges in line, as a title
    // block sits in the corner of a drawing sheet.
    const right = tb.right - r.left, availH = tb.top - r.top - 36;
    view.k = Math.max(0.15, Math.min(2.2, (right - 32) / w, availH / h));
    view.x = right - w * view.k;
    view.y = 24 + Math.max(0, (availH - h * view.k) / 2);
  }
  apply();
}
function zoomAt(factor: number, cx: number, cy: number): void {
  const k = Math.max(0.12, Math.min(6, view.k * factor));
  view.x = cx - ((cx - view.x) * k) / view.k;
  view.y = cy - ((cy - view.y) * k) / view.k;
  view.k = k;
  apply();
}
viewport.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
viewport.addEventListener("pointerdown", (e) => {
  viewport.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  viewport.classList.add("panning");
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y); }
});
viewport.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y), r = viewport.getBoundingClientRect();
    if (pinch) zoomAt(d / pinch, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
    pinch = d;
  } else {
    view.x += e.clientX - prev.x;
    view.y += e.clientY - prev.y;
    apply();
  }
});
const release = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; if (!pointers.size) viewport.classList.remove("panning"); };
viewport.addEventListener("pointerup", release);
viewport.addEventListener("pointercancel", release);
viewport.addEventListener("dblclick", fit);
$("zoom-in").addEventListener("click", () => { const r = viewport.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); });
$("zoom-out").addEventListener("click", () => { const r = viewport.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); });
$("zoom-fit").addEventListener("click", fit);
window.addEventListener("resize", () => fit());

// ---------------------------------------------------------------------------------------------
// Parts: every symbol with its own artwork, the generic boxes, and the boards. A click adds one.

const DEFAULT_PROPS: Record<string, Record<string, string>> = {
  resistor: { value: "10k" }, capacitor: { value: "100n" }, "polarised-capacitor": { value: "10u" }, inductor: { value: "10u" }, battery: { value: "9V" },
  vsource: { value: "5V" }, "ac-source": { value: "1V" }, led: { color: "red" }, fuse: { value: "1A" }, zener: { value: "5.1V" }, crystal: { value: "16MHz" }, potentiometer: { value: "10k" },
};
interface BoxPin { number: string; name: string; role?: string }
const BOX_PINS: Record<string, BoxPin[]> = {
  ic: [{ number: "1", name: "VCC", role: "power_in" }, { number: "2", name: "GND", role: "ground" }, { number: "3", name: "IN", role: "input" }, { number: "4", name: "OUT", role: "output" }],
  header: [{ number: "1", name: "1" }, { number: "2", name: "2" }, { number: "3", name: "3" }],
};

function partTile(p: PartType): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "part";
  const pins = p.kind === "box" ? "you choose its pins" : p.pins.length > 6 ? `${p.pins.length} pins` : p.pins.map((q) => q.name).join(", ");
  const art = p.art
    ? `<svg viewBox="${p.art.viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${p.art.paths.map((q) => `<path d="${escHtml(q.d)}"${q.fill ? ' class="fill"' : ""}/>`).join("")}</svg>`
    : `<div class="box" aria-hidden="true"><span></span></div>`;
  b.innerHTML = `${art}<span class="name">${escHtml(p.type).replace(/[-:]/g, "$&<wbr>")}</span><span class="pins">${escHtml(p.name ? `${p.name}. ` : "")}${escHtml(pins)}</span>`;
  b.title = p.pins.length ? `Pins: ${p.pins.map((q) => (q.name !== q.number ? `${q.number} (${q.name})` : q.number)).join(", ")}` : p.name ?? p.type;
  b.addEventListener("click", () => addPart(p));
  return b;
}

function renderParts(query: string): void {
  const q = query.trim().toLowerCase();
  const hit = (p: PartType) => !q || p.type.includes(q) || (p.name ?? "").toLowerCase().includes(q) || p.pins.some((x) => x.name.toLowerCase() === q);
  const groups: Array<[string, PartType[]]> = [
    ["Symbols", catalog.filter((p) => p.kind === "symbol" && hit(p))],
    ["Chips and connectors", catalog.filter((p) => p.kind === "box" && hit(p))],
    ["Boards", catalog.filter((p) => p.kind === "board" && hit(p))],
  ];
  const list = $("parts-list");
  list.replaceChildren(...groups.filter(([, ps]) => ps.length).flatMap(([title, ps]) => {
    const h = document.createElement("h3");
    h.textContent = title;
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...ps.map(partTile));
    return [h, grid];
  }));
  if (!list.childElementCount) list.textContent = "No part matches. The README's contributing section says how to add one.";
}

function dslVal(value: string): string {
  return /^[A-Za-z0-9_+.-]+$/.test(value) ? value : `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function dslPartLine(id: string, p: PartType): string {
  const tokens = ["part", id, p.type];
  const props = DEFAULT_PROPS[p.type];
  if (props?.value !== undefined) tokens.push(dslVal(props.value));
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k !== "value") tokens.push(`${k}=${dslVal(v)}`);
    }
  }
  if (p.kind === "box") {
    tokens.push(`label=${p.type === "ic" ? "CHIP" : "CONN"}`);
    const pins = BOX_PINS[p.type] ?? [];
    if (pins.length) {
      tokens.push("pins:");
      for (const pin of pins) {
        const role = pin.role ?? (p.type === "header" ? "passive" : undefined);
        tokens.push(`${pin.number}:${pin.name}${role ? `/${role}` : ""}`);
      }
    }
  }
  return tokens.join(" ");
}

function addPartDsl(p: PartType): void {
  const lines = src.value.replace(/\r\n/g, "\n").split("\n");
  const used = new Set<string>();
  let lastPartIdx = -1, lastHeadIdx = -1;
  lines.forEach((line, idx) => {
    const m = /^\s*part\s+([A-Za-z][A-Za-z0-9_]*)\b/.exec(line);
    if (m) { used.add(m[1]!); lastPartIdx = idx; }
    else if (/^\s*(?:circuit|style)\b/.test(line)) lastHeadIdx = idx;
  });
  let n = 1;
  while (used.has(`${p.prefix}${n}`)) n++;
  const id = `${p.prefix}${n}`;
  const decl = dslPartLine(id, p);

  let insertAt: number;
  if (lastPartIdx !== -1) {
    insertAt = lastPartIdx + 1;
    lines.splice(insertAt, 0, decl);
  } else if (lastHeadIdx !== -1) {
    insertAt = lastHeadIdx + 1;
    lines.splice(insertAt, 0, "", decl);
    insertAt++;
  } else if (lines.length === 1 && !lines[0]!.trim()) {
    lines[0] = decl;
    insertAt = 0;
  } else if (lines.at(-1) === "") {
    insertAt = lines.length - 1;
    lines.splice(insertAt, 0, decl);
  } else {
    insertAt = lines.length;
    lines.push(decl);
  }

  const next = lines.join("\n");
  setText(next.endsWith("\n") ? next : `${next}\n`, false);
  const lineNum = insertAt + 1;
  toggleParts(false);
  addedLine = lineNum;
  paint();
  goTo(lineNum, (src.value.split("\n")[lineNum - 1] ?? "").indexOf(id) + 1);
  setTimeout(() => { addedLine = 0; }, 1700);
  saveDraft();
  dismissCoach();
  request(true);
  const samplePin = p.pins[0]?.name ?? "1";
  toast(`Added ${id}. Connect it with "connect ${id}.${samplePin} ..." or a net line.`);
}

function addPart(p: PartType): void {
  if (detectFormat(src.value) === "dsl") { addPartDsl(p); return; }
  let doc: { [k: string]: Json };
  try {
    doc = JSON.parse(src.value) as { [k: string]: Json };
    if (!isJsonObj(doc) || !isJsonObj(doc.circuit) || !Array.isArray(doc.circuit.parts)) throw new Error();
  } catch {
    toast("Fix the circuit file first: it must be valid JSON with circuit.parts.");
    return;
  }
  const parts = (doc.circuit as { [k: string]: Json }).parts as Json[];
  const used = new Set(parts.map((x) => (isJsonObj(x) ? String(x.id) : "")));
  let n = 1;
  while (used.has(`${p.prefix}${n}`)) n++;
  const id = `${p.prefix}${n}`;
  const part: { [k: string]: Json } = { id, type: p.type };
  if (DEFAULT_PROPS[p.type]) part.props = DEFAULT_PROPS[p.type]!;
  if (p.kind === "box") { part.props = { label: p.type === "ic" ? "CHIP" : "CONN" }; part.pins = BOX_PINS[p.type]! as unknown as Json[]; }
  parts.push(part);
  setText(tidyJson(doc), false);
  const line = src.value.split("\n").findIndex((l) => l.includes(`"id": "${id}"`)) + 1;
  toggleParts(false);
  if (line) {
    addedLine = line;
    paint();
    goTo(line, src.value.split("\n")[line - 1]!.indexOf(id) + 1);
    setTimeout(() => { addedLine = 0; }, 1700);
  }
  saveDraft();
  dismissCoach();
  request(true);
  toast(`Added ${id}. Connect it by adding its pins to a net, like "${id}[${p.pins[0]?.number ?? "1"}]".`);
}

const partsPanel = $("parts"), partsBtn = $("parts-btn");
function toggleParts(open = partsPanel.hidden): void {
  partsPanel.hidden = !open;
  partsBtn.setAttribute("aria-expanded", String(open));
  if (open) { showView("code"); $<HTMLInputElement>("parts-q").focus(); }
}
partsBtn.addEventListener("click", () => toggleParts());
$("parts-close").addEventListener("click", () => toggleParts(false));
$<HTMLInputElement>("parts-q").addEventListener("input", (e) => renderParts((e.target as HTMLInputElement).value));

// ---------------------------------------------------------------------------------------------
// Examples, share links, downloads, the narrow-screen tabs, toasts.

function exampleTitle(file: string, text: string): string {
  if (file.endsWith(".schem")) {
    const m = /^\s*circuit\s+"((?:[^"\\]|\\.)*)"/m.exec(text);
    const title = m ? m[1]!.replace(/\\(["\\])/g, "$1") : file;
    return `${title} (.schem)`;
  }
  try { return (JSON.parse(text) as { meta?: { title?: string } }).meta?.title ?? file; } catch { return file; }
}

const select = $<HTMLSelectElement>("examples");
for (const [file, text] of EXAMPLES) {
  const o = document.createElement("option");
  o.value = file;
  o.textContent = exampleTitle(file, text);
  select.append(o);
}
function exampleText(file: string): string {
  const text = EXAMPLES.find(([f]) => f === file)![1];
  if (file.endsWith(".schem")) return text;
  return tidyJson(JSON.parse(text) as { [k: string]: Json });
}
select.addEventListener("change", () => {
  if (!select.value) return;
  dismissCoach();
  setText(exampleText(select.value));
  fileNameEl.textContent = select.value;
  saveDraft();
  select.value = "";
});

async function share(): Promise<void> {
  try {
    const url = `${location.origin}${location.pathname}#c=${await pack(src.value)}`;
    history.replaceState(null, "", url);
    await navigator.clipboard.writeText(url);
    toast("Link copied. It carries the whole circuit; nothing is stored anywhere.");
  } catch {
    toast("The link is in the address bar; copy it from there.");
  }
}
$("share-btn").addEventListener("click", () => void share());

const dlBtn = $("dl-btn"), dlMenu = $("dl-menu");
const closeMenu = () => { dlMenu.hidden = true; dlBtn.setAttribute("aria-expanded", "false"); };
dlBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = dlMenu.hidden;
  dlMenu.hidden = !open;
  dlBtn.setAttribute("aria-expanded", String(open));
  if (open) (dlMenu.querySelector("button") as HTMLButtonElement).focus();
});
document.addEventListener("click", closeMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); if (!partsPanel.hidden) toggleParts(false); } });

function baseName(): string {
  return (lastTitle || "circuit").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "circuit";
}
function save(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
dlMenu.addEventListener("click", async (e) => {
  const kind = (e.target as HTMLElement).dataset.dl;
  if (!kind) return;
  closeMenu();
  if (kind === "share") return share();
  if (kind === "schem") {
    if (detectFormat(src.value) === "dsl") return save(new Blob([src.value], { type: "text/plain;charset=utf-8" }), `${baseName()}.schem`);
    if (!ready) return toast("Wait a moment for the engine to finish starting.");
    worker.postMessage({ type: "convert", id: ++opSeq, text: src.value, to: "dsl", purpose: "download" });
    return;
  }
  if (kind === "json") {
    if (detectFormat(src.value) === "json") return save(new Blob([src.value], { type: "application/json" }), `${baseName()}.schem.json`);
    if (!ready) return toast("Wait a moment for the engine to finish starting.");
    worker.postMessage({ type: "convert", id: ++opSeq, text: src.value, to: "json", purpose: "download" });
    return;
  }
  if (!lastSvg) return toast("There is no drawing yet.");
  if (kind === "svg") return save(new Blob([lastSvg], { type: "image/svg+xml" }), `${baseName()}.svg`);
  // PNG: the browser rasterises the SVG (its text is already outlined) at 2 px per unit, on white.
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([lastSvg], { type: "image/svg+xml" }));
  await img.decode();
  const vb = (/viewBox="([^"]+)"/.exec(lastSvg)?.[1] ?? "0 0 100 100").split(/\s+/).map(Number);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vb[2]! * 2);
  canvas.height = Math.round(vb[3]! * 2);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  canvas.toBlob((b) => b && save(b, `${baseName()}.png`), "image/png");
});

function showView(v: "code" | "sheet"): void {
  desk.dataset.view = v;
  $("tab-code").setAttribute("aria-selected", String(v === "code"));
  $("tab-sheet").setAttribute("aria-selected", String(v === "sheet"));
  if (v === "sheet") requestAnimationFrame(() => fit());
}
$("tab-code").addEventListener("click", () => showView("code"));
$("tab-sheet").addEventListener("click", () => showView("sheet"));

convertBtn.addEventListener("click", () => {
  if (!ready) { toast("Wait a moment for the engine to finish starting."); return; }
  const to: CircuitFormat = detectFormat(src.value) === "json" ? "dsl" : "json";
  worker.postMessage({ type: "convert", id: ++opSeq, text: src.value, to, purpose: "edit" });
});

tidyBtn.addEventListener("click", () => {
  if (!ready) { toast("Wait a moment for the engine to finish starting."); return; }
  worker.postMessage({ type: "tidy", id: ++opSeq, text: src.value });
});

// First visit: one line saying what to do, until the visitor does something.
const SEEN_KEY = "schem-playground-seen";
const coach = $("coach");
function dismissCoach(): void {
  if (coach.hidden) return;
  coach.hidden = true;
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* fine */ }
}
try { coach.hidden = localStorage.getItem(SEEN_KEY) === "1"; } catch { coach.hidden = false; }
$("coach-ok").addEventListener("click", dismissCoach);

let toastTimer = 0;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3600);
}

// Start: a shared circuit, else the last draft, else the summing amplifier from the README.
async function start(): Promise<void> {
  const shared = /^#c=([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1];
  if (shared) {
    try {
      const unpacked = await unpack(shared);
      fileNameEl.textContent = detectFormat(unpacked) === "dsl" ? "shared.schem" : "shared.schem.json";
      setText(unpacked);
      return;
    } catch {
      toast("That share link is damaged; showing an example instead.");
    }
  }
  const draft = loadDraft();
  if (draft && draft.trim()) {
    fileNameEl.textContent = detectFormat(draft) === "dsl" ? "circuit.schem" : "circuit.schem.json";
    setText(draft);
  } else {
    fileNameEl.textContent = DEFAULT_EXAMPLE;
    setText(exampleText(DEFAULT_EXAMPLE));
  }
}
void start();
