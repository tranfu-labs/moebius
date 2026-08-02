export interface AgentMention {
  name: string;
  index: number;
}

export interface TimelineComment {
  body: string;
}

export type TimelineSource = "initial-message" | "message";

export interface TimelineMessage {
  index: number;
  speaker: string;
  body: string;
  source: TimelineSource;
}

export function buildTimeline(
  initialMessage: string,
  messages: TimelineComment[],
  availableAgentNames: string[],
): TimelineMessage[] {
  return [
    {
      index: 0,
      speaker: "user",
      body: initialMessage,
      source: "initial-message",
    },
    ...messages.map((message, messageIndex) => {
      const normalized = normalizeComment(message.body, availableAgentNames);
      return {
        index: messageIndex + 1,
        source: "message" as const,
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

export function selectMentionedAgent(text: string, availableAgentNames: string[]): string | null {
  const availableAgents = new Set(availableAgentNames);

  for (const mention of parseAgentMentions(text)) {
    if (availableAgents.has(mention.name)) return mention.name;
  }

  return null;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
