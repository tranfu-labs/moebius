import { collectMarkdownFileReferenceCandidates } from "@moebius/console-ui/console/markdown-file-reference-plan";
import type { AgentImageSourceLoadResult } from "./managed-attachment-port.js";
import type { DerivedPngPreviews } from "./attachment-preview.js";

export interface AgentImageReferenceCandidate {
  sessionId: string;
  path: string;
}

export type AgentImagePreviewState =
  | { status: "loading" }
  | { status: "ready"; previewUrl: string; largePreviewUrl: string; mediaType: string }
  | { status: "failed" }
  | { status: "missing" };

export const AGENT_IMAGE_PREVIEW_CONCURRENCY = 4;

/**
 * Agent image reference candidate plan (desktop domain): collects local file candidates
 * from Agent message bodies using the existing Markdown file reference semantics; deduplicates by path across messages in document order.
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

/** Keeps only still-visible preview states when the message set changes, and lists URLs to release. */
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

/** Maps a restricted source read result (domain): an available image source enters derivation; otherwise missing/failed. */
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

/** Maps derivation results (domain): missing without a decode, otherwise returns the thumbnail and large tiers. */
export function planAgentImagePreviewDerivation(
  previews: DerivedPngPreviews | null,
): { kind: "missing" } | { kind: "ready"; thumbnail: Blob; large: Blob } {
  return previews === null
    ? { kind: "missing" }
    : { kind: "ready", thumbnail: previews.thumbnail, large: previews.large };
}

/** Commits a derived URL (domain): discards the new URL when a ready state already exists. */
export function planAgentImagePreviewUrlCommit(
  current: Readonly<Record<string, AgentImagePreviewState>>,
  key: string,
  url: string,
  largeUrl: string,
  mediaType: string,
): { kind: "discard" } | { kind: "commit"; states: Record<string, AgentImagePreviewState> } {
  return current[key]?.status === "ready"
    ? { kind: "discard" }
    : {
        kind: "commit",
        states: {
          ...current,
          [key]: { status: "ready", previewUrl: url, largePreviewUrl: largeUrl, mediaType },
        },
      };
}

/**
 * Synthesizes Agent image references as message attachments (domain): shares the same image structure as user attachments;
 * previewStatus passes loading/failed/missing through, and ready carries both derived preview URLs.
 */
export function planAgentMessageImageAttachments(
  messages: readonly { sessionId: string; speaker: string; role: string | null; body: string }[],
  states: Readonly<Record<string, AgentImagePreviewState>>,
): Array<{ sessionId: string; speaker: string; role: string | null; body: string; attachments: unknown[] }> {
  return messages.map((message) => {
    if (message.speaker !== "agent") {
      return { ...message, attachments: [] };
    }
    const attachments = [];
    for (const reference of collectMarkdownFileReferenceCandidates(message.body)) {
      const state = states[agentImageCacheKey(message.sessionId, reference.path)];
      if (state === undefined) continue;
      const displayName = planAgentImageSourceFileName(reference.path);
      if (state.status === "ready") {
        attachments.push({
          attachmentId: reference.path,
          kind: "image",
          displayName,
          mediaType: state.mediaType,
          byteSize: 0,
          previewUrl: state.previewUrl,
          largePreviewUrl: state.largePreviewUrl,
          previewStatus: "ready",
        });
      } else {
        attachments.push({
          attachmentId: reference.path,
          kind: "image",
          displayName,
          mediaType: "image/png",
          byteSize: 0,
          previewStatus: state.status,
        });
      }
    }
    return { ...message, attachments };
  });
}

export function planAgentImageSourceFileName(path: string): string {
  return path.split("/").pop() ?? "agent-image";
}

/** Releases every preview URL on unmount. */
export function planAgentImagePreviewRevokeAll(
  states: Readonly<Record<string, AgentImagePreviewState>>,
): string[] {
  return Object.values(states).flatMap((state) => state.status === "ready" ? [state.previewUrl] : []);
}
