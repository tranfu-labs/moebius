export const MINIMUM_CLAUDE_CLI_VERSION = "2.1.170";

/**
 * `--thinking-display summarized` 未文档化；design（process-step-detail）实测
 * 2.1.222 起才产生可读思考文本。全局最低版本 2.1.170 是 PRD 冻结的产品决策
 * （AI 建队隔离依赖 --safe-mode、Fable 要求该版本），因此思考展示能力用独立
 * 门槛覆盖：低于此版本不传 flag，步骤行自然退化为无首句思考行。
 */
export const CLAUDE_THINKING_DISPLAY_MINIMUM_VERSION = "2.1.222";

export interface ParsedClaudeCliVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseClaudeCliVersion(value: string): ParsedClaudeCliVersion | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\s|$)/u);
  if (match === null) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isSupportedClaudeCliVersion(value: string): boolean {
  const actual = parseClaudeCliVersion(value);
  const minimum = parseClaudeCliVersion(MINIMUM_CLAUDE_CLI_VERSION);
  if (actual === null || minimum === null) {
    return false;
  }
  return compareClaudeCliVersions(actual, minimum) >= 0;
}

export function isClaudeThinkingDisplaySupported(value: string): boolean {
  const actual = parseClaudeCliVersion(value);
  const minimum = parseClaudeCliVersion(CLAUDE_THINKING_DISPLAY_MINIMUM_VERSION);
  if (actual === null || minimum === null) {
    return false;
  }
  return compareClaudeCliVersions(actual, minimum) >= 0;
}

export function compareClaudeCliVersions(
  left: ParsedClaudeCliVersion,
  right: ParsedClaudeCliVersion,
): number {
  return left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch;
}
