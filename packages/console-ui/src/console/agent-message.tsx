import { ArrowRight, Check, ChevronRight, Circle, CheckCircle2, Code2, FileText } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/console/markdown-message";
import { translate, useI18n, type Translate, type TranslationKey } from "@/i18n";

export type AgentStage = "in-progress" | "plan-written" | "code-verified";

export interface AgentMessageProps {
  role: string;
  rawMarkdown: string;
  stage?: AgentStage | string | null;
  conclusion?: string | null;
  handoff?: string | null;
  timestamp?: string | null;
  defaultOpen?: boolean;
  className?: string;
  onOpenExternalLink?: (url: string) => void;
}

const roleLabelKeys: Record<string, TranslationKey> = {
  ceo: "console.role.ceo",
  dev: "console.role.dev",
  "dev-manager": "console.role.devManager",
  "hermes-user": "console.role.user",
  "product-manager": "console.role.product",
  qa: "console.role.qa",
  secretary: "console.role.secretary",
  user: "console.common.you",
};

const roleAvatars: Record<string, string> = {
  ceo: "C",
  dev: "D",
  "dev-manager": "T",
  "hermes-user": "U",
  "product-manager": "P",
  qa: "Q",
  secretary: "S",
};

const stageLabelKeys: Record<AgentStage, TranslationKey> = {
  "code-verified": "console.agentMessage.codeVerified",
  "in-progress": "console.agentMessage.inProgress",
  "plan-written": "console.agentMessage.planWritten",
};

export function AgentMessage({
  role,
  rawMarkdown,
  stage,
  conclusion,
  handoff,
  timestamp,
  defaultOpen = false,
  className,
  onOpenExternalLink,
}: AgentMessageProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const parsed = parseAgentMarkdown(rawMarkdown, t);
  const roleLabel = localizeRole(role, t);
  const resolvedStage = nonBlank(stage) ?? parsed.stage;
  const stageLabel = localizeStage(resolvedStage, t);
  const conclusionText = nonBlank(conclusion) ?? parsed.conclusion ?? t("console.agentMessage.noConclusion");
  const handoffText = nonBlank(handoff) ?? parsed.handoff ?? t("console.agentMessage.noNextStep");

  const toggle = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    setOpen((value) => !value);
  };

  return (
    <details className={cn("group border-t border-line text-sm text-sub", className)} open={open}>
      <summary
        className="grid cursor-pointer list-none grid-cols-[32px_minmax(0,1fr)] gap-x-3 rounded-md outline-none transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden"
        aria-expanded={open}
        aria-label={t(open ? "console.agentMessage.collapseRaw" : "console.agentMessage.expandRaw", { role: roleLabel })}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            toggle(event);
          }
        }}
      >
        <span className="relative mt-0.5 h-8 w-8" aria-hidden="true">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ava-bg text-xs font-medium text-ava-fg">
            {roleAvatars[role] ?? "A"}
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-line bg-card text-sub">
            <StageBadgeIcon stage={resolvedStage} />
          </span>
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-medium text-ink">{roleLabel}</span>
            <span className="text-xs font-normal text-sub">{stageLabel}</span>
            <span className="ml-auto flex flex-none items-center gap-2">
              <StageStatusIcon stage={resolvedStage} />
              {timestamp ? <span className="text-xs text-hint tnum">{timestamp}</span> : null}
              <ChevronRight
                className={cn("h-4 w-4 text-hint transition-transform", open ? "rotate-90" : "")}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </span>
          </span>
          <span className="mt-1 block min-w-0 leading-6 text-ink">{conclusionText}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-sub">
            <ArrowRight className="h-3 w-3 flex-none text-hint" strokeWidth={1.5} aria-hidden="true" />
            <span className="min-w-0">{handoffText}</span>
          </span>
        </span>
      </summary>
      <div className="ml-11 mt-3 max-h-96 overflow-auto border-l border-line pl-4 text-xs leading-5 text-ink">
        <MarkdownMessage content={rawMarkdown} mode="static" onOpenExternalLink={onOpenExternalLink} />
      </div>
    </details>
  );
}

