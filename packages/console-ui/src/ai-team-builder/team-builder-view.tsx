import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { MarkdownMessage } from "@/console/markdown-message";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  TeamProposalCard,
  type TeamProposalPreview,
} from "./team-proposal-card";

export type TeamBuilderViewPhase =
  | "idle"
  | "running"
  | "clarifying"
  | "proposal"
  | "failed"
  | "committing"
  | "selected";

export interface TeamBuilderViewState {
  phase: TeamBuilderViewPhase;
  builderCli?: "codex" | "kimi" | null;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  proposal: TeamProposalPreview | null;
  proposalRevision: number | null;
  error: null | {
    code: string;
    humanMessage: string;
    canRetry: boolean;
  };
}

export interface TeamBuilderViewProps {
  state: TeamBuilderViewState;
  contextLabel?: string;
  backLabel?: string;
  onBack: () => void;
  onSubmit: (text: string) => void | Promise<void>;
  onAdjust: (text: string) => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onCommit: (revision: number) => void | Promise<void>;
}

export function TeamBuilderView({
  state,
  contextLabel,
  backLabel,
  onBack,
  onSubmit,
  onAdjust,
  onRetry,
  onCommit,
}: TeamBuilderViewProps): JSX.Element {
  const { t } = useI18n();
  const resolvedBackLabel = backLabel ?? t("teamBuilder.back");
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<{
    text: string;
    baseMessageCount: number;
  } | null>(null);
  const localPending = pendingUserMessage !== null;
  const busy = state.phase === "running" || state.phase === "committing" || localPending;
  const canCompose = state.phase === "idle"
    || state.phase === "clarifying"
    || (state.phase === "proposal" && adjusting);
  const showPendingUserMessage = pendingUserMessage !== null
    && state.messages.length <= pendingUserMessage.baseMessageCount;

  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [pendingUserMessage, state.messages, state.phase, state.proposalRevision]);

  useEffect(() => {
    setAdjusting(false);
  }, [state.proposalRevision]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || busy || !canCompose) {
      return;
    }
    setPendingUserMessage({
      text,
      baseMessageCount: state.messages.length,
    });
    setDraft("");
    try {
      if (state.phase === "proposal") {
        await onAdjust(text);
      } else {
        await onSubmit(text);
      }
    } finally {
      setPendingUserMessage(null);
    }
  };

  const startAdjustment = () => {
    setAdjusting(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <section
      className="flex h-[min(720px,calc(100dvh-220px))] min-h-[460px] w-full max-w-[780px] flex-col overflow-hidden rounded-lg border border-line bg-card text-ink"
      data-testid="team-builder-view"
    >
      <header className="grid min-h-[58px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line bg-sunken px-3.5">
        <Button type="button" size="icon" variant="outline" onClick={onBack} aria-label={resolvedBackLabel}>
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-ink">{t("teamBuilder.title")}</h1>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-hint">
            <i className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            {t("teamBuilder.readOnlySession")}
          </span>
        </div>
        {contextLabel ? (
          <span className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-sub">
            {contextLabel}
          </span>
        ) : null}
      </header>

      <div
        ref={threadRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        aria-live="polite"
      >
        {state.messages.map((message, index) => (
          <div
            key={`${message.role}-${String(index)}`}
            className={cn(
              "flex max-w-[88%] items-start gap-2 max-sm:max-w-[96%]",
              message.role === "user" && "self-end",
            )}
          >
            {message.role === "assistant" ? (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent text-accent">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </span>
            ) : null}
            <div
              className={cn(
                "min-w-0 rounded-lg border border-line bg-sunken px-3 py-2",
                message.role === "assistant" ? "rounded-tl-sm" : "rounded-tr-sm border-accent/50 bg-hover",
              )}
            >
              <MarkdownMessage content={message.text} mode="static" />
            </div>
          </div>
        ))}

        {state.proposal !== null && state.proposalRevision !== null ? (
          <TeamProposalCard
            proposal={state.proposal}
            revision={state.proposalRevision}
            readOnly={adjusting || (state.phase !== "proposal" && state.phase !== "committing")}
            committing={state.phase === "committing"}
            onAdjust={startAdjustment}
            onCommit={(revision) => void onCommit(revision)}
          />
        ) : null}

        {showPendingUserMessage ? (
          <div
            className="flex max-w-[88%] self-end items-start gap-2 max-sm:max-w-[96%]"
            data-testid="pending-team-builder-user-message"
          >
            <div className="min-w-0 rounded-lg rounded-tr-sm border border-accent/50 bg-hover px-3 py-2">
              <MarkdownMessage content={pendingUserMessage.text} mode="static" />
            </div>
          </div>
        ) : null}

        {state.phase === "running" || localPending ? (
          <div className="flex max-w-[88%] items-start gap-2" role="status" aria-label={t("teamBuilder.processing")}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent text-accent">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <div className="rounded-lg rounded-tl-sm border border-line bg-sunken px-3 py-2.5">
              <LoaderCircle className="h-4 w-4 animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
              <span className="sr-only">{t("teamBuilder.typing")}</span>
            </div>
          </div>
        ) : null}

        {state.error !== null ? (
          <div className="ml-9 rounded-lg border border-danger/30 bg-card p-3 max-sm:ml-0" role="alert">
            <div className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>{state.error.humanMessage}</span>
            </div>
            {state.error.canRetry ? (
              <Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void onRetry()}>
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                {t("teamBuilder.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <form className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-line bg-canvas p-2.5" onSubmit={submit}>
        <textarea
          ref={composerRef}
          aria-label={adjusting ? t("teamBuilder.adjustLabel") : t("teamBuilder.goalLabel")}
          className="min-h-12 max-h-24 w-full resize-none rounded-md border border-line bg-input px-3 py-2 text-sm leading-5 text-ink outline-none placeholder:text-hint focus:border-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canCompose || busy}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={adjusting
            ? t("teamBuilder.adjustPlaceholder")
            : state.phase === "clarifying"
              ? t("teamBuilder.answerPlaceholder")
              : t("teamBuilder.goalPlaceholder")}
          rows={2}
          value={draft}
        />
        <Button
          type="submit"
          size="icon"
          className="rounded-full"
          aria-label={t("teamBuilder.send")}
          disabled={!canCompose || busy || draft.trim().length === 0}
        >
          <Send className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </form>
    </section>
  );
}
