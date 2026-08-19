/**
 * Single source of truth for the Moebius managed-process MCP capability face.
 *
 * Every provider adapter (Codex config injection, Claude mcp-config JSON,
 * Kimi ACP push, Pi inline extension) and the stdio bridge itself must expose
 * the same server name, tool names, descriptions, and JSON Schema. Keep those
 * contracts here; do not duplicate them in adapters.
 */

export const MOEBIUS_MANAGED_MCP_SERVER_NAME = "moebius_managed";

export const MANAGED_PROCESS_TOOL_NAMES = [
  "managed_process_start",
  "managed_process_list",
  "managed_process_inspect",
  "managed_process_read_logs",
  "managed_process_stop",
] as const;

export type ManagedProcessToolName = (typeof MANAGED_PROCESS_TOOL_NAMES)[number];

export interface ManagedProcessToolSpec {
  name: ManagedProcessToolName;
  description: string;
}

export const MANAGED_PROCESS_TOOLS: readonly ManagedProcessToolSpec[] = [
  { name: "managed_process_start", description: "Start a supervised long-running service, watcher, or task without a shell." },
  { name: "managed_process_list", description: "List managed processes for this conversation." },
  { name: "managed_process_inspect", description: "Inspect one managed process." },
  { name: "managed_process_read_logs", description: "Read bounded stdout and stderr for one managed process." },
  { name: "managed_process_stop", description: "Stop one managed process and its complete launchd-owned process group." },
];

/**
 * JSON Schema for the bridge (and any consumer that speaks raw JSON Schema).
 * The Pi inline extension declares the same parameter shapes with TypeBox
 * because pi-coding-agent's registerTool only accepts TypeBox schemas.
 */
export const managedProcessEmptySchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export const managedProcessIdSchema = {
  type: "object",
  additionalProperties: false,
  properties: { id: { type: "string" } },
  required: ["id"],
} as const;

export const managedProcessStartSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { enum: ["service", "watcher", "task"] },
    label: { type: "string" },
    executable: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    cwd: { type: "string" },
    readiness: { oneOf: [
      { type: "object", additionalProperties: false, properties: { type: { const: "none" } }, required: ["type"] },
      { type: "object", additionalProperties: false, properties: { type: { const: "tcp" }, host: { enum: ["127.0.0.1", "localhost"] }, port: { type: "integer", minimum: 1, maximum: 65535 } }, required: ["type", "host", "port"] },
      { type: "object", additionalProperties: false, properties: { type: { const: "http" }, url: { type: "string" } }, required: ["type", "url"] },
      { type: "object", additionalProperties: false, properties: { type: { const: "stdout-pattern" }, pattern: { type: "string" } }, required: ["type", "pattern"] },
    ] },
    endpoint: { type: "object", additionalProperties: false, properties: { url: { type: "string" } }, required: ["url"] },
  },
  required: ["kind", "label", "executable", "args", "cwd"],
} as const;

export const MANAGED_PROCESS_TOOL_SCHEMAS: Record<ManagedProcessToolName, object> = {
  managed_process_start: managedProcessStartSchema,
  managed_process_list: managedProcessEmptySchema,
  managed_process_inspect: managedProcessIdSchema,
  managed_process_read_logs: managedProcessIdSchema,
  managed_process_stop: managedProcessIdSchema,
};
