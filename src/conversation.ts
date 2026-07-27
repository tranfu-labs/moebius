export function countMessages(commentCount: number): number {
  if (!Number.isInteger(commentCount) || commentCount < 0) {
    throw new Error("commentCount must be a non-negative integer");
  }

  return 1 + commentCount;
}

export interface AgentMention {
  name: string;
  index: number;
}

export interface TimelineComment {
  body: string;
}

export type TimelineSource = "issue-body" | "comment";

export interface TimelineMessage {
  index: number;
  speaker: string;
  body: string;
  source: TimelineSource;
}

export interface RoleThreadState {
  threadId: string;
  lastSeenIndex: number;
  provider?: "codex";
  contextFingerprint?: string;
  workspaceFingerprint?: string;
  personaFingerprint?: string;
}

export type RolePromptPlan =
  | {
      kind: "run";
      mode: "full";
      role: string;
      prompt: string;
      latestIndex: number;
    }
  | {
      kind: "run";
      mode: "resume";
      role: string;
      threadId: string;
      prompt: string;
      latestIndex: number;
      deltaMessages: TimelineMessage[];
    }
  | {
      kind: "skip";
      reason: "empty-timeline" | "no-new-external-messages";
      role: string;
    };

export function buildTimeline(
  issueBody: string,
  comments: TimelineComment[],
  availableAgentNames: string[],
): TimelineMessage[] {
  return [
    {
      index: 0,
      speaker: "user",
      body: issueBody,
      source: "issue-body",
    },
    ...comments.map((comment, commentIndex) => {
      const normalized = normalizeComment(comment.body, availableAgentNames);
      return {
        index: commentIndex + 1,
        source: "comment" as const,
        ...normalized,
      };
    }),
  ];
}

export function getLatestTimelineMessage(timeline: TimelineMessage[]): TimelineMessage | null {
  return timeline[timeline.length - 1] ?? null;
}

export function formatAgentComment(role: string, finalText: string): string {
  return `&lt;${role}&gt;:\n${finalText.trimEnd()}\n\n<!-- moebius:role=${role} -->`;
}

export function buildRolePromptPlan(input: {
  role: string;
  agentMarkdown: string;
  timeline: TimelineMessage[];
  state: RoleThreadState | null;
}): RolePromptPlan {
  const latestIndex = getLatestTimelineMessage(input.timeline)?.index;
  if (latestIndex === undefined) {
    return { kind: "skip", reason: "empty-timeline", role: input.role };
  }

  if (input.state === null) {
    return {
      kind: "run",
      mode: "full",
      role: input.role,
      latestIndex,
      prompt: buildFullPrompt(input.agentMarkdown, input.timeline),
    };
  }

  const deltaMessages = selectDeltaMessages(input.timeline, input.role, input.state.lastSeenIndex);
  if (deltaMessages.length === 0) {
    return { kind: "skip", reason: "no-new-external-messages", role: input.role };
  }

  return {
    kind: "run",
    mode: "resume",
    role: input.role,
    threadId: input.state.threadId,
    latestIndex,
    deltaMessages,
    prompt: buildDeltaPrompt(input.role, deltaMessages),
  };
}

export function selectDeltaMessages(
  timeline: TimelineMessage[],
  role: string,
  lastSeenIndex: number,
): TimelineMessage[] {
  return timeline.filter((message) => message.index > lastSeenIndex && message.speaker !== role);
}

export function resolveNextRoleThreadState(input: {
  currentThreadId: string | null;
  resultThreadId: string | null;
  latestIndex: number;
}): RoleThreadState | null {
  const threadId = input.resultThreadId ?? input.currentThreadId;
  if (threadId === null) {
    return null;
  }

  return {
    threadId,
    lastSeenIndex: input.latestIndex,
  };
}

