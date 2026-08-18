/**
 * 新会话自动命名：标题生成提示词与结果清洗（domain 纯闭包）。
 *
 * 提示词 v2 已经用户确认（决策选项 A），作为强基准逐字使用，不改动。
 * 本模块只做三件事：拼装生成提示词、判定是否值得生成、清洗模型输出。
 * 不触 IO；调用通道、profile 选择与重命名落库在 application 层。
 */

/** 用户确认的提示词 v2 全文（强基准，逐字使用）。 */
export const SESSION_TITLE_GENERATION_PROMPT =
  "为这段对话生成标题，不超过 20 字：从第一条消息提炼用户想做什么——意图加对象（例如：改进推特推广），"
  + "不要复述现状、抱怨或提问原句；中文消息用中文、英文消息用英文；不加标点；"
  + "避免「对话、讨论、优化、支持」这类泛词；只输出标题本身。";

/** 生成标题的防御性长度上限（与提示词约束一致）。 */
export const SESSION_TITLE_MAX_LENGTH = 20;

export function buildTitleGenerationPrompt(firstMessage: string): string {
  return `${SESSION_TITLE_GENERATION_PROMPT}\n\n第一条消息：\n${firstMessage}`;
}

/** one-shot 驱动结果投影：把执行驱动的成功/失败分支归一为标题端口结果（纯投影）。 */
export function projectTitleOneShotResult(
  result: { ok: true; finalText: string } | { ok: false; reason: string },
): { ok: true; text: string } | { ok: false; reason: string } {
  return result.ok
    ? { ok: true, text: result.finalText }
    : { ok: false, reason: result.reason };
}

/** 标题生成异常的统一文本化（纯函数；错误对象只取消息）。 */
export function formatTitleOneShotError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function decideTitleGeneration(input: {
  /** 该消息是否本会话的第一条用户消息（会话在消息落库前没有任何消息）。 */
  wasFirstMessage: boolean;
  /** 首条消息是否含可提炼的文本（纯附件消息无文本不生成）。 */
  firstMessageHasText: boolean;
}): { kind: "skip" } | { kind: "generate" } {
  if (!input.wasFirstMessage) return { kind: "skip" };
  if (!input.firstMessageHasText) return { kind: "skip" };
  return { kind: "generate" };
}

/** 标题生成能力开关（默认启用；测试基建关闭后走无副作用通道）。 */
export function planTitleGenerationEnablement(
  enabled: boolean,
): { kind: "enabled" } | { kind: "disabled" } {
  return enabled ? { kind: "enabled" } : { kind: "disabled" };
}

/**
 * 清洗模型输出为可落库的标题；无法得到有效标题时返回 null（调用方保持默认标题）。
 * 防御性处理：JSON 形状输出（如 {"title": "..."}）提取 title 字段；
 * 去掉首尾引号、折叠空白、按码点截断到上限；纯符号或无内容视为无效。
 */
export function sanitizeGeneratedTitle(raw: string): string | null {
  const source = stripMarkdownFence(raw);
  const jsonTitle = tryExtractJsonTitle(source);
  if (jsonTitle === null) return null;
  const cleaned = (jsonTitle ?? source)
    .trim()
    .replace(/^["'`“”‘’「」]+|["'`“”‘’「」]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return null;
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return [...cleaned].slice(0, SESSION_TITLE_MAX_LENGTH).join("");
}

function stripMarkdownFence(value: string): string {
  return value.trim().replace(/^```[a-zA-Z]*\s*/u, "").replace(/\s*```$/u, "").trim();
}

function tryExtractJsonTitle(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const title = (parsed as { title?: unknown }).title;
    // 合法 JSON 对象但拿不到字符串 title：整体判无效，不回退原文。
    return typeof title === "string" ? title : null;
  } catch {
    // 不是合法 JSON，按纯文本处理。
    return undefined;
  }
}
