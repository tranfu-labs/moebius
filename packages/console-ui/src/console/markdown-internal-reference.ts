import {
  sanitizeMachineTextFragment,
  type MachineTextPlaceholders,
} from "./machine-text";

export interface MarkdownFileReference {
  path: string;
  line: number;
  column: number | null;
}

export interface MarkdownMemberIdentity {
  slug: string;
  displayName: string;
}

export interface MarkdownInternalIntent {
  fileReference: MarkdownFileReference | null;
  memberSlug: string | null;
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
  machineText: MachineTextPlaceholders,
): [typeof markdownInternalReferencePlugin, MarkdownInternalReferencePluginOptions] {
  return [markdownInternalReferencePlugin, {
    identities: identities.map((identity) => ({ ...identity })),
    intentKey,
    machineText,
  }];
}

export function readMarkdownInternalIntent(
  href: string | null | undefined,
  expectedIntentKey: string,
): MarkdownInternalIntent {
  return typeof href === "string"
    ? intentRegistries.get(expectedIntentKey)?.get(href)
      ?? { fileReference: null, memberSlug: null }
    : { fileReference: null, memberSlug: null };
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
  machineText: MachineTextPlaceholders;
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
    transformNode(tree, known, definitions, context, options.machineText);
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
  machineText: MachineTextPlaceholders,
): void {
  if (node.type === "definition") {
    if (typeof node.title === "string") {
      node.title = sanitizeMachineTextFragment(node.title, machineText);
    }
    return;
  }
  if (node.type === "code" || node.type === "inlineCode" || node.type === "html") {
    if (typeof node.value === "string") {
      node.value = sanitizeMachineTextFragment(node.value, machineText);
    }
    return;
  }
  if (node.type === "image" || node.type === "imageReference") {
    if (typeof node.alt === "string") {
      node.alt = sanitizeMachineTextFragment(node.alt, machineText);
    }
    if (typeof node.title === "string") {
      node.title = sanitizeMachineTextFragment(node.title, machineText);
    }
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
    if (typeof node.title === "string") {
      node.title = sanitizeMachineTextFragment(node.title, machineText);
    }
    const reference = parseMarkdownFileReference(node.url);
    if (reference !== null) {
      node.url = registerIntent(context, {
        fileReference: reference,
        memberSlug: null,
      });
    }
    sanitizeVisibleChildren(node, machineText);
    return;
  }
  if (!Array.isArray(node.children)) {
    return;
  }
  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const sanitized = sanitizeMachineTextFragment(child.value, machineText);
      nextChildren.push(...mentionNodes(sanitized, known, context));
      continue;
    }
    transformNode(child, known, definitions, context, machineText);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

function sanitizeVisibleChildren(
  node: MarkdownNode,
  machineText: MachineTextPlaceholders,
): void {
  visit(node, (child) => {
    if (
      child !== node
      && child.type !== "definition"
      && typeof child.value === "string"
    ) {
      child.value = sanitizeMachineTextFragment(child.value, machineText);
    }
  });
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
