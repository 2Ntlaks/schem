// MCP session (SPEC 11.5): initialize, then tools/list and tools/call.
// Protocol bytes go back to the caller. This file does not write to stdout.

import { readFileSync } from "node:fs";
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  errorLine,
  negotiate,
  parseLine,
  resultLine,
  type RpcId,
} from "./protocol.js";
import { openRoots, showPath, type Roots } from "./roots.js";
import { TOOLS, callTool, type ToolResult } from "./tools.js";

export interface Session {
  roots: Roots;
  initialized: boolean;
}

export const INSTRUCTIONS = [
  "schem turns a JSON netlist into a schematic. Files are the state. Do not invent coordinates.",
  "1. schem_create writes a new project file from a netlist (JSON text or an object).",
  "2. schem_check reads status, revision, layoutToken and findings. A finding may include a checked fix.",
  "3. schem_edit applies the ops from that fix. Pass expectedLayout from the fix, and expectedRevision when you have it.",
  "4. Repeat check and edit until status is valid and the warning count is 0, or two rounds make no progress, or five rounds have passed. Never change the circuit just to improve the drawing.",
  "5. schem_preview returns a PNG. If labels would be under 9 px, ask again with focus set to the part ids you need.",
  "6. schem_render writes an SVG or a PNG into the configured roots.",
  "schem_undo and the component catalogue are not in this server. Visual operations are setters: repeating one changes nothing. addPart fails if that part id already exists. A revision or layout mismatch returns status conflict and writes nothing.",
  "This server reads and writes only inside its configured roots.",
].join("\n");

export const HELP = `schem mcp: a Model Context Protocol server on stdin and stdout

Usage:
  npm run mcp
  npm run mcp -- --root <folder> [--root <folder>]

The server reads JSON-RPC from stdin and writes JSON-RPC to stdout, one
message per line. Logs go to stderr. It reads and writes only inside the
root folders. The default root is the current folder.

Tools: schem_create, schem_edit, schem_check, schem_preview, schem_query,
schem_render.

schem_undo and the component catalogue are not in this server.
`;

export function serverArgs(argv: string[]): { roots: string[]; help: boolean; error?: string } {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") return { roots, help: true };
    if (arg === "--root") {
      const next = argv[++i];
      if (next === undefined || next.startsWith("-")) return { roots, help: false, error: "--root needs a folder." };
      roots.push(next);
      continue;
    }
    return { roots, help: false, error: `unknown argument "${arg}".` };
  }
  if (roots.length === 0) roots.push(process.cwd());
  return { roots, help: false };
}

export function createSession(dirs: string[]): Session {
  return { roots: openRoots(dirs), initialized: false };
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

function paramsOf(params: unknown): Record<string, unknown> | undefined {
  if (params === undefined) return {};
  if (typeof params === "object" && params !== null && !Array.isArray(params)) return params as Record<string, unknown>;
  return undefined;
}

/**
 * Handle one stdin line. Returns the stdout line, or undefined when the line needs no reply
 * (blank, or a notification).
 */
export function handleMessage(session: Session, line: string): string | undefined {
  const parsed = parseLine(line);
  if (parsed.kind === "empty") return undefined;
  if (parsed.kind === "error") return errorLine(parsed.id, parsed.code, parsed.message);
  if (parsed.kind === "notification") {
    if (parsed.method === "notifications/initialized") return undefined;
    return undefined;
  }
  const { id, method, params } = parsed.request;
  try {
    if (method === "initialize") return onInitialize(session, id, params);
    if (!session.initialized) return errorLine(id, INVALID_REQUEST, "send initialize first.");
    if (method === "ping") return resultLine(id, {});
    if (method === "tools/list") return resultLine(id, { tools: TOOLS });
    if (method === "tools/call") return onCall(session, id, params);
    return errorLine(id, METHOD_NOT_FOUND, `unknown method "${method}".`);
  } catch (e) {
    process.stderr.write(`schem mcp: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return errorLine(id, INTERNAL_ERROR, "internal error");
  }
}

function onInitialize(session: Session, id: RpcId, params: unknown): string {
  const body = paramsOf(params);
  if (body === undefined) return errorLine(id, INVALID_PARAMS, "initialize params must be an object.");
  const version = negotiate(body.protocolVersion);
  session.initialized = true;
  return resultLine(id, {
    protocolVersion: version,
    capabilities: { tools: {} },
    serverInfo: { name: "schem", version: packageVersion() },
    instructions: INSTRUCTIONS,
  });
}

function onCall(session: Session, id: RpcId, params: unknown): string {
  const body = paramsOf(params);
  if (body === undefined || typeof body.name !== "string") return errorLine(id, INVALID_PARAMS, "tools/call needs a name.");
  if (body.arguments !== undefined && (typeof body.arguments !== "object" || body.arguments === null || Array.isArray(body.arguments))) {
    return errorLine(id, INVALID_PARAMS, "tools/call arguments must be an object.");
  }
  const result: ToolResult = callTool(session.roots, body.name, body.arguments ?? {});
  return resultLine(id, result);
}

export function rootsLabel(session: Session): string {
  return session.roots.real.map(showPath).join(", ");
}
