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

export const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: "schem_create",
    description: "Create a new project file from a netlist and draw it. source may be .schem text DSL (preferred for brevity), JSON text, or a JSON object. The file must not already exist. The reply has status, revision, layoutToken, counts and, unless detail is brief, the first findings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project file to create, inside a configured root." },
        source: { description: "The netlist as .schem text DSL (preferred), a JSON string, or a JSON object." },
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
    description: "Return a PNG of the drawing. maxSize is the longer side in pixels (default 1024, at most 8000). focus is part ids, or pass finding with a finding id from schem_check (not both). If fitting the whole sheet would make labels smaller than 9 px, the image is still the overview and the text says to ask again with focus.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxSize: { type: "number" },
        focus: { description: "Part ids to crop to: a list, or a comma-separated string." },
        finding: { type: "string", description: "Finding id from schem_check to crop to. Pass focus or finding, not both." },
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
  {
    name: "schem_undo",
    description: "Restore the latest saved snapshot of a project file from its .schem-history folder. Refuses if no history exists or the snapshot does not draw validly. Returns the restored revision, layoutToken and counts.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project file to restore, inside a configured root." },
      },
      required: ["path"],
    },
  },
  {
    name: "schem_describe",
    description: "Return a plain-text description of a verified drawing: sheet size, crossing count, part positions and orientations, neighbours and net connections. Set table to true to also return structured net rows.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project file to describe, inside a configured root." },
        table: { type: "boolean", description: "Include a structured table of nets, presentations and connected pins." },
      },
      required: ["path"],
    },
  },
  {
    name: "schem_fmt",
    description: "Format a project file in place, or convert between .schem text DSL and .schem.json when to is given. Converting writes a new sibling file without overwriting an existing one. Conversion to dsl fails cleanly if the JSON uses fields text DSL cannot represent.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project file to format or convert, inside a configured root." },
        to: { type: "string", enum: ["dsl", "json"], description: "Target format. Omit to format in place." },
      },
      required: ["path"],
    },
  },
  {
    name: "schem_components",
    description: "Search the built-in symbol and module catalogue. Returns paginated component ids, kinds and pins. Use cursor for further pages, or call schem_component for full pin metadata on one type.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional case-insensitive substring filter on component id or module name." },
        limit: { type: "integer", minimum: 1, description: "Maximum number of entries per page (default 20)." },
        cursor: { type: "string", description: "Decimal offset for the next page, returned by an earlier call." },
      },
    },
  },
  {
    name: "schem_component",
    description: "Return full pin metadata for one built-in symbol, ic, header or module:* type: pin numbers, names, aliases, roles, groups, interfaces, refPrefix and module doc metadata. Returns close matches if the type is unknown.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Component type id, such as resistor, opamp, ic, header or module:esp32-devkitc-v4." },
      },
      required: ["type"],
    },
  },
];

export function callTool(roots: Roots, name: string, args: unknown): ToolResult {
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
