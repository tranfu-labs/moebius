import type { Translate } from "@/i18n";

const machineFieldPattern = /\b(?:cwd|runDir|run_dir|worktreePath|workspaceCwd|sqlitePath|sessionId|runId|messageId|sourceMessageId)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const absolutePathPattern = /(?:\/(?:Users|home|tmp|private|var\/folders|opt|srv|workspace|workdir)(?:\/[^\s`'"<>),;:]*)+|[A-Za-z]:\\(?:[^\s`'"<>),;]+\\?)+)/gu;
const internalIdPattern = /\b(?:local|github):[A-Za-z0-9._:/-]+|\b(?:dead-letter|handoff)[A-Za-z0-9._:/-]*/giu;
const rawWorkspaceTokenPattern = /\b(?:direct|worktree)\b/giu;

export interface MachineTextPlaceholders {
  machine: string;
  path: string;
  internalId: string;
  workspaceType: string;
}

const defaultPlaceholders: MachineTextPlaceholders = {
  machine: "[Machine details hidden]",
  path: "[Path hidden]",
  internalId: "[Internal identifier hidden]",
  workspaceType: "[Workspace type hidden]",
};

export function machineTextPlaceholders(t: Translate): MachineTextPlaceholders {
  return {
    machine: t("console.machineText.machineHidden"),
    path: t("console.machineText.pathHidden"),
    internalId: t("console.machineText.internalIdHidden"),
    workspaceType: t("console.machineText.workspaceTypeHidden"),
  };
}

export function sanitizeMachineText(
  value: string,
  fallback = defaultPlaceholders.machine,
  placeholders: MachineTextPlaceholders = defaultPlaceholders,
): string {
  const sanitized = sanitizeMachineTextFragment(value, placeholders)
    .trim();
  return sanitized === "" ? fallback : sanitized;
}

export function sanitizeMachineTextFragment(
  value: string,
  placeholders: MachineTextPlaceholders = defaultPlaceholders,
): string {
  const escapedMachine = escapeRegExp(placeholders.machine);
  return value
    .replace(machineFieldPattern, placeholders.machine)
    .replace(absolutePathPattern, placeholders.path)
    .replace(internalIdPattern, placeholders.internalId)
    .replace(rawWorkspaceTokenPattern, placeholders.workspaceType)
    .replace(new RegExp(`(?:${escapedMachine}\\s*){2,}`, "gu"), `${placeholders.machine} `);
}

export function containsMachineText(value: string): boolean {
  return sanitizeMachineText(value) !== value.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
