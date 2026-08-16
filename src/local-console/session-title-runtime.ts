import { formatLocalError } from "./runtime-domain.js";
import { buildTitleGenerationPrompt, sanitizeGeneratedTitle } from "./session-title-plan.js";
import type {
  LocalConsoleExecutionProfile,
  LocalConsoleSessionSummary,
} from "./types.js";

/** one-shot 完成端口：映射到既有 provider 驱动（agent-revision-summary-job 同款模式）。 */
export interface SessionTitleOneShotPort {
  run(input: {
    sessionId: string;
    profile: LocalConsoleExecutionProfile | null;
    prompt: string;
    runDir: string;
  }): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
}

export interface SessionTitleRuntimeInput {
  nowIso(): string;
  makeTitleRunDir(sessionId: string): string;
  oneShot: SessionTitleOneShotPort;
  sessionPrimaryProfile(sessionId: string): Promise<LocalConsoleExecutionProfile | null>;
  renameSession(input: {
    sessionId: string;
    title: string;
    expectedTitleRevision: number;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  reportError(event: string, error: string): void;
}

/**
 * 新会话首条消息落库后异步生成标题并重命名。
 * 失败静默降级：不重试、不阻塞对话；用户已改名或会话已消失是正常终局。
 * 同一会话只允许一个在途生成（内存守卫，进程内有效）。
 */
export class LocalConsoleSessionTitleRuntime {
  private readonly inFlight = new Set<string>();

  constructor(private readonly input: SessionTitleRuntimeInput) {}

  async generateTitle(sessionId: string, firstMessageBody: string): Promise<void> {
    if (this.inFlight.has(sessionId)) return;
    this.inFlight.add(sessionId);
    try {
      const profile = await this.input.sessionPrimaryProfile(sessionId);
      const result = await this.input.oneShot.run({
        sessionId,
        profile,
        prompt: buildTitleGenerationPrompt(firstMessageBody),
        runDir: this.input.makeTitleRunDir(sessionId),
      });
      if (!result.ok) return;
      const title = sanitizeGeneratedTitle(result.text);
      if (title === null) return;
      await this.input.renameSession({
        sessionId,
        title,
        expectedTitleRevision: 0,
        now: this.input.nowIso(),
      });
    } catch (error) {
      const message = formatLocalError(error);
      if (!isExpectedTitleRenameConflict(message)) {
        this.input.reportError("local-console-session-title-generation-failed", message);
      }
    } finally {
      this.inFlight.delete(sessionId);
    }
  }
}

/**
 * 正常竞争终局：用户在这期间手动改名（乐观锁冲突）或会话被归档/删除。
 * 这两种情况静默处理，其余异常才上报。
 */
function isExpectedTitleRenameConflict(message: string): boolean {
  return message.includes("SESSION_SIDEBAR_STATE_STALE") || message.includes("session not found");
}
