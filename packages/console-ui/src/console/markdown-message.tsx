import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { ExternalLink } from "lucide-react";
import { harden } from "rehype-harden";
import { useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  type StreamdownProps,
} from "streamdown";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  createMarkdownInternalReferencePlugin,
  readMarkdownInternalIntent,
  releaseMarkdownInternalIntentRegistry,
  retainMarkdownInternalIntentRegistry,
  type MarkdownFileReference,
  type MarkdownConversationReference,
  type MarkdownMemberIdentity,
} from "@/console/markdown-internal-reference";

export interface MarkdownMessageProps {
  content: string;
  mode?: "static" | "streaming";
  density?: "conversation" | "live";
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenConversationReference?: (reference: MarkdownConversationReference) => void;
  memberIdentities?: readonly MarkdownMemberIdentity[];
  onOpenTeamMember?: (slug: string) => void;
  className?: string;
  caretStyle?: "default" | "thin";
}

const math = createMathPlugin({ singleDollarTextMath: false, errorColor: "var(--sub)" });
const mermaid = createMermaidPlugin({ config: { securityLevel: "strict" } });
const markdownPlugins = { code, cjk, math, mermaid };
const secureRehypePlugins: NonNullable<StreamdownProps["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [harden, {
    allowedLinkPrefixes: ["*"],
    allowedImagePrefixes: ["*"],
    allowDataImages: false,
    linkBlockPolicy: "text-only",
    imageBlockPolicy: "text-only",
  }],
];

export function MarkdownMessage({
  content,
  mode = "static",
  density = "conversation",
  onOpenExternalLink,
  onOpenFileReference,
  onOpenConversationReference,
  memberIdentities = [],
  onOpenTeamMember,
  className,
  caretStyle = "default",
}: MarkdownMessageProps): JSX.Element {
  const [intentKey] = useState(createMarkdownIntentKey);
  useEffect(() => {
    retainMarkdownInternalIntentRegistry(intentKey);
    return () => releaseMarkdownInternalIntentRegistry(intentKey);
  }, [intentKey]);
  const components = useMemo<NonNullable<StreamdownProps["components"]>>(() => ({
    a: (props) => (
      <SafeMarkdownLink
        {...props}
        intentKey={intentKey}
        onOpenExternalLink={onOpenExternalLink}
        onOpenFileReference={onOpenFileReference}
        onOpenConversationReference={onOpenConversationReference}
        onOpenTeamMember={onOpenTeamMember}
      />
    ),
  }), [intentKey, onOpenConversationReference, onOpenExternalLink, onOpenFileReference, onOpenTeamMember]);
  const remarkPlugins = useMemo<NonNullable<StreamdownProps["remarkPlugins"]>>(
    () => [
      ...Object.values(defaultRemarkPlugins),
      createMarkdownInternalReferencePlugin(
        memberIdentities,
        intentKey,
      ),
    ],
    [intentKey, memberIdentities],
  );
  const streaming = mode === "streaming";

  return (
    <Streamdown
      key={mode === "streaming" ? content : "static"}
      className={cn(
        "markdown-message min-w-0 max-w-full text-ink",
        density === "live" ? "text-sm text-sub" : "text-sm leading-6",
        caretStyle === "thin" && [
          "[&>:last-child::after]:!content-none",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:ml-[3px]",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:inline-block",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:h-[0.9em]",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:w-px",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:bg-current",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:align-[-0.08em]",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:opacity-65",
          "[&>:last-child>p:last-child_[data-sd-animate]:last-child::after]:content-['']",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:ml-[3px]",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:inline-block",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:h-[0.9em]",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:w-px",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:bg-current",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:align-[-0.08em]",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:opacity-65",
          "[&>:last-child>ul:last-child>li:last-child_[data-sd-animate]:last-child::after]:content-['']",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:ml-[3px]",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:inline-block",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:h-[0.9em]",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:w-px",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:bg-current",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:align-[-0.08em]",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:opacity-65",
          "[&>:last-child>:is(h1,h2,h3):last-child_[data-sd-animate]:last-child::after]:content-['']",
        ],
        className,
      )}
      components={components}
      controls={{
        table: { copy: true, download: true, fullscreen: true },
        code: { copy: true, download: true },
        mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
      }}
      dir="auto"
      isAnimating={streaming}
      animated={streaming ? { animation: "fadeIn", duration: 120, sep: "word", stagger: 4 } : false}
      caret={streaming ? "block" : undefined}
      linkSafety={{ enabled: false }}
      mermaid={{ config: { securityLevel: "strict" } }}
      mode={mode}
      normalizeHtmlIndentation
      parseIncompleteMarkdown={false}
      plugins={markdownPlugins}
      rehypePlugins={secureRehypePlugins}
      remarkPlugins={remarkPlugins}
      urlTransform={safeMarkdownUrlTransform}
    >
      {content}
    </Streamdown>
  );
}

