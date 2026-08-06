import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMoebiusPiTools } from "../src/pi-host-tools.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Moebius Pi tools", () => {
  it("keeps file operations inside the workspace and executes structured commands without a shell", async () => {
    const workspace = await createWorkspace();
    const tools = createMoebiusPiTools(workspace);
    await executeTool(tools, "write_file", { path: "src/value.txt", content: "safe" });
    expect(await readFile(path.join(workspace, "src/value.txt"), "utf8")).toBe("safe");
    await expect(executeTool(tools, "read_file", { path: "../outside.txt" }))
      .rejects.toThrow("outside the active workspace");
    const result = await executeTool(tools, "exec_command", {
      command: process.execPath,
      args: ["-e", "process.stdout.write('structured')"],
    });
    expect(textResult(result)).toContain("structured");
    expect(textResult(result)).toContain("Exit code: 0");
  });

  it("prevalidates every patch edit before changing any file", async () => {
    const workspace = await createWorkspace();
    const tools = createMoebiusPiTools(workspace);
    await executeTool(tools, "write_file", { path: "one.txt", content: "old one" });
    await executeTool(tools, "write_file", { path: "two.txt", content: "old two" });
    await expect(executeTool(tools, "apply_patch", { edits: [
      { path: "one.txt", oldText: "old", newText: "new" },
      { path: "two.txt", oldText: "missing", newText: "new" },
    ] })).rejects.toThrow("not found");
    expect(await readFile(path.join(workspace, "one.txt"), "utf8")).toBe("old one");

    await executeTool(tools, "apply_patch", { edits: [
      { path: "one.txt", oldText: "old one", newText: "new one" },
      { path: "two.txt", oldText: "old two", newText: "new two" },
    ] });
    expect(await readFile(path.join(workspace, "one.txt"), "utf8")).toBe("new one");
    expect(await readFile(path.join(workspace, "two.txt"), "utf8")).toBe("new two");
  });

  it("enforces one in-progress plan step and joins bounded subagents", async () => {
    const workspace = await createWorkspace();
    const runSubagents = vi.fn(async (tasks: readonly string[]) => tasks.map((task) => `done: ${task}`));
    const tools = createMoebiusPiTools(workspace, { runSubagents });
    await expect(executeTool(tools, "update_plan", {
      items: [
        { step: "one", status: "in_progress" },
        { step: "two", status: "in_progress" },
      ],
    })).rejects.toThrow("At most one");
    const delegated = await executeTool(tools, "parallel_subagents", { tasks: ["inspect", "test"] });
    expect(runSubagents).toHaveBeenCalledOnce();
    expect(textResult(delegated)).toContain("done: inspect");
    expect(textResult(delegated)).toContain("done: test");
    expect(createMoebiusPiTools(workspace).some((tool) => tool.name === "parallel_subagents")).toBe(false);
  });

  it("terminates a foreground command when the invocation is cancelled", async () => {
    const workspace = await createWorkspace();
    const tools = createMoebiusPiTools(workspace);
    const controller = new AbortController();
    const running = executeTool(
      tools,
      "exec_command",
      { command: process.execPath, args: ["-e", "setInterval(() => undefined, 1000)"] },
      controller.signal,
    );
    controller.abort();
    expect(textResult(await running)).toContain("Exit code:");
  });

  it("fetches bounded loopback HTTP content without enabling an ambient search provider", async () => {
    const workspace = await createWorkspace();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("fixture-page");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("fixture server did not bind");
      const tools = createMoebiusPiTools(workspace);
      const result = await executeTool(tools, "web_fetch", { url: `http://127.0.0.1:${address.port}/page` });
      expect(textResult(result)).toContain("Status: 200");
      expect(textResult(result)).toContain("fixture-page");
      expect(tools.some((tool) => tool.name === "web_search")).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "moebius-pi-tools-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function executeTool(
  tools: ReturnType<typeof createMoebiusPiTools>,
  name: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`missing tool: ${name}`);
  return await tool.execute("test-call", input as never, signal, undefined, {} as never);
}

function textResult(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content.map((item) => item.text ?? "").join("\n");
}