function StageBadgeIcon({ stage }: { stage: string | null }): JSX.Element {
  const className = "h-2.5 w-2.5";
  if (stage === "plan-written") {
    return <FileText className={className} strokeWidth={2} />;
  }
  if (stage === "code-verified") {
    return <Check className={className} strokeWidth={2} />;
  }
  return <Code2 className={className} strokeWidth={2} />;
}

function StageStatusIcon({ stage }: { stage: string | null }): JSX.Element {
  if (stage === "plan-written" || stage === "code-verified") {
    return <CheckCircle2 className="h-4 w-4 text-hint" strokeWidth={1.5} aria-hidden="true" />;
  }
  return <Circle className="h-4 w-4 text-hint" strokeWidth={1.5} aria-hidden="true" />;
}

export function parseAgentMarkdown(
  rawMarkdown: string,
  t: Translate = (key, values) => translate("zh-CN", key, values),
): {
  conclusion: string | null;
  stage: AgentStage | null;
  handoff: string | null;
} {
  return {
    conclusion: firstParagraph(extractSection(rawMarkdown, "结论")), // i18n-exempt: structured Agent markdown protocol marker
    stage: extractStage(rawMarkdown),
    handoff: extractHandoff(rawMarkdown, t),
  };
}

function extractSection(markdown: string, title: string): string | null {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start === -1) {
    return null;
  }

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/u.test(line.trim())) {
      break;
    }
    body.push(line);
  }

  return body.join("\n");
}

function firstParagraph(section: string | null): string | null {
  if (!section) {
    return null;
  }

  for (const paragraph of section.split(/\n\s*\n/u)) {
    const text = paragraph.trim().replace(/\s+/gu, " ");
    if (text) {
      return text;
    }
  }

  return null;
}

function extractStage(markdown: string): AgentStage | null {
  const match = markdown.match(/<!--\s*moebius:stage=(in-progress|plan-written|code-verified)\s*-->/u);
  return match ? (match[1] as AgentStage) : null;
}

function extractHandoff(markdown: string, t: Translate): string | null {
  const nextSection = extractSection(markdown, "下一步"); // i18n-exempt: structured Agent markdown protocol marker
  if (!nextSection) {
    return null;
  }

  const line = nextSection
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.startsWith("交棒：") || item.startsWith("等待真人：")); // i18n-exempt: structured Agent markdown protocol marker

  if (!line) {
    return null;
  }

  if (line.startsWith("等待真人：")) { // i18n-exempt: structured Agent markdown protocol marker
    const text = line.slice("等待真人：".length).trim(); // i18n-exempt: structured Agent markdown protocol marker
    return text ? t("console.agentMessage.waitingForYouDetail", { text }) : t("console.agentMessage.waitingForYou");
  }

  const handoff = line.slice("交棒：".length).trim(); // i18n-exempt: structured Agent markdown protocol marker
  const match = handoff.match(/^@([a-z-]+)\s*(.*)$/u);
  if (!match) {
    return t("console.agentMessage.handoffRaw", { text: handoff });
  }

  const target = localizeRole(match[1], t);
  const rest = match[2].trim();
  return rest
    ? t("console.agentMessage.handoffDetail", { target, text: rest })
    : t("console.agentMessage.handoff", { target });
}

function localizeRole(role: string, t: Translate): string {
  const key = roleLabelKeys[role];
  return key === undefined ? t("console.common.collaborator") : t(key);
}

function localizeStage(stage: string | null, t: Translate): string {
  if (stage === "in-progress" || stage === "plan-written" || stage === "code-verified") {
    return t(stageLabelKeys[stage]);
  }

  return t("console.agentMessage.unknownStage");
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
