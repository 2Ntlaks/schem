// JSON-RPC 2.0 lines for the MCP server (SPEC 11.2, 11.5). One JSON object per line.
// There is no Content-Length header. A notification has no id and gets no reply.

export type RpcId = number | string | null;

export interface RpcRequest {
  id: RpcId;
  method: string;
  params: unknown;
}

export type ParsedLine =
  | { kind: "empty" }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "request"; request: RpcRequest }
  | { kind: "error"; id: RpcId; code: number; message: string };

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** Protocol versions this server accepts. An unknown version is answered with the newest one. */
export const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const PROTOCOL_VERSION: (typeof PROTOCOL_VERSIONS)[number] = "2025-06-18";

export function negotiate(version: unknown): (typeof PROTOCOL_VERSIONS)[number] {
  return PROTOCOL_VERSIONS.find((v) => v === version) ?? PROTOCOL_VERSION;
}

/** Parse one stdin line. Blank lines are ignored. */
export function parseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "") return { kind: "empty" };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: "error", id: null, code: PARSE_ERROR, message: "the line is not JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "error", id: null, code: INVALID_REQUEST, message: "a message is one JSON object." };
  }
  const msg = value as Record<string, unknown>;
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = msg.id;
  if (hasId && id !== null && typeof id !== "string" && typeof id !== "number") {
    return { kind: "error", id: null, code: INVALID_REQUEST, message: "id must be a string, a number or null." };
  }
  const replyId: RpcId = hasId ? (id as RpcId) : null;
  if (msg.jsonrpc !== "2.0") return { kind: "error", id: replyId, code: INVALID_REQUEST, message: 'jsonrpc must be "2.0".' };
  if (typeof msg.method !== "string" || msg.method === "") {
    return { kind: "error", id: replyId, code: INVALID_REQUEST, message: "method must be a string." };
  }
  const params = msg.params === undefined ? {} : msg.params;
  if (!hasId) return { kind: "notification", method: msg.method, params };
  return { kind: "request", request: { id: id as RpcId, method: msg.method, params } };
}

export function resultLine(id: RpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function errorLine(id: RpcId, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}
