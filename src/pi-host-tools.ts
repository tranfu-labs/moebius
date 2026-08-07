import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  PI_HOST_COMMAND_TERMINATE_GRACE_MS,
  PI_HOST_MAX_FILE_BYTES,
  PI_HOST_MAX_FOREGROUND_SUBAGENTS,
  PI_HOST_MAX_TOOL_OUTPUT_BYTES,
  PI_HOST_WEB_FETCH_TIMEOUT_MS,
} from "./pi-host-protocol.js";

export interface MoebiusPiToolOptions {
  runSubagents?: (tasks: readonly string[], signal: AbortSignal | undefined) => Promise<readonly string[]>;
}

export function createMoebiusPiTools(workspacePath: string, options: MoebiusPiToolOptions = {}) {
  const root = path.resolve(workspacePath);
  let planItems: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> = [];
  const resolveWorkspacePath = (candidate: string): string => {
    const resolved = path.resolve(root, candidate);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Path is outside the active workspace");
    }
    return resolved;
  };

  const read = defineTool({
    name: "read_file",
    label: "读取文件",
    description: "Read a UTF-8 file inside the active workspace.",
    parameters: Type.Object({ path: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, input) {
      const content = await readFile(resolveWorkspacePath(input.path));
      if (content.byteLength > PI_HOST_MAX_FILE_BYTES) {
        throw new Error("File exceeds the readable size limit");
      }
      return { content: [{ type: "text", text: content.toString("utf8") }], details: undefined };
    },
  });

  const write = defineTool({
    name: "write_file",
    label: "写入文件",
    description: "Write a UTF-8 file inside the active workspace, creating parent directories.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      content: Type.String({ maxLength: PI_HOST_MAX_FILE_BYTES }),
    }),
    async execute(_toolCallId, input) {
      const target = resolveWorkspacePath(input.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, "utf8");
      return { content: [{ type: "text", text: `Wrote ${input.path}` }], details: undefined };
    },
  });

  const edit = defineTool({
    name: "edit_file",
    label: "编辑文件",
    description: "Replace one exact text occurrence in a UTF-8 workspace file.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      oldText: Type.String({ minLength: 1 }),
      newText: Type.String(),
    }),
    async execute(_toolCallId, input) {
      const target = resolveWorkspacePath(input.path);
      const original = await readFile(target, "utf8");
      const first = original.indexOf(input.oldText);
      if (first < 0) {
        throw new Error("Text to replace was not found");
      }
      if (original.indexOf(input.oldText, first + input.oldText.length) >= 0) {
        throw new Error("Text to replace is not unique");
      }
      await writeFile(target, `${original.slice(0, first)}${input.newText}${original.slice(first + input.oldText.length)}`, "utf8");
      return { content: [{ type: "text", text: `Edited ${input.path}` }], details: undefined };
    },
  });

  const applyPatch = defineTool({
    name: "apply_patch",
    label: "应用补丁",
    description: "Apply a bounded set of exact text replacements inside the active workspace. Every replacement is validated before any file is written.",
    parameters: Type.Object({
      edits: Type.Array(Type.Object({
        path: Type.String({ minLength: 1 }),
        oldText: Type.String({ minLength: 1 }),
        newText: Type.String(),
      }), { minItems: 1, maxItems: 64 }),
    }),
    async execute(_toolCallId, input) {
      const seen = new Set<string>();
      const prepared: Array<{ target: string; relative: string; content: string }> = [];
      for (const item of input.edits) {
        const target = resolveWorkspacePath(item.path);
        if (seen.has(target)) throw new Error("A patch may edit each file only once");
        seen.add(target);
        const original = await readFile(target, "utf8");
        const first = original.indexOf(item.oldText);
        if (first < 0) throw new Error(`Patch text was not found in ${item.path}`);
        if (original.indexOf(item.oldText, first + item.oldText.length) >= 0) {
          throw new Error(`Patch text is not unique in ${item.path}`);
        }
        prepared.push({
          target,
          relative: item.path,
          content: `${original.slice(0, first)}${item.newText}${original.slice(first + item.oldText.length)}`,
        });
      }
      for (const item of prepared) await writeFile(item.target, item.content, "utf8");
      return {
        content: [{ type: "text", text: `Patched ${prepared.map((item) => item.relative).join(", ")}` }],
        details: { fileCount: prepared.length },
      };
    },
  });

  const list = defineTool({
    name: "list_files",
    label: "列出文件",
    description: "List one directory inside the active workspace.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_toolCallId, input) {
      const target = resolveWorkspacePath(input.path ?? ".");
      const entries = await readdir(target, { withFileTypes: true });
      const text = entries.slice(0, 1000).map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`).join("\n");
      return { content: [{ type: "text", text: text || "(empty)" }], details: undefined };
    },
  });

  const search = defineTool({
    name: "search_files",
    label: "搜索文件",
    description: "Search text with ripgrep inside the active workspace.",
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1, maxLength: 4096 }),
      path: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, input, signal) {
      const target = resolveWorkspacePath(input.path ?? ".");
      const result = await spawnBounded("rg", ["-n", "--no-heading", "--color", "never", "--", input.pattern, target], root, signal);
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`Search failed with exit code ${result.exitCode}`);
      }
      return { content: [{ type: "text", text: result.output || "No matches" }], details: undefined };
    },
  });

  const exec = defineTool({
    name: "exec_command",
    label: "执行命令",
    description: "Execute one program with a structured argument array in the active workspace. Shell syntax is not supported.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 4096 }),
      args: Type.Optional(Type.Array(Type.String({ maxLength: 16_384 }), { maxItems: 512 })),
      cwd: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, input, signal) {
      const cwd = resolveWorkspacePath(input.cwd ?? ".");
      await access(cwd);
      const result = await spawnBounded(input.command, input.args ?? [], cwd, signal);
      return {
        content: [{ type: "text", text: `${result.output}\nExit code: ${result.exitCode}`.trim() }],
        details: { exitCode: result.exitCode },
      };
    },
  });

  const updatePlan = defineTool({
    name: "update_plan",
    label: "更新计划",
    description: "Create or update the current task plan. At most one step may be in progress.",
    parameters: Type.Object({
      items: Type.Array(Type.Object({
        step: Type.String({ minLength: 1, maxLength: 1024 }),
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
        ]),
      }), { maxItems: 64 }),
    }),
    async execute(_toolCallId, input) {
      if (input.items.filter((item) => item.status === "in_progress").length > 1) {
        throw new Error("At most one plan step may be in progress");
      }
      planItems = input.items.map((item) => ({ ...item }));
      return {
        content: [{ type: "text", text: JSON.stringify(planItems) }],
        details: { itemCount: planItems.length },
      };
    },
  });

  const webFetch = defineTool({
    name: "web_fetch",
    label: "抓取网页",
    description: "Fetch one HTTP or HTTPS URL as text. Search-provider discovery is unavailable unless Moebius configures it separately.",
    parameters: Type.Object({ url: Type.String({ minLength: 1, maxLength: 16_384 }) }),
    async execute(_toolCallId, input, signal) {
      const url = new URL(input.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS URLs are supported");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PI_HOST_WEB_FETCH_TIMEOUT_MS);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { "user-agent": "Moebius-Pi-Agent/1" },
          redirect: "follow",
        });
        const bytes = await readBoundedWebBody(response, PI_HOST_MAX_TOOL_OUTPUT_BYTES);
        const contentType = response.headers.get("content-type") ?? "application/octet-stream";
        return {
          content: [{
            type: "text",
            text: `URL: ${response.url}\nStatus: ${response.status}\nContent-Type: ${contentType}\n\n${bytes.toString("utf8")}`,
          }],
          details: { status: response.status, finalUrl: response.url },
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    },
  });

  const subagents = options.runSubagents === undefined
    ? []
    : [defineTool({
        name: "parallel_subagents",
        label: "并行子任务",
        description: "Run up to four independent delegated tasks concurrently and wait for all results. Background, nested, scheduled, shared, and worktree modes are not available.",
        parameters: Type.Object({
          tasks: Type.Array(Type.String({ minLength: 1, maxLength: 16_384 }), {
            minItems: 1,
            maxItems: PI_HOST_MAX_FOREGROUND_SUBAGENTS,
          }),
        }),
        async execute(_toolCallId, input, signal) {
          const results = await options.runSubagents!(input.tasks, signal);
          return {
            content: [{ type: "text", text: results.map((result, index) => `## Task ${index + 1}\n${result}`).join("\n\n") }],
            details: { count: results.length },
          };
        },
      })];

  return [read, write, edit, applyPatch, list, search, exec, updatePlan, webFetch, ...subagents];
}

async function readBoundedWebBody(response: Response, maximumBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error("Web response exceeds the readable size limit");
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Web response exceeds the readable size limit");
    }
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks);
}

async function spawnBounded(
  command: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<{ exitCode: number | null; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let total = 0;
    const append = (chunk: Buffer) => {
      if (total >= PI_HOST_MAX_TOOL_OUTPUT_BYTES) return;
      const remaining = PI_HOST_MAX_TOOL_OUTPUT_BYTES - total;
      const bounded = chunk.subarray(0, remaining);
      chunks.push(bounded);
      total += bounded.byteLength;
    };
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (killTimer !== null) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, PI_HOST_COMMAND_TERMINATE_GRACE_MS);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode) => {
      cleanup();
      resolve({
        exitCode,
        output: Buffer.concat(chunks).toString("utf8") + (total >= PI_HOST_MAX_TOOL_OUTPUT_BYTES ? "\n[output truncated]" : ""),
      });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
  });
}
