/**
 * Splits an `AGENT.md` into its YAML frontmatter and its body.
 *
 * Only the body is ever rendered or edited on this page: identity lives in form fields, and
 * markdown has no concept of frontmatter — `display_name: 开发经理` followed by `---` is a setext
 * heading, so rendering the raw file turns the metadata block into a giant title.
 *
 * This deliberately only *splits*; it does not parse the YAML. The host owns file semantics and
 * already hands identity down as fields, so a parser here would be a second, divergent source of
 * truth. Mirrors the delimiter handling of the root `agent-frontmatter.ts`.
 */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)([\s\S]*)$/mu;

export interface SplitAgentMarkdown {
  /** Raw frontmatter text without the delimiters, or null when the file has none. */
  frontmatter: string | null;
  body: string;
}

export function splitAgentMarkdown(markdown: string): SplitAgentMarkdown {
  const normalized = markdown.replace(/^﻿/u, "");
  const match = normalized.match(FRONTMATTER);
  if (match === null) {
    return { frontmatter: null, body: normalized };
  }
  return {
    frontmatter: (match[1] ?? "").replace(/\r?\n$/u, ""),
    body: (match[2] ?? "").replace(/^\r?\n/u, ""),
  };
}

/**
 * Puts an edited body back with the frontmatter it came with, so editing the persona can never
 * drop or reshape identity. A file that never had frontmatter stays that way.
 */
export function withAgentMarkdownBody(original: string, body: string): string {
  const { frontmatter } = splitAgentMarkdown(original);
  if (frontmatter === null) {
    return body;
  }
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\r?\n/u, "")}`;
}
