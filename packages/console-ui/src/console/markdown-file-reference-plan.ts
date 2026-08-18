import { fromMarkdown } from "mdast-util-from-markdown";

/**
 * Markdown 文件引用候选采集（console-ui domain）：与 markdown-internal-reference
 * 渲染插件共享同一套节点语义——绝对路径、行号语法、裸路径形状门槛；mdast 遍历
 * 显式跳过代码块、HTML、图片与转义文本。产出按文档顺序、按路径去重的候选，
 * 供桌面层对 Agent 本地图片引用发起受限源读取。
 */

export interface MarkdownFileReference {
  path: string;
  line: number;
  column: number | null;
  hasExplicitLine: boolean;
}

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
  if (filePath === null || filePath === "/") {
    return null;
  }
  return {
    path: filePath,
    line: located === null ? 1 : Number.parseInt(located[2]!, 10),
    column: located?.[3] === undefined ? null : Number.parseInt(located[3], 10),
    hasExplicitLine: located !== null,
  };
}

export interface BareFileReferenceSpan {
  start: number;
  end: number;
  rawPath: string;
  reference: MarkdownFileReference;
}

/** 裸路径引用扫描核心（domain）：与渲染插件同一门槛，返回原文中的有序 span。 */
export function scanBareFileReferenceSpans(value: string): BareFileReferenceSpan[] {
  const spans: BareFileReferenceSpan[] = [];
  let search = 0;
  while (search < value.length) {
    const start = value.indexOf("/", search);
    if (start < 0) {
      break;
    }
    const tier = barePathTier(value, start);
    if (tier === null) {
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
    if (reference === null || !passesBarePathShapeGate(tier, reference)) {
      search = start + 1;
      continue;
    }
    spans.push({ start, end, rawPath, reference });
    search = Math.max(end, start + 1);
  }
  return spans;
}

/**
 * 有序、去重的本地文件引用候选（domain）：只从最终消息正文的节点语义提取，
 * 不识别代码块、HTML、图片、转义文本或远程 URL。
 */
export function collectMarkdownFileReferenceCandidates(markdown: string): MarkdownFileReference[] {
  const tree = fromMarkdown(markdown);
  const definitions = collectDefinitions(tree);
  const seen = new Set<string>();
  const candidates: MarkdownFileReference[] = [];
  walk(tree, (node) => {
    if (node.type === "link") {
      pushUnique(parseMarkdownFileReference(node.url));
      return "stop";
    }
    if (node.type === "linkReference" && typeof node.identifier === "string") {
      const definition = definitions.get(normalizeIdentifier(node.identifier));
      pushUnique(definition?.url === undefined ? null : parseMarkdownFileReference(definition.url));
      return "stop";
    }
    if (node.type === "inlineCode" && typeof node.value === "string") {
      pushUnique(parseMarkdownFileReference(node.value));
      return "stop";
    }
    if (node.type === "text" && typeof node.value === "string") {
      for (const span of scanBareFileReferenceSpans(node.value)) {
        pushUnique(span.reference);
      }
    }
    return undefined;
  });
  return candidates;

  function pushUnique(reference: MarkdownFileReference | null): void {
    if (reference === null || seen.has(reference.path)) {
      return;
    }
    seen.add(reference.path);
    candidates.push(reference);
  }
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
  identifier?: string;
  title?: string | null;
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => "stop" | void): void {
  if (
    node.type === "code"
    || node.type === "html"
    || node.type === "image"
    || node.type === "imageReference"
    || node.type === "definition"
  ) {
    return;
  }
  if (visit(node) === "stop") {
    return;
  }
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

function collectDefinitions(tree: MarkdownNode): Map<string, MarkdownNode> {
  const definitions = new Map<string, MarkdownNode>();
  const pending: MarkdownNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === "definition" && typeof node.identifier === "string" && typeof node.url === "string") {
      definitions.set(normalizeIdentifier(node.identifier), node);
    }
    pending.push(...(node.children ?? []));
  }
  return definitions;
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/gu, " ").toLowerCase();
}

const BARE_PATH_CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const BARE_PATH_FULLWIDTH_PUNCTUATION = /[\u3000-\u303f\uFF01-\uFF5E\u2018-\u201f]/u;
const BARE_PATH_LATIN_SEGMENT = /[A-Za-z]/u;
const BARE_PATH_EXTENSION = /\.[A-Za-z0-9]{1,8}$/u;

type BarePathTier = "loose" | "strict";

function barePathTier(value: string, index: number): BarePathTier | null {
  if (value[index] !== "/" || value[index + 1] === "/") {
    return null;
  }
  if (index === 0) {
    return "loose";
  }
  const previous = value[index - 1]!;
  if (
    previous === ":"
    || previous === "/"
    || previous === "~"
    || /[A-Za-z0-9_.-]/u.test(previous)
  ) {
    return null;
  }
  if (/\s/u.test(previous)) {
    return "loose";
  }
  if (
    BARE_PATH_CJK_SCRIPT.test(previous)
    || BARE_PATH_FULLWIDTH_PUNCTUATION.test(previous)
  ) {
    return "strict";
  }
  return "loose";
}

function passesBarePathShapeGate(tier: BarePathTier, reference: MarkdownFileReference): boolean {
  const segments = reference.path.split("/");
  if (tier === "loose") {
    return segments.some((segment) => BARE_PATH_LATIN_SEGMENT.test(segment));
  }
  if (reference.hasExplicitLine) {
    return true;
  }
  const lastSegment = segments[segments.length - 1] ?? "";
  return BARE_PATH_EXTENSION.test(lastSegment);
}

function isBarePathTerminator(value: string): boolean {
  return /\s|[`<>\\"'“”‘’，。；！？、：,;!?（）「」【】]/u.test(value);
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
