import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  defineTool,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  DEEPSEEK_BASE_URL,
  getProviderCatalogModel,
  type DeepSeekModelId,
  type PiEffort,
} from "./provider-profile.js";

const VALIDATION_NONCE = "moebius-provider-check-v1";

export function createDeepSeekCompatibilityExtension(): InlineExtension {
  return {
    name: "moebius-deepseek-compatibility",
    hidden: true,
    factory(pi) {
      pi.on("before_provider_request", (event) => {
        if (!isRecord(event.payload)) return;
        const toolChoice = event.payload.tool_choice;
        if (toolChoice !== "required" && !isRecord(toolChoice)) return;
        return { ...event.payload, tool_choice: "auto" };
      });
    },
  };
}

export interface PiProviderValidationInput {
  providerId: "deepseek";
  model: DeepSeekModelId;
  apiKey: string;
  cwd: string;
  agentDir: string;
  effort?: PiEffort;
  signal?: AbortSignal;
}

export interface PiProviderValidationResult {
  model: DeepSeekModelId;
  replied: true;
  toolCalled: true;
}

export async function validateDeepSeekProviderWithPi(
  input: PiProviderValidationInput,
): Promise<PiProviderValidationResult> {
  const catalogModel = getProviderCatalogModel(input.providerId, input.model);
  if (catalogModel === null) {
    throw new PiProviderValidationError("model-incompatible", "这个模型不在受支持目录中。");
  }
  const credentials = createMemoryCredentialStore(input.providerId, input.apiKey);
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const modelRuntime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
    modelRuntime.registerProvider(input.providerId, {
      name: "DeepSeek",
      baseUrl: DEEPSEEK_BASE_URL,
      apiKey: input.apiKey,
      api: "openai-completions",
      authHeader: true,
      models: [toPiModel(catalogModel)],
    });
    const model = modelRuntime.getModel(input.providerId, input.model);
    if (model === undefined) {
      throw new PiProviderValidationError("model-incompatible", "无法装配这个模型。");
    }
    const validationTool = defineTool({
      name: "moebius_validation",
      label: "Moebius 能力验证",
      description: "Return the supplied fixed nonce. This tool has no project or system side effects.",
      parameters: Type.Object({ nonce: Type.Literal(VALIDATION_NONCE) }),
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: params.nonce }],
          details: { validated: params.nonce === VALIDATION_NONCE },
        };
      },
    });
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: input.providerId,
      defaultModel: input.model,
      defaultThinkingLevel: input.effort ?? catalogModel.defaultEffort,
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    }, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: input.agentDir,
      settingsManager,
      extensionFactories: [createDeepSeekCompatibilityExtension()],
      noExtensions: false,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "You are a provider capability probe. Follow the requested tool protocol exactly.",
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: input.agentDir,
      modelRuntime,
      model,
      thinkingLevel: input.effort ?? catalogModel.defaultEffort,
      noTools: "all",
      tools: ["moebius_validation"],
      customTools: [validationTool],
      resourceLoader,
      sessionManager: SessionManager.inMemory(input.cwd),
      settingsManager,
    }));
    let toolCalled = false;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_end" && event.toolName === "moebius_validation" && !event.isError) {
        toolCalled = true;
      }
    });
    abortListener = () => { void session?.abort(); };
    input.signal?.addEventListener("abort", abortListener, { once: true });
    try {
      await session.prompt(
        `Call moebius_validation exactly once with nonce "${VALIDATION_NONCE}". After the tool succeeds, reply with a short confirmation. Do not use any other tool.`,
        { expandPromptTemplates: false, source: "rpc" },
      );
      await session.waitForIdle();
    } finally {
      unsubscribe();
    }
    if (input.signal?.aborted) {
      throw new PiProviderValidationError("cancelled", "验证已取消。");
    }
    const replied = session.messages.some((message) =>
      message.role === "assistant"
      && message.stopReason !== "error"
      && message.stopReason !== "aborted"
      && message.content.some((content) => content.type === "text" && content.text.trim().length > 0)
    );
    if (!toolCalled || !replied) {
      throw new PiProviderValidationError(
        "model-incompatible",
        "模型没有完成回复与工具调用能力验证。",
      );
    }
    return { model: input.model, replied: true, toolCalled: true };
  } catch (error) {
    throw classifyPiProviderValidationError(error, input.signal?.aborted ?? false);
  } finally {
    if (abortListener !== undefined) {
      input.signal?.removeEventListener("abort", abortListener);
    }
    session?.dispose();
  }
}

export function classifyPiProviderValidationError(
  error: unknown,
  aborted = false,
): PiProviderValidationError {
  if (error instanceof PiProviderValidationError) {
    return error;
  }
  if (aborted || (error instanceof Error && error.name === "AbortError")) {
    return new PiProviderValidationError("cancelled", "验证已取消。", { cause: error });
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/\b(401|403|unauthorized|invalid api key|authentication)\b/u.test(message)) {
    return new PiProviderValidationError("auth", "API Key 无效或没有访问权限。", { cause: error });
  }
  if (/\b(429|rate limit|too many requests)\b/u.test(message)) {
    return new PiProviderValidationError("rate-limited", "服务商当前请求过多，请稍后重试。", { cause: error });
  }
  if (/\b(quota|insufficient balance|billing)\b/u.test(message)) {
    return new PiProviderValidationError("quota", "服务商额度或余额不足。", { cause: error });
  }
  if (/\b(model).*(not found|unavailable|unsupported)|\b404\b/u.test(message)) {
    return new PiProviderValidationError("model-unavailable", "所选模型当前不可用。", { cause: error });
  }
  if (/\b(network|fetch failed|econn|enotfound|timeout|timed out)\b/u.test(message)) {
    return new PiProviderValidationError("network", "无法连接 AI 服务商，请检查网络后重试。", { cause: error });
  }
  return new PiProviderValidationError("provider-unavailable", "AI 服务商暂时无法完成验证。", { cause: error });
}

export class PiProviderValidationError extends Error {
  constructor(
    readonly code:
      | "auth"
      | "model-unavailable"
      | "model-incompatible"
      | "rate-limited"
      | "quota"
      | "network"
      | "provider-unavailable"
      | "cancelled",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PiProviderValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMemoryCredentialStore(providerId: string, apiKey: string): CredentialStore {
  let credential: Credential | undefined = { type: "api_key", key: apiKey };
  return {
    async read(requestedProviderId) {
      return requestedProviderId === providerId ? credential : undefined;
    },
    async list(): Promise<readonly CredentialInfo[]> {
      return credential === undefined ? [] : [{ providerId, type: credential.type }];
    },
    async modify(requestedProviderId, update) {
      if (requestedProviderId !== providerId) {
        return undefined;
      }
      credential = await update(credential);
      return credential;
    },
    async delete(requestedProviderId) {
      if (requestedProviderId === providerId) {
        credential = undefined;
      }
    },
  };
}

export function toPiModel(model: NonNullable<ReturnType<typeof getProviderCatalogModel>>) {
  const cost = model.id === "deepseek-v4-flash"
    ? { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }
    : { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 };
  return {
    id: model.id,
    name: model.displayName,
    api: "openai-completions" as const,
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
    input: ["text"] as ("text" | "image")[],
    cost,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    compat: {
      thinkingFormat: "deepseek" as const,
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
    },
  };
}
