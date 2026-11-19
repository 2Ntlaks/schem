// MCP protocol wrappers for commands shared with the CLI (SPEC 11.5).
import { executeCommand } from "./commands.js";
import type { Roots } from "./roots.js";

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
    description: "Create a new project file from a netlist and draw it. source may be text DSL, JSON text, or a JSON object. The file must not already exist. The reply has status, revision, layoutToken, counts and, unless detail is brief, the first findings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project file to create, inside a configured root." },
        source: { description: "The netlist as text DSL, a JSON string, or a JSON object." },
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

export function callTool(roots: Roots, name: string, args: unknown): ToolResult {
  if (LATER.has(name)) return failure(`${name} is not in this server. Use the CLI for undo and the component catalogue.`);
  if (!TOOLS.some((tool) => tool.name === name)) return failure(`unknown tool "${name}".`);
  if (typeof args !== "object" || args === null || Array.isArray(args)) return failure("arguments must be an object.");
  const result = executeCommand(roots, name, args as Record<string, unknown>);
  const content: ToolContent[] = [{ type: "text", text: JSON.stringify(result.body, null, 2) }];
  if (result.image) content.push({ type: "image", data: result.image.toString("base64"), mimeType: "image/png" });
  return { content, isError: result.isError };
}

function failure(error: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error }, null, 2) }], isError: true };
}
