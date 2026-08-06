import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_RESULT_CHARACTERS = 200_000;

export interface PiManagedProcessExtensionOptions {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
}

/**
 * Exposes the existing Moebius managed-process MCP bridge to Pi without loading
 * ambient MCP configuration or allowing the extension to choose another server.
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

      pi.registerTool({
        name: "managed_process",
        label: "Moebius Managed Process",
        description: "List or invoke tools on Moebius' managed-process bridge. Use this instead of background, detached, nohup, or watcher shell commands.",
        promptSnippet: "Start, inspect, read logs from, or stop Moebius-managed long-running processes",
        promptGuidelines: [
          "Use managed_process for every service, watcher, or task that must outlive the current foreground command.",
        ],
        parameters: Type.Object({
          action: Type.Union([Type.Literal("list"), Type.Literal("call")]),
          toolName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }),
        async execute(_toolCallId, params, signal) {
          const activeClient = await connect();
          const listed = await activeClient.listTools(undefined, { signal });
          if (params.action === "list") {
            return toolText(JSON.stringify(listed.tools.map((tool) => ({
              name: tool.name,
              description: tool.description ?? "",
              inputSchema: tool.inputSchema,
            }))));
          }
          if (params.toolName === undefined) {
            return toolText("toolName is required when action is call.", true);
          }
          if (!listed.tools.some((tool) => tool.name === params.toolName)) {
            return toolText(`Managed-process tool is not available: ${params.toolName}`, true);
          }
          const result = await activeClient.callTool({
            name: params.toolName,
            arguments: params.arguments ?? {},
          }, undefined, { signal });
          return toolText(
            serializeMcpResult(result),
            typeof result === "object" && result !== null && "isError" in result && result.isError === true,
          );
        },
      });

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
  if (candidateResult.structuredContent !== undefined) {
    textParts.push(JSON.stringify(candidateResult.structuredContent));
  }
  return textParts.join("\n");
}
