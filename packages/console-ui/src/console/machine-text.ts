const machineFieldPattern = /\b(?:cwd|runDir|run_dir|worktreePath|workspaceCwd|sqlitePath|sessionId|runId|messageId|sourceMessageId)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const absolutePathPattern = /(?:\/(?:Users|home|tmp|private|var\/folders|opt|srv|workspace|workdir)(?:\/[^\s`'"<>),;:]*)+|[A-Za-z]:\\(?:[^\s`'"<>),;]+\\?)+)/gu;
const internalIdPattern = /\b(?:local|github):[A-Za-z0-9._:/-]+|\b(?:dead-letter|handoff)[A-Za-z0-9._:/-]*/giu;
const rawWorkspaceTokenPattern = /\b(?:direct|worktree)\b/giu;

export function sanitizeMachineText(value: string, fallback = "机器信息已隐藏"): string {
  const sanitized = sanitizeMachineTextFragment(value)
    .trim();
  return sanitized === "" ? fallback : sanitized;
}

export function sanitizeMachineTextFragment(value: string): string {
  return value
    .replace(machineFieldPattern, "[机器信息已隐藏]")
    .replace(absolutePathPattern, "[路径已隐藏]")
    .replace(internalIdPattern, "[内部标识已隐藏]")
    .replace(rawWorkspaceTokenPattern, "[工作空间类型已隐藏]")
    .replace(/(?:\[机器信息已隐藏\]\s*){2,}/gu, "[机器信息已隐藏] ");
}

export function containsMachineText(value: string): boolean {
  return sanitizeMachineText(value) !== value.trim();
}
