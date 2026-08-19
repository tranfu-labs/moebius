import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  MANAGED_PROCESS_TOOLS,
  type ManagedProcessToolName,
} from "./local-console/managed-process-tools.js";

const MAX_RESULT_CHARACTERS = 200_000;

export interface PiManagedProcessExtensionOptions {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
}

/**
 * Parameter schemas for the five native managed-process tools. They mirror the
 * JSON Schema in `src/local-console/managed-process-tools.ts` using TypeBox
 * because pi-coding-agent's registerTool only accepts TypeBox schemas.
 */
const startParameters = Type.Object({
  kind: Type.Union([
    Type.Literal("service"),
    Type.Literal("watcher"),
    Type.Literal("task"),
  ]),
  label: Type.String(),
  executable: Type.String(),
  args: Type.Array(Type.String()),
  cwd: Type.String(),
  readiness: Type.Optional(Type.Union([
    Type.Object({ type: Type.Literal("none") }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal("tcp"),
      host: Type.Union([Type.Literal("127.0.0.1"), Type.Literal("localhost")]),
      port: Type.Integer({ minimum: 1, maximum: 65535 }),
    }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("http"), url: Type.String() }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("stdout-pattern"), pattern: Type.String() }, { additionalProperties: false }),
  ])),
  endpoint: Type.Optional(Type.Object({ url: Type.String() }, { additionalProperties: false })),
}, { additionalProperties: false });

const idParameters = Type.Object({ id: Type.String() }, { additionalProperties: false });

const emptyParameters = Type.Object({}, { additionalProperties: false });

const toolParameters: Record<ManagedProcessToolName, ReturnType<typeof Type.Object>> = {
  managed_process_start: startParameters,
  managed_process_list: emptyParameters,
  managed_process_inspect: idParameters,
  managed_process_read_logs: idParameters,
  managed_process_stop: idParameters,
};

/**
 * Exposes the existing Moebius managed-process MCP bridge to Pi without loading
 * ambient MCP configuration or allowing the extension to choose another server.
 *
 * Pi sees the same five native tool names as Codex, Claude, and Kimi; each tool
 * forwards its arguments to the matching bridge tool over the injected stdio
 * MCP client. A missing or failing bridge tool surfaces as a real tool error
 * (no fallback, no JSON-in-text protocol).
 */
export function createPiManagedProcessExtension(
  options: PiManagedProcessExtensionOptions,
): InlineExtension {
  return {
    name: "moebius-managed-process",
    hidden: true,
    factory(pi) {
      let client: Client | null = null;
      let transport: StdioClientTransport | null = null;
      let connection: Promise<Client> | null = null;

      const connect = async (): Promise<Client> => {
        if (client !== null) return client;
        if (connection !== null) return connection;
        connection = (async () => {
          const nextClient = new Client(
            { name: "moebius-pi-host", version: "1" },
            { capabilities: {} },
          );
          const nextTransport = new StdioClientTransport({
            command: options.command,
            args: [...options.args],
            env: { ...options.env },
            cwd: options.cwd,
            stderr: "pipe",
          });
          await nextClient.connect(nextTransport);
          client = nextClient;
          transport = nextTransport;
          return nextClient;
        })().catch((error) => {
          connection = null;
          throw error;
        });
        return connection;
      };

      const close = async (): Promise<void> => {
        const currentClient = client;
        const currentTransport = transport;
        client = null;
        transport = null;
        connection = null;
        if (currentClient !== null) {
          await currentClient.close().catch(() => undefined);
        } else if (currentTransport !== null) {
          await currentTransport.close().catch(() => undefined);
        }
      };

      for (const tool of MANAGED_PROCESS_TOOLS) {
        pi.registerTool({
          name: tool.name,
          label: "Moebius Managed Process",
          description: tool.description,
          promptSnippet: "Start, inspect, read logs from, or stop Moebius-managed long-running processes",
          promptGuidelines: [
            "Use managed_process for every service, watcher, or task that must outlive the current foreground command.",
          ],
          parameters: toolParameters[tool.name],
          async execute(_toolCallId, params, signal) {
            const activeClient = await connect();
            const result = await activeClient.callTool({
              name: tool.name,
              arguments: params ?? {},
            }, undefined, { signal });
            return toolText(
              serializeMcpResult(result),
              typeof result === "object" && result !== null && "isError" in result && result.isError === true,
            );
          },
        });
      }

      pi.on("session_shutdown", async () => {
        await close();
      });
    },
  };
}

function toolText(text: string, isError = false) {
  const limited = text.length <= MAX_RESULT_CHARACTERS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARACTERS)}\n[output truncated]`;
  return {
    content: [{ type: "text" as const, text: limited }],
    details: { isError },
  };
}

function serializeMcpResult(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
    return JSON.stringify(result);
  }
  const candidateResult = result as { content: readonly unknown[]; structuredContent?: unknown };
  const textParts = candidateResult.content.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string"
      ? [candidate.text]
      : [JSON.stringify(item)];
  });
  if (textParts.length > 0) return textParts.join("\n");
  if (candidateResult.structuredContent !== undefined) {
    return JSON.stringify(candidateResult.structuredContent);
  }
  return JSON.stringify(result);
}