export function parseAgentMentions(text: string): AgentMention[] {
  const mentions: AgentMention[] = [];
  const pattern = /(^|[^A-Za-z0-9_-])@([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/g;
  const searchableText = maskMarkdownCodeAreas(text);

  for (const match of searchableText.matchAll(pattern)) {
    const prefix = match[1] ?? "";
    const name = match[2];
    if (name === undefined || match.index === undefined) {
      continue;
    }

    mentions.push({
      name,
      index: match.index + prefix.length,
    });
  }

  return mentions;
}

function maskMarkdownCodeAreas(text: string): string {
  const masked = new Array<boolean>(text.length).fill(false);

  let fenceSearchIndex = 0;
  while (fenceSearchIndex < text.length) {
    const fenceStart = text.indexOf("```", fenceSearchIndex);
    if (fenceStart === -1) {
      break;
    }

    const closingFenceStart = text.indexOf("```", fenceStart + 3);
    const fenceEnd = closingFenceStart === -1 ? text.length : closingFenceStart + 3;
    maskRange(masked, fenceStart, fenceEnd);
    fenceSearchIndex = fenceEnd;
  }

  let index = 0;
  while (index < text.length) {
    if (masked[index] || text[index] !== "`") {
      index += 1;
      continue;
    }

    const lineEnd = text.indexOf("\n", index + 1);
    const searchEnd = lineEnd === -1 ? text.length : lineEnd;
    const closingBacktick = findClosingInlineBacktick(text, masked, index + 1, searchEnd);

    if (closingBacktick === -1) {
      index += 1;
      continue;
    }

    maskRange(masked, index, closingBacktick + 1);
    index = closingBacktick + 1;
  }

  return text
    .split("")
    .map((char, charIndex) => {
      if (!masked[charIndex] || char === "\n") {
        return char;
      }

      return " ";
    })
    .join("");
}

function findClosingInlineBacktick(text: string, masked: boolean[], start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (!masked[index] && text[index] === "`") {
      return index;
    }
  }

  return -1;
}

function maskRange(masked: boolean[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    masked[index] = true;
  }
}

export function selectMentionedAgent(text: string, availableAgentNames: string[]): string | null {
  const availableAgents = new Set(availableAgentNames);

  for (const mention of parseAgentMentions(text)) {
    if (availableAgents.has(mention.name)) {
      return mention.name;
    }
  }

  return null;
}

function normalizeComment(body: string, availableAgentNames: string[]): Pick<TimelineMessage, "speaker" | "body"> {
  const availableAgents = new Set(availableAgentNames);
  const metadataRole = parseMetadataRole(body);

  if (metadataRole !== null) {
    if (metadataRole === "ceo") {
      return {
        speaker: "ceo",
        body: stripRoleEnvelope(stripAgentMetadata(body), "ceo"),
      };
    }

    if (!availableAgents.has(metadataRole)) {
      return {
        speaker: "user",
        body,
      };
    }

    return {
      speaker: metadataRole,
      body: stripRoleEnvelope(stripAgentMetadata(body), metadataRole),
    };
  }

  const legacyRole = parseRoleEnvelopePrefix(body);
  if (legacyRole !== null && availableAgents.has(legacyRole)) {
    return {
      speaker: legacyRole,
      body: stripRoleEnvelope(body, legacyRole),
    };
  }

  return {
    speaker: "user",
    body,
  };
}

function parseMetadataRole(body: string): string | null {
  const match = body.match(/<!--\s*moebius:role=([a-z0-9]+(?:-[a-z0-9]+)*)\s*-->/);
  return match?.[1] ?? null;
}

function parseRoleEnvelopePrefix(body: string): string | null {
  const rolePattern = "([a-z0-9]+(?:-[a-z0-9]+)*)";
  const match = body.match(
    new RegExp(`^(?:${rolePattern}|&lt;${rolePattern}&gt;|<${rolePattern}>):(?:\\s|\\r?\\n|$)`),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function stripAgentMetadata(body: string): string {
  return body.replace(/<!--\s*moebius:role=[a-z0-9]+(?:-[a-z0-9]+)*\s*-->/g, "").trimEnd();
}

function stripRoleEnvelope(body: string, role: string): string {
  const escapedRole = escapeRegex(role);
  const pattern = new RegExp(`^(?:${escapedRole}|&lt;${escapedRole}&gt;|<${escapedRole}>):\\s*`);
  return body.replace(pattern, "").trim();
}

function buildFullPrompt(agentMarkdown: string, timeline: TimelineMessage[]): string {
  return `${agentMarkdown.trimEnd()}

你正在参与一个 GitHub Issue 共享时间线。请基于你的角色设定和公开时间线继续回复。
消息格式为 #<index> <speaker>: 后接正文。你的最终回复会由 runner 使用 <role>: 可见前缀写回 GitHub。

当前共享时间线：
${formatTimelineMessages(timeline)}`;
}

function buildDeltaPrompt(role: string, deltaMessages: TimelineMessage[]): string {
  return `以下是共享 GitHub Issue 时间线中，你上次处理后新增、且不是你自己 <${role}> 发出的消息。请基于你当前 Codex thread 的既有上下文继续回复。

新增公开消息：
${formatTimelineMessages(deltaMessages)}`;
}

function formatTimelineMessages(messages: TimelineMessage[]): string {
  return messages
    .map((message) => `#${message.index} <${message.speaker}>:\n${message.body.trimEnd()}`)
    .join("\n\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
