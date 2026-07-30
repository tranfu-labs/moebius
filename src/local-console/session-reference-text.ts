import { fromMarkdown } from "mdast-util-from-markdown";

import type { LocalConsoleSessionReferenceScope } from "./types.js";

export interface SessionReferenceExecutionLink {
  runId: string;
  engine: "codex" | "claude" | "kimi";
  externalSessionId: string;
}

export type MoebiusReference =
  | { scope: "conversation"; sessionId: string }
  | { scope: "message"; sessionId: string; messageId: number };

interface MarkdownReferenceNode {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownReferenceNode[];
}

export function buildMoebiusReferenceText(input:
  | { scope: "conversation"; sessionId: string; title: string }
  | { scope: "message"; sessionId: string; messageId: number; role: string; excerpt: string }
): string {
  const encodedSessionId = encodeURIComponent(input.sessionId);
  if (input.scope === "conversation") {
    return `[对话 · “${escapeMarkdownLabel(input.title)}”](moebius-ref:conversation/${encodedSessionId})`;
  }
  return `[消息 · ${escapeMarkdownLabel(input.role)} · “${escapeMarkdownLabel(input.excerpt)}”](moebius-ref:message/${encodedSessionId}/${String(input.messageId)})`;
}

export function serializeTextFragmentReferences(
  body: string,
  fragments: readonly { text: string }[],
): string {
  if (fragments.length === 0) return body.trim();
  const lines = fragments.map((fragment) => `> - ${fragment.text.trim()}`);
  return [`> 来源：`, ...lines, "", body.trim()].join("\n").trim();
}

export function extractMoebiusReferences(markdown: string): MoebiusReference[] {
  const tree = fromMarkdown(markdown) as MarkdownReferenceNode;
  const definitions = new Map<string, string>();
  visitMarkdownReferenceNodes(tree, (node) => {
    if (
      node.type === "definition"
      && typeof node.identifier === "string"
      && typeof node.url === "string"
    ) {
      definitions.set(normalizeMarkdownIdentifier(node.identifier), node.url);
    }
  });

  const references: MoebiusReference[] = [];
  visitMarkdownReferenceNodes(tree, (node) => {
    const url = node.type === "link"
      ? node.url
      : node.type === "linkReference" && typeof node.identifier === "string"
        ? definitions.get(normalizeMarkdownIdentifier(node.identifier))
        : undefined;
    if (url !== undefined) {
      const reference = parseMoebiusReferenceUrl(url);
      if (reference !== null) {
        references.push(reference);
      }
    }
  });
  return references;
}

function parseMoebiusReferenceUrl(value: string): MoebiusReference | null {
  const match = /^moebius-ref:(conversation|message)\/([^/\s]+)(?:\/([1-9]\d*))?$/u.exec(value);
  if (match === null) return null;
  let sessionId: string;
  try {
    sessionId = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  if (sessionId === "" || /[\r\n\0]/u.test(sessionId)) return null;
  if (match[1] === "conversation" && match[3] === undefined) {
    return { scope: "conversation", sessionId };
  }
  if (match[1] === "message" && match[3] !== undefined) {
    const messageId = Number.parseInt(match[3], 10);
    return Number.isSafeInteger(messageId) && messageId > 0
      ? { scope: "message", sessionId, messageId }
      : null;
  }
  return null;
}

function visitMarkdownReferenceNodes(
  node: MarkdownReferenceNode,
  callback: (node: MarkdownReferenceNode) => void,
): void {
  callback(node);
  for (const child of node.children ?? []) {
    visitMarkdownReferenceNodes(child, callback);
  }
}

function normalizeMarkdownIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function plainTextExcerpt(value: string, maxLength = 80): string {
  const withoutSourceBlock = value.replace(
    /^(?:>\s*来源：\s*\n(?:>\s*-\s*.*\n)+\s*)/u,
    "",
  );
  const text = withoutSourceBlock
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]*>/gu, " ")
    .replace(/[`*_~>#|]/gu, " ")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() || "无文字消息";
  const segments = [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(text)]
    .map((segment) => segment.segment);
  return segments.length <= maxLength
    ? text
    : `${segments.slice(0, maxLength).join("")}…`;
}

function escapeMarkdownLabel(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/([\[\]()`*_<>])/gu, "\\$1")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildSessionReferenceText(input: {
  scope: LocalConsoleSessionReferenceScope;
  logPath: string;
  runId: string | null;
  links: readonly SessionReferenceExecutionLink[];
}): string {
  const recordText = `Moebius 会话记录：${input.logPath}`;
  if (input.scope === "conversation") {
    return recordText;
  }
  const matchingLink = input.runId === null
    ? null
    : [...input.links].reverse().find((link) => link.runId === input.runId) ?? null;
  if (matchingLink === null) {
    return `${recordText}；外部执行：未建立`;
  }
  const engine = matchingLink.engine === "kimi"
    ? "Kimi"
    : matchingLink.engine === "claude"
      ? "Claude"
      : "Codex";
  return `${recordText}；外部执行：${engine} ${matchingLink.externalSessionId}`;
}
