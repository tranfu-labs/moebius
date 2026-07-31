export interface MarkdownFileReference {
  path: string;
  line: number;
  column: number | null;
}

export interface MarkdownMemberIdentity {
  slug: string;
  displayName: string;
}

export type MarkdownConversationReference =
  | { scope: "conversation"; sessionId: string }
  | { scope: "message"; sessionId: string; messageId: number };

export interface MarkdownInternalIntent {
  fileReference: MarkdownFileReference | null;
  memberSlug: string | null;
  conversationReference: MarkdownConversationReference | null;
}

const MEMBER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MEMBER_MENTION_PATTERN = /(^|[^A-Za-z0-9_-])@([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/gu;
const intentRegistries = new Map<string, Map<string, MarkdownInternalIntent>>();
const intentRegistryCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function parseMarkdownFileReference(value: string | null | undefined): MarkdownFileReference | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const unwrapped = value.startsWith("<") && value.endsWith(">")
    ? value.slice(1, -1)
    : value;
  let decoded: string;
  try {
    decoded = decodeURI(unwrapped);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0") || /[\r\n]/u.test(decoded)) {
    return null;
  }

  const located = /^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/u.exec(decoded);
  const filePath = normalizeAbsolutePosixPath(located?.[1] ?? decoded);
  if (filePath === null) {
    return null;
  }
  return {
    path: filePath,
    line: located === null ? 1 : Number.parseInt(located[2]!, 10),
    column: located?.[3] === undefined ? null : Number.parseInt(located[3], 10),
  };
}

export function createMarkdownInternalReferencePlugin(
  identities: readonly MarkdownMemberIdentity[],
  intentKey: string,
): [typeof markdownInternalReferencePlugin, MarkdownInternalReferencePluginOptions] {
  return [markdownInternalReferencePlugin, {
    identities: identities.map((identity) => ({ ...identity })),
    intentKey,
  }];
}

export function readMarkdownInternalIntent(
  href: string | null | undefined,
  expectedIntentKey: string,
): MarkdownInternalIntent {
  return typeof href === "string"
    ? intentRegistries.get(expectedIntentKey)?.get(href)
      ?? { fileReference: null, memberSlug: null, conversationReference: null }
    : { fileReference: null, memberSlug: null, conversationReference: null };
}

export function releaseMarkdownInternalIntentRegistry(intentKey: string): void {
  const existing = intentRegistryCleanupTimers.get(intentKey);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  intentRegistryCleanupTimers.set(intentKey, setTimeout(() => {
    intentRegistryCleanupTimers.delete(intentKey);
    intentRegistries.delete(intentKey);
  }, 0));
}

export function retainMarkdownInternalIntentRegistry(intentKey: string): void {
  const cleanupTimer = intentRegistryCleanupTimers.get(intentKey);
  if (cleanupTimer !== undefined) {
    clearTimeout(cleanupTimer);
    intentRegistryCleanupTimers.delete(intentKey);
  }
}

interface MarkdownInternalReferencePluginOptions {
  identities: MarkdownMemberIdentity[];
  intentKey: string;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
  title?: string | null;
  alt?: string;
  identifier?: string;
  label?: string;
  referenceType?: string;
  data?: {
    hProperties?: Record<string, string>;
  };
}

function markdownInternalReferencePlugin(
  options: MarkdownInternalReferencePluginOptions,
): (tree: MarkdownNode) => void {
  const known = new Map(
    options.identities
      .filter((identity) => MEMBER_SLUG_PATTERN.test(identity.slug))
      .map((identity) => [identity.slug, identity]),
  );
  return (tree) => {
    const context: MarkdownIntentContext = {
      intentKey: options.intentKey,
      intents: new Map(),
      nextIntentId: 0,
    };
    intentRegistries.set(options.intentKey, context.intents);
    const definitions = collectDefinitions(tree);
    transformNode(tree, known, definitions, context);
  };
}

interface MarkdownIntentContext {
  intentKey: string;
  intents: Map<string, MarkdownInternalIntent>;
  nextIntentId: number;
}

function collectDefinitions(tree: MarkdownNode): Map<string, MarkdownNode> {
  const definitions = new Map<string, MarkdownNode>();
  visit(tree, (node) => {
    if (node.type === "definition" && typeof node.identifier === "string" && typeof node.url === "string") {
      definitions.set(normalizeIdentifier(node.identifier), node);
    }
  });
  return definitions;
}

function transformNode(
  node: MarkdownNode,
  known: ReadonlyMap<string, MarkdownMemberIdentity>,
  definitions: ReadonlyMap<string, MarkdownNode>,
  context: MarkdownIntentContext,
): void {
  if (node.type === "definition") {
    return;
  }
  if (node.type === "inlineCode" && typeof node.value === "string") {
    const reference = parseMarkdownFileReference(node.value);
    if (reference !== null) {
      const value = node.value;
      node.type = "link";
      node.url = registerIntent(context, {
        fileReference: reference,
        memberSlug: null,
        conversationReference: null,
      });
      node.children = [{ type: "inlineCode", value }];
      delete node.value;
    }
    return;
  }
  if (node.type === "code" || node.type === "html") {
    return;
  }
  if (node.type === "image" || node.type === "imageReference") {
    return;
  }
  if (node.type === "linkReference" && typeof node.identifier === "string") {
    const definition = definitions.get(normalizeIdentifier(node.identifier));
    if (definition !== undefined && typeof definition.url === "string") {
      node.type = "link";
      node.url = definition.url;
      node.title = definition.title;
      delete node.identifier;
      delete node.label;
      delete node.referenceType;
    }
  }
  if (node.type === "link") {
    const conversationReference = parseMarkdownConversationReference(node.url);
    const reference = parseMarkdownFileReference(node.url);
    if (conversationReference !== null) {
      node.url = registerIntent(context, {
        fileReference: null,
        memberSlug: null,
        conversationReference,
      });
    } else if (reference !== null) {
      node.url = registerIntent(context, {
        fileReference: reference,
        memberSlug: null,
        conversationReference: null,
      });
    }
    return;
  }
  if (!Array.isArray(node.children)) {
    return;
  }
  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      nextChildren.push(...textIntentNodes(child.value, known, context));
      continue;
    }
    transformNode(child, known, definitions, context);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

function textIntentNodes(
  value: string,
  known: ReadonlyMap<string, MarkdownMemberIdentity>,
  context: MarkdownIntentContext,
): MarkdownNode[] {
  return bareFileReferenceNodes(value, context).flatMap((node) =>
    node.type === "text" && typeof node.value === "string"
      ? mentionNodes(node.value, known, context)
      : [node]);
}

function bareFileReferenceNodes(
  value: string,
  context: MarkdownIntentContext,
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  let search = 0;
  while (search < value.length) {
    const start = value.indexOf("/", search);
    if (start < 0) {
      break;
    }
    if (!isBarePathStart(value, start)) {
      search = start + 1;
      continue;
    }
    let rawEnd = start + 1;
    while (rawEnd < value.length && !isBarePathTerminator(value[rawEnd]!)) {
      rawEnd += 1;
    }
    const end = trimBarePathEnd(value, start, rawEnd);
    const rawPath = value.slice(start, end);
    const reference = parseMarkdownFileReference(rawPath);
    if (reference === null) {
      search = start + 1;
      continue;
    }
    if (start > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, start) });
    }
    nodes.push({
      type: "link",
      url: registerIntent(context, {
        fileReference: reference,
        memberSlug: null,
        conversationReference: null,
      }),
      children: [{ type: "text", value: rawPath }],
    });
    cursor = end;
    search = Math.max(end, start + 1);
  }
  if (cursor === 0) {
    return [{ type: "text", value }];
  }
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