type SafeMarkdownLinkProps = ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
  intentKey: string;
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenConversationReference?: (reference: MarkdownConversationReference) => void;
  onOpenTeamMember?: (slug: string) => void;
};

function SafeMarkdownLink({
  children,
  href,
  node: _node,
  intentKey,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenConversationReference,
  onOpenTeamMember,
}: SafeMarkdownLinkProps): JSX.Element {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const intent = readMarkdownInternalIntent(href, intentKey);
  const fileReference = intent.fileReference;
  const memberSlug = intent.memberSlug;
  const conversationReference = intent.conversationReference;
  const safeUrl = normalizeMarkdownUrl(href, "link");

  if (fileReference !== null) {
    return onOpenFileReference === undefined
      ? <span className="break-words text-sub underline decoration-dotted">{children}</span>
      : (
          <button
            type="button"
            className="inline break-words text-left font-normal text-accent underline"
            onClick={() => onOpenFileReference(fileReference)}
          >
            {children}
          </button>
        );
  }
  if (conversationReference !== null) {
    return onOpenConversationReference === undefined
      ? <span className="break-words text-sub underline decoration-dotted">{children}</span>
      : (
          <button
            type="button"
            className="inline break-words text-left font-normal text-accent underline"
            onClick={() => onOpenConversationReference(conversationReference)}
          >
            {children}
          </button>
        );
  }
  if (memberSlug !== null) {
    return onOpenTeamMember === undefined
      ? <span className="font-normal text-accent">{children}</span>
      : (
          <button
            type="button"
            className="inline rounded-sm font-normal text-accent underline decoration-dotted underline-offset-2 hover:text-accent-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            onClick={() => onOpenTeamMember(memberSlug)}
          >
            {children}
          </button>
        );
  }
  if (safeUrl?.startsWith("#")) {
    return <a className="font-normal text-accent underline" href={safeUrl}>{children}</a>;
  }
  if (safeUrl === null || onOpenExternalLink === undefined) {
    return <span className="break-words text-sub underline decoration-dotted">{children}</span>;
  }

  return (
    <span className="relative inline">
      <button
        type="button"
        className="inline break-words text-left font-normal text-accent underline"
        onClick={() => setConfirming(true)}
      >
        {children}
      </button>
      {confirming ? (
        <span
          role="dialog"
          aria-label={t("console.markdown.confirmExternal")}
          className="absolute left-0 top-full z-30 mt-2 block w-[min(360px,80vw)] rounded-md border border-line bg-sunken p-3 text-left text-xs font-normal text-ink"
        >
          <span className="block break-all text-sub">{safeUrl}</span>
          <span className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t("console.common.cancel")}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                setConfirming(false);
                onOpenExternalLink(safeUrl);
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {t("console.markdown.openLink")}
            </Button>
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function safeMarkdownUrlTransform(url: string, key: string): string | null {
  if (key === "href" && url.startsWith("#")) {
    return /^#[A-Za-z][\w:.-]*$/u.test(url) ? url : null;
  }
  if (key === "href") {
    return normalizeMarkdownUrl(url, "link");
  }
  return normalizeMarkdownUrl(url, key === "src" ? "image" : key === "href" ? "link" : "unsupported");
}

function createMarkdownIntentKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `markdown-intent-${Math.random().toString(36).slice(2)}`;
}

function normalizeMarkdownUrl(
  value: string | null | undefined,
  kind: "link" | "image" | "unsupported",
): string | null {
  if (typeof value !== "string" || value.trim() === "" || kind === "unsupported") {
    return null;
  }
  if (kind === "link" && value.startsWith("#")) {
    return /^#[A-Za-z][\w:.-]*$/u.test(value) ? value : null;
  }
  try {
    const url = new URL(value);
    const allowed = kind === "image"
      ? url.protocol === "http:" || url.protocol === "https:"
      : url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}
