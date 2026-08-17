import { collectMarkdownFileReferenceCandidates } from "@moebius/console-ui/console/markdown-file-reference-plan";
import type { AgentImageSourceLoadResult } from "./managed-attachment-port.js";
import type { DerivedPngPreviews } from "./attachment-preview.js";

export interface AgentImageReferenceCandidate {
  sessionId: string;
  path: string;
}

export type AgentImagePreviewState =
  | { status: "loading" }
  | { status: "ready"; previewUrl: string; mediaType: string }
  | { status: "failed" }
  | { status: "missing" };

export const AGENT_IMAGE_PREVIEW_CONCURRENCY = 4;

/**
 * Agent 图片引用候选计划（desktop domain）：只从 Agent 消息正文按既有
 * Markdown 文件引用语义采集本地文件候选，跨消息按路径去重，保持文档顺序。
 */
export function planAgentImageReferenceCandidates(
  messages: readonly { sessionId: string; speaker: string; body: string }[],
): AgentImageReferenceCandidate[] {
  const seen = new Set<string>();
  const candidates: AgentImageReferenceCandidate[] = [];
  for (const message of messages) {
    if (message.speaker !== "agent") {
      continue;
    }
    for (const reference of collectMarkdownFileReferenceCandidates(message.body)) {
      if (seen.has(reference.path)) {
        continue;
      }
      seen.add(reference.path);
      candidates.push({ sessionId: message.sessionId, path: reference.path });
    }
  }
  return candidates;
}

/** A preview URL belongs to the session and the referenced source path. */
export function agentImageCacheKey(sessionId: string, path: string): string {
  return `${sessionId}\u0000${path}`;
}

export function agentImageReferenceKey(candidate: AgentImageReferenceCandidate): string {
  return agentImageCacheKey(candidate.sessionId, candidate.path);
}

/** 消息集合变化时只保留仍可见的预览状态，并给出要释放的 URL。 */
export function planAgentImagePreviewRetention(
  current: Readonly<Record<string, AgentImagePreviewState>>,
  liveKeys: ReadonlySet<string>,
): { states: Record<string, AgentImagePreviewState>; revokeUrls: string[] } {
  const states: Record<string, AgentImagePreviewState> = {};
  const revokeUrls: string[] = [];
  for (const [key, state] of Object.entries(current)) {
    if (liveKeys.has(key)) {
      states[key] = state;
      continue;
    }
    if (state.status === "ready") revokeUrls.push(state.previewUrl);
  }
  return { states, revokeUrls };
}

export function decideAgentImagePreviewLoad(input: {
  state: AgentImagePreviewState | undefined;
  inFlight: boolean;
}): "load" | "skip" {
  return input.inFlight || input.state?.status === "ready" ? "skip" : "load";
}

export function decideAgentImagePreviewCommit(input: {
  aborted: boolean;
  currentGeneration: number;
  expectedGeneration: number;
}): "commit" | "ignore" {
  return input.aborted || input.currentGeneration !== input.expectedGeneration ? "ignore" : "commit";
}

export function decideAgentImagePreviewPump(input: {
  running: number;
  index: number;
  length: number;
}): "continue" | "stop" {
  return input.running < AGENT_IMAGE_PREVIEW_CONCURRENCY && input.index < input.length
    ? "continue"
    : "stop";
}

/** 受限源读取结果映射（domain）：图片源可用时进入派生阶段，否则按缺失/失败呈现。 */
export function planAgentImagePreviewOutcome(
  result: AgentImageSourceLoadResult,
): { kind: "failed" } | { kind: "missing" } | { kind: "source"; mediaType: string; blob: Blob } {
  if (result.ok) {
    return { kind: "source", mediaType: result.mediaType, blob: result.blob };
  }
  return {
    kind: result.reason === "not-image" || result.reason === "not-found" ? "missing" : "failed",
  };
}

/** 派生结果映射（domain）：派生不可用时按缺失呈现，可用时返回缩略图。 */
export function planAgentImagePreviewDerivation(
  previews: DerivedPngPreviews | null,
): { kind: "missing" } | { kind: "ready"; thumbnail: Blob; large: Blob } {
  return previews === null
    ? { kind: "missing" }
    : { kind: "ready", thumbnail: previews.thumbnail, large: previews.large };
}

/** 派生 URL 提交（domain）：已存在 ready 状态时丢弃新建 URL。 */
export function planAgentImagePreviewUrlCommit(
  current: Readonly<Record<string, AgentImagePreviewState>>,
  key: string,
  url: string,
  mediaType: string,
): { kind: "discard" } | { kind: "commit"; states: Record<string, AgentImagePreviewState> } {
  return current[key]?.status === "ready"
    ? { kind: "discard" }
    : { kind: "commit", states: { ...current, [key]: { status: "ready", previewUrl: url, mediaType } } };
}

export function planAgentImageSourceFileName(path: string): string {
  return path.split("/").pop() ?? "agent-image";
}

/** 卸载时释放全部预览 URL。 */
export function planAgentImagePreviewRevokeAll(
  states: Readonly<Record<string, AgentImagePreviewState>>,
): string[] {
  return Object.values(states).flatMap((state) => state.status === "ready" ? [state.previewUrl] : []);
}