function isBarePathStart(value: string, index: number): boolean {
  if (value[index] !== "/" || value[index + 1] === "/") {
    return false;
  }
  if (index === 0) {
    return true;
  }
  const previous = value[index - 1]!;
  return previous !== ":" && previous !== "/" && !/[A-Za-z0-9_.-]/u.test(previous);
}

function isBarePathTerminator(value: string): boolean {
  return /\s|[`<>"'“”‘’，。；！？、：,;!?]/u.test(value);
}

function trimBarePathEnd(value: string, start: number, rawEnd: number): number {
  let end = rawEnd;
  while (end > start + 1 && /[,.;!?，。；！？、：]/u.test(value[end - 1]!)) {
    end -= 1;
  }
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["（", "）"],
  ];
  let changed = true;
  while (changed && end > start + 1) {
    changed = false;
    for (const [opening, closing] of pairs) {
      if (
        value[end - 1] === closing
        && countCharacter(value, opening, start, end) < countCharacter(value, closing, start, end)
      ) {
        end -= closing.length;
        changed = true;
        break;
      }
    }
  }
  return end;
}

function countCharacter(value: string, target: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    if (value[index] === target) {
      count += 1;
    }
  }
  return count;
}

function mentionNodes(
  value: string,
  known: ReadonlyMap<string, MarkdownMemberIdentity>,
  context: MarkdownIntentContext,
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(MEMBER_MENTION_PATTERN)) {
    const identity = known.get(match[2]!);
    if (identity === undefined || match.index === undefined) {
      continue;
    }
    const mentionStart = match.index + match[1]!.length;
    if (mentionStart > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, mentionStart) });
    }
    nodes.push({
      type: "link",
      url: registerIntent(context, {
        fileReference: null,
        memberSlug: identity.slug,
        conversationReference: null,
      }),
      children: [{ type: "text", value: `@${identity.displayName}` }],
    });
    cursor = match.index + match[0].length;
  }
  if (cursor === 0) {
    return [{ type: "text", value }];
  }
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

export function parseMarkdownConversationReference(
  value: string | null | undefined,
): MarkdownConversationReference | null {
  if (typeof value !== "string") return null;
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

function registerIntent(
  context: MarkdownIntentContext,
  intent: MarkdownInternalIntent,
): string {
  const href = `#moebius-intent-${context.intentKey}-${String(context.nextIntentId)}`;
  context.nextIntentId += 1;
  context.intents.set(href, intent);
  return href;
}

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeAbsolutePosixPath(value: string): string | null {
  if (!value.startsWith("/")) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}
