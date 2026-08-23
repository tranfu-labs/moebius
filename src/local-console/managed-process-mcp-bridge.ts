import net from "node:net";
import { watch, type FSWatcher } from "node:fs";
import { access, readFile } from "node:fs/promises";

import {
  MANAGED_PROCESS_TOOLS,
  MANAGED_PROCESS_TOOL_SCHEMAS,
  type ManagedProcessToolName,
} from "./managed-process-tools.js";

const socketPath = process.argv[2];
const capabilityPath = process.argv[3];
const leaseMode = process.argv[4] === "--lease-file";
const token = leaseMode
  ? undefined
  : process.env.MOEBIUS_MANAGED_PROCESS_CAPABILITY
    ?? (capabilityPath === undefined ? undefined : await readFile(capabilityPath, "utf8").catch(() => undefined));
if (
  socketPath === undefined
  || (!leaseMode && token === undefined)
  || (leaseMode && capabilityPath === undefined)
  || (leaseMode && process.env.MOEBIUS_MANAGED_PROCESS_CAPABILITY !== undefined)
) {
  process.stderr.write("Managed process bridge requires a socket and capability.\n");
  process.exitCode = 1;
} else {
  startBridge(
    socketPath,
    leaseMode
      ? () => readLeaseCapability(capabilityPath!)
      : async () => token!,
    leaseMode ? undefined : capabilityPath,
  );
}

const tools: ReadonlyArray<{
  name: ManagedProcessToolName;
  description: string;
  inputSchema: object;
}> = MANAGED_PROCESS_TOOLS.map((tool) => ({
  ...tool,
  inputSchema: MANAGED_PROCESS_TOOL_SCHEMAS[tool.name],
}));

function startBridge(
  supervisorSocket: string,
  readCapability: () => Promise<string>,
  watchedCapabilityPath: string | undefined,
): void {
  let buffer = "";
  let inFlight = 0;
  let shutdownRequested = false;
  let capabilityWatcher: FSWatcher | null = null;
  const finishIfIdle = (): void => {
    if (!shutdownRequested || inFlight > 0) return;
    capabilityWatcher?.close();
    capabilityWatcher = null;
    process.stdout.write("", () => process.exit(0));
  };
  const requestShutdown = (): void => {
    shutdownRequested = true;
    process.stdin.pause();
    finishIfIdle();
  };
  const dispatch = (message: { id?: unknown; method?: unknown; params?: unknown }): void => {
    inFlight += 1;
    void handle(message, supervisorSocket, readCapability).finally(() => {
      inFlight -= 1;
      finishIfIdle();
    });
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      try {
        dispatch(JSON.parse(line) as { id?: unknown; method?: unknown; params?: unknown });
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
    }
  });
  process.stdin.once("end", requestShutdown);
  process.stdin.once("close", requestShutdown);
  process.stdin.once("error", requestShutdown);
  if (watchedCapabilityPath !== undefined) {
    try {
      capabilityWatcher = watch(watchedCapabilityPath, requestShutdown);
      void access(watchedCapabilityPath).catch(requestShutdown);
    } catch {
      requestShutdown();
    }
  }
}

async function handle(
  message: { id?: unknown; method?: unknown; params?: unknown },
  socketPath: string,
  readCapability: () => Promise<string>,
): Promise<void> {
  if (message.method === "notifications/initialized") return;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "moebius-managed-process", version: "1" } } });
    return;
  }
  if (message.method === "ping") { send({ jsonrpc: "2.0", id: message.id, result: {} }); return; }
  if (message.method === "tools/list") { send({ jsonrpc: "2.0", id: message.id, result: { tools } }); return; }
  if (message.method === "tools/call") {
    const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
    let capability: string | null = null;
    try {
      const method = toolMethod(params?.name);
      capability = await readCapability();
      const result = await supervisorCall(socketPath, capability, method, params?.arguments ?? {});
      // structuredContent must be a JSON object per the MCP schema; list results
      // (arrays) and primitives travel only inside content[].text.
      const structuredContent = typeof result === "object" && result !== null && !Array.isArray(result)
        ? result
        : undefined;
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          ...(structuredContent === undefined ? {} : { structuredContent }),
          isError: false,
        },
      });
      await reportCompletion(socketPath, capability, message.id, "completed");
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: safeMessage(error) }], isError: true } });
      if (capability !== null) {
        await reportCompletion(socketPath, capability, message.id, "failed").catch(() => undefined);
      }
    }
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

async function reportCompletion(socketPath: string, capability: string, id: unknown, completionKind: "completed" | "failed"): Promise<void> {
  const toolCallId = typeof id === "string" || typeof id === "number" ? String(id) : "unknown";
  await supervisorCall(socketPath, capability, "report_completion", { toolCallId, completionKind });
}

function toolMethod(name: unknown): string {
  const mapping: Record<string, string> = {
    managed_process_start: "start",
    managed_process_list: "list",
    managed_process_inspect: "inspect",
    managed_process_read_logs: "read_logs",
    managed_process_stop: "stop",
  };
  if (typeof name !== "string" || mapping[name] === undefined) throw new Error("Unknown managed process tool.");
  return mapping[name];
}

async function supervisorCall(socketPath: string, capability: string, method: string, params: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = "";
    socket.once("connect", () => socket.write(`${JSON.stringify({ token: capability, method, params })}\n`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.once("end", () => {
      try {
        const parsed = JSON.parse(response.trim()) as { result?: unknown; error?: { message?: string } };
        if (parsed.error !== undefined) reject(new Error(parsed.error.message ?? "Managed process operation failed."));
        else resolve(parsed.result);
      } catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}

function send(value: unknown): void { process.stdout.write(`${JSON.stringify(value)}\n`); }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message : "Managed process operation failed."; }

async function readLeaseCapability(capabilityPath: string): Promise<string> {
  const capability = await readFile(capabilityPath, "utf8").catch(() => undefined);
  if (capability === undefined || capability.length === 0) {
    throw new Error("Managed process capability is unavailable for this Claude turn.");
  }
  return capability;
}
