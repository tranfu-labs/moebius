import { spawn } from "node:child_process";

import { MANAGED_PROCESS_MCP_PREFLIGHT_TIMEOUT_MS } from "../config.js";

const EXPECTED_TOOLS = [
  "managed_process_start",
  "managed_process_list",
  "managed_process_inspect",
  "managed_process_read_logs",
  "managed_process_stop",
] as const;

export async function preflightManagedProcessMcpServer(input: {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      env: { ...process.env, ...input.env },
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(
      () => finish(new Error("managed-process MCP preflight timed out")),
      MANAGED_PROCESS_MCP_PREFLIGHT_TIMEOUT_MS,
    );
    child.once("error", () => finish(new Error("managed-process MCP bridge could not start")));
    child.once("close", () => {
      if (!settled) finish(new Error("managed-process MCP bridge exited during preflight"));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 256 * 1024) {
        finish(new Error("managed-process MCP preflight response was too large"));
        return;
      }
      const responses = output.split("\n").filter((line) => line.trim() !== "");
      if (responses.length < 2) return;
      try {
        const parsed = responses.map((line) => JSON.parse(line) as { id?: unknown; result?: { tools?: Array<{ name?: unknown }> } });
        const names = parsed.flatMap((response) => response.result?.tools?.map((tool) => tool.name) ?? []).filter((name): name is string => typeof name === "string");
        if (EXPECTED_TOOLS.every((name) => names.includes(name))) finish();
        else finish(new Error("managed-process MCP tools were not discoverable"));
      } catch {
        finish(new Error("managed-process MCP preflight response was invalid"));
      }
    });
    child.stdin.end([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      "",
    ].join("\n"));
  });
}
