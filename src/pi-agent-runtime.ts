import { access, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSessionEvent,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { createMoebiusPiTools } from "./pi-host-tools.js";
import { createPiManagedProcessExtension } from "./pi-managed-process-extension.js";
import type { PiHostOutputFrame, PiHostStartFrame } from "./pi-host-protocol.js";
import { getProviderCatalogModel, DEEPSEEK_BASE_URL } from "./provider-profile.js";
import {
  PiProviderValidationError,
  classifyPiProviderValidationError,
  createDeepSeekCompatibilityExtension,
  createMemoryCredentialStore,
  toPiModel,
  validateDeepSeekProviderWithPi,
} from "./pi-provider-validator.js";

type RunInvocation = Extract<PiHostStartFrame["invocation"], { kind: "run" }>;

export async function executePiHostInvocation(input: {
  frame: PiHostStartFrame;
  signal: AbortSignal;
  emit: (frame: PiHostOutputFrame) => void;
}): Promise<void> {
  const { frame, signal, emit } = input;
  if (frame.invocation.kind === "validate") {
    await validateDeepSeekProviderWithPi({
      ...frame.invocation,
      apiKey: frame.credential.apiKey,
      signal,
    });
    emit({ version: 1, type: "validated", replied: true, toolCalled: true });
    return;
  }
  await runPiAgent({ invocation: frame.invocation, apiKey: frame.credential.apiKey, signal, emit });
}

async function runPiAgent(input: {
  invocation: RunInvocation;
  apiKey: string;
  signal: AbortSignal;
  emit: (frame: PiHostOutputFrame) => void;
}): Promise<void> {
  const { invocation, apiKey, signal, emit } = input;
  const catalogModel = getProviderCatalogModel(invocation.providerId, invocation.model);
  if (catalogModel === null) {
    throw new PiProviderValidationError("model-incompatible", "这个模型不在受支持目录中。");
  }
  if (invocation.imagePaths.length > 0) {
    throw new PiProviderValidationError(
      "model-incompatible",
      "DeepSeek V4 当前仅支持文本输入，不能读取图片附件。请移除图片后重试。",
    );
  }
  await mkdir(invocation.sessionDir, { recursive: true, mode: 0o700 });
  const sessionManager = await resolveSessionManager(invocation);
  const modelRuntime = await ModelRuntime.create({
    credentials: createMemoryCredentialStore(invocation.providerId, apiKey),
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerProvider(invocation.providerId, {
    name: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey,
    api: "openai-completions",
    authHeader: true,
    models: [toPiModel(catalogModel)],
  });
  const model = modelRuntime.getModel(invocation.providerId, invocation.model);
  if (model === undefined) {
    throw new PiProviderValidationError("model-incompatible", "无法装配这个模型。");
  }
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: invocation.providerId,
    defaultModel: invocation.model,
    defaultThinkingLevel: invocation.effort,
    compaction: { enabled: true },
    retry: { enabled: false, provider: { maxRetries: 0 } },
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  }, { projectTrusted: true });
  const extensionFactories: InlineExtension[] = [
    createDeepSeekCompatibilityExtension(),
    ...(invocation.managedProcessMcp === null
      ? []
      : [createPiManagedProcessExtension({
        ...invocation.managedProcessMcp,
        cwd: invocation.cwd,
      })]),
  ];
  const resourceLoader = new DefaultResourceLoader({
    cwd: invocation.cwd,
    agentDir: invocation.agentDir,
    settingsManager,
    extensionFactories,
    noExtensions: false,
    noSkills: false,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: false,
    systemPrompt: [
      "You are the Pi API coding agent embedded in Moebius.",
      "Work directly in the active workspace and use the provided structured tools.",
      "Never claim a command or edit succeeded unless its tool result confirms it.",
      "Use list_files, read_file, search_files, edit_file, apply_patch, write_file, and exec_command as needed.",
      invocation.managedProcessMcp === null
        ? "Managed long-running process tools are unavailable in this run."
        : "Use managed_process for Moebius-managed long-running processes; never launch detached or background shell processes yourself.",
    ].join("\n"),
  });
  await resourceLoader.reload();
  const runSubagents = async (tasks: readonly string[], parentSignal: AbortSignal | undefined): Promise<readonly string[]> => {
    const groupController = new AbortController();
    const abortGroup = () => groupController.abort();
    parentSignal?.addEventListener("abort", abortGroup, { once: true });
    if (parentSignal?.aborted === true) groupController.abort();
    const runs = tasks.map(async (task, index) => {
      const childSettings = SettingsManager.inMemory({
        defaultProvider: invocation.providerId,
        defaultModel: invocation.model,
        defaultThinkingLevel: invocation.effort,
        compaction: { enabled: true },
        retry: { enabled: false, provider: { maxRetries: 0 } },
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      }, { projectTrusted: true });
      const childLoader = new DefaultResourceLoader({
        cwd: invocation.cwd,
        agentDir: invocation.agentDir,
        settingsManager: childSettings,
        extensionFactories: [createDeepSeekCompatibilityExtension()],
        noExtensions: false,
        noSkills: false,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: false,
        systemPrompt: [
          "You are a foreground Pi subagent embedded in Moebius.",
          "Complete only the delegated task and return a concise result to the parent agent.",
          "Nested subagents and detached or background processes are unavailable.",
        ].join("\n"),
      });
      await childLoader.reload();
      const childTools = createMoebiusPiTools(invocation.cwd);
      const childManager = await SessionManager.create(
        invocation.cwd,
        path.join(invocation.sessionDir, "subagents", String(index + 1)),
      );
      const { session: childSession } = await createAgentSession({
        cwd: invocation.cwd,
        agentDir: invocation.agentDir,
        modelRuntime,
        model,
        thinkingLevel: invocation.effort,
        noTools: "all",
        tools: childTools.map((tool) => tool.name),
        customTools: childTools,
        resourceLoader: childLoader,
        sessionManager: childManager,
        settingsManager: childSettings,
      });
      const abortChild = () => { void childSession.abort(); };
      groupController.signal.addEventListener("abort", abortChild, { once: true });
      try {
        await childSession.prompt(task, { expandPromptTemplates: false, source: "rpc" });
        await childSession.waitForIdle();
        if (groupController.signal.aborted) {
          throw new PiProviderValidationError("cancelled", "并行子任务已取消。");
        }
        const result = lastAssistantText(childSession.messages);
        if (result.length === 0) {
          throw new PiProviderValidationError("provider-unavailable", "并行子任务没有返回完整结果。");
        }
        if (childSession.sessionFile !== undefined) {
          await chmod(childSession.sessionFile, 0o600);
        }
        return result;
      } finally {
        groupController.signal.removeEventListener("abort", abortChild);
        childSession.dispose();
      }
    });
    try {
      return await Promise.all(runs);
    } catch (error) {
      groupController.abort();
      await Promise.allSettled(runs);
      throw error;
    } finally {
      parentSignal?.removeEventListener("abort", abortGroup);
    }
  };
  const tools = createMoebiusPiTools(invocation.cwd, { runSubagents });
  const { session } = await createAgentSession({
    cwd: invocation.cwd,
    agentDir: invocation.agentDir,
    modelRuntime,
    model,
    thinkingLevel: invocation.effort,
    noTools: "all",
    tools: tools.map((tool) => tool.name),
    customTools: tools,
    resourceLoader,
    sessionManager,
    settingsManager,
  });
  const sessionPath = session.sessionFile ?? null;
  emit({ version: 1, type: "session-observed", sessionId: session.sessionId, sessionPath });
  const unsubscribe = session.subscribe((event) => projectPiEvent(event, emit));
  const abort = () => { void session.abort(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await session.prompt(invocation.prompt, {
      expandPromptTemplates: false,
      source: "rpc",
    });
    await session.waitForIdle();
    if (signal.aborted) {
      throw new PiProviderValidationError("cancelled", "运行已取消。");
    }
    const body = lastAssistantText(session.messages);
    if (body.length === 0) {
      throw new PiProviderValidationError("provider-unavailable", "模型没有返回完整结果。");
    }
    if (sessionPath !== null) {
      await chmod(sessionPath, 0o600);
    }
    emit({ version: 1, type: "completed", body });
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}

async function resolveSessionManager(invocation: RunInvocation): Promise<SessionManager> {
  if (invocation.nativeSessionPath === null) {
    return SessionManager.create(invocation.cwd, invocation.sessionDir);
  }
  const sessionDir = path.resolve(invocation.sessionDir);
  const sessionPath = path.resolve(invocation.nativeSessionPath);
  if (!sessionPath.startsWith(`${sessionDir}${path.sep}`)) {
    throw new PiProviderValidationError("provider-unavailable", "原生会话记录不属于当前会话目录。");
  }
  try {
    await access(sessionPath);
  } catch {
    throw new PiProviderValidationError("provider-unavailable", "原生会话记录不可用。");
  }
  return SessionManager.open(sessionPath, sessionDir, invocation.cwd);
}

function projectPiEvent(event: AgentSessionEvent, emit: (frame: PiHostOutputFrame) => void): void {
  if (event.type === "message_update") {
    if (event.assistantMessageEvent.type === "text_delta") {
      emit({ version: 1, type: "assistant-delta", delta: event.assistantMessageEvent.delta });
    } else if (event.assistantMessageEvent.type === "thinking_delta") {
      emit({ version: 1, type: "reasoning-delta", delta: event.assistantMessageEvent.delta });
    }
  } else if (event.type === "tool_execution_start") {
    emit({
      version: 1,
      type: "tool-started",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      safeSummary: safeToolSummary(event.toolName),
    });
  } else if (event.type === "tool_execution_end") {
    emit({
      version: 1,
      type: "tool-finished",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
    });
  } else if (event.type === "compaction_end" && !event.aborted && event.result !== undefined) {
    emit({ version: 1, type: "compacted" });
  }
}

function safeToolSummary(toolName: string): string {
  return ({
    read_file: "正在读取项目文件",
    write_file: "正在写入项目文件",
    edit_file: "正在修改项目文件",
    apply_patch: "正在应用项目补丁",
    list_files: "正在查看项目目录",
    search_files: "正在搜索项目",
    exec_command: "正在运行项目命令",
  } as Record<string, string>)[toolName] ?? "正在使用工具";
}

function lastAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((item): item is { type: "text"; text: string } =>
        isRecord(item) && item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("")
      .trim();
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toPiHostFailure(error: unknown, aborted: boolean): Extract<PiHostOutputFrame, { type: "failed" }> {
  const classified = classifyPiProviderValidationError(error, aborted);
  return {
    version: 1,
    type: "failed",
    reason: classified.code,
    message: classified.message,
  };
}
