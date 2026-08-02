import crypto from "node:crypto";

import type {
  CeoChildIssueDescriptor,
  CeoOrchestrationGroup,
  ParseCeoOrchestrationResult,
} from "./ceo-orchestration-parser.js";
import { CEO_ORCHESTRATION_STAGE } from "../stages.js";

export function collectLocalCeoLedgerTaskIds(finalText: string): string[] {
  const jsonText = stripLocalCeoJson(finalText);
  if (jsonText === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  const issues = parsed["issues"];
  if (!Array.isArray(issues)) return [];
  return issues
    .map((issue) => (isPlainObject(issue) && typeof issue["ledgerTaskId"] === "string" ? issue["ledgerTaskId"] : null))
    .filter((value): value is string => value !== null && value.trim() !== "");
}

export function planLocalCeoVisibleTaskIds(finalText: string): string[] {
  return collectLocalCeoLedgerTaskIds(finalText);
}

export function planLocalChildDescriptors(parsed: ParseCeoOrchestrationResult):
  | { kind: "skip" }
  | {
      kind: "create";
      workflowId: string;
      groups: CeoOrchestrationGroup[];
      issues: CeoChildIssueDescriptor[];
    } {
  if (!parsed.ok) return { kind: "skip" };
  const value = parsed.value;
  if (value.action === "spawn_child_issues") {
    return value.issues.length === 0
      ? { kind: "skip" }
      : { kind: "create", workflowId: value.workflowId, groups: value.groups, issues: value.issues };
  }
  if (value.action === "goal_intake" && value.mode === "confirm") {
    return value.issues.length === 0
      ? { kind: "skip" }
      : { kind: "create", workflowId: value.workflowId, groups: value.groups, issues: value.issues };
  }
  return { kind: "skip" };
}

export function planLocalChildGroup(
  groups: readonly CeoOrchestrationGroup[],
  groupId: string,
): { kind: "missing" } | { kind: "found"; group: CeoOrchestrationGroup } {
  const group = groups.find((entry) => entry.id === groupId);
  return group === undefined ? { kind: "missing" } : { kind: "found", group };
}

export function localOrchestrationKey(input: {
  parentSessionId: string;
  workflowId: string;
  ledgerTaskId: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${input.parentSessionId}|${input.workflowId}|${input.ledgerTaskId}`)
    .digest("hex")
    .slice(0, 32);
  return `moebius-local-orchestration-key:${digest}`;
}

export function localChildSessionId(parentSessionId: string, ledgerTaskId: string): string {
  const digest = crypto.createHash("sha256").update(`${parentSessionId}|${ledgerTaskId}`).digest("hex").slice(0, 12);
  return `local:child:${slugForLocalSessionId(ledgerTaskId)}:${digest}`;
}

export function renderLocalChildSessionInitialBody(input: {
  parentSessionId: string;
  workflowId: string;
  group: CeoOrchestrationGroup;
  descriptor: CeoChildIssueDescriptor;
  orchestrationKey: string;
}): string {
  const taskChecks = input.descriptor.acceptanceStatements.map((statement, index) => `${String(index + 1)}. ${statement}`).join("\n");
  const dependencies = input.descriptor.dependencies.length === 0
    ? "- none"
    : input.descriptor.dependencies.map((dependency) => `- ${dependency}`).join("\n");
  return `${input.descriptor.description.trimEnd()}

Parent session: ${input.parentSessionId}
Ledger task id: ${input.descriptor.ledgerTaskId}
Workflow id: ${input.workflowId}
Quality baseline: ${input.descriptor.qualityBaseline}

Dependencies:
${dependencies}
${taskChecks === "" ? "" : `\n任务检查参考:\n${taskChecks}\n`}

Initial handoff:
@${input.descriptor.initialRole} 请按任务描述、质量基准和现有上下文推进。

Conflict group: ${input.group.id}
Conflict reason: ${input.group.reason}

Provenance:
${input.descriptor.provenance}

<!-- ${input.orchestrationKey} -->`;
}

function stripLocalCeoJson(finalText: string): string | null {
  const marker = `<!-- moebius:stage=${CEO_ORCHESTRATION_STAGE} -->`;
  const withoutMarker = finalText.includes(marker) ? finalText.slice(0, finalText.lastIndexOf(marker)).trim() : finalText.trim();
  const fenced = withoutMarker.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  return (fenced?.[1] ?? withoutMarker).trim();
}

function slugForLocalSessionId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug === "" ? "task" : slug.slice(0, 40);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
