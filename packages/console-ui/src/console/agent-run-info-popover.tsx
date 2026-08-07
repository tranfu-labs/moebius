import { FileText, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { AgentPortrait } from "@/console/agent-portrait";
import { useI18n, type Translate } from "@/i18n";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

export interface AgentRunInfoView {
  sessionId: string;
  runId: string;
  role: string;
  agent: { slug: string; displayName: string | null; description: string | null };
  team: { name: string | null; ownership: "system" | "user" | null; sourceName: string | null };
  profile: { cli: "codex" | "claude" | "kimi"; model: string; effort: string } | null;
  loadedAt: string | null;
  evidence: "executed" | "planned-not-started" | "bound-start-unknown";
}

type LoadState<T> = { status: "idle" | "loading" } | { status: "ready"; value: T } | { status: "error" };

export function AgentRunInfoPopover({ sessionId, runId, role, displayName, loadInfo, loadMarkdown }: {
  sessionId: string;
  runId: string;
  role: string;
  displayName: string;
  loadInfo(input: { sessionId: string; runId: string; signal: AbortSignal }): Promise<AgentRunInfoView>;
  loadMarkdown(input: { sessionId: string; runId: string; signal: AbortSignal }): Promise<{ markdown: string }>;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [info, setInfo] = useState<LoadState<AgentRunInfoView>>({ status: "idle" });
  const [markdown, setMarkdown] = useState<LoadState<string>>({ status: "idle" });
  const infoLoader = useRef(loadInfo);
  const markdownLoader = useRef(loadMarkdown);
  const avatarTrigger = useRef<HTMLButtonElement>(null);
  const markdownTrigger = useRef<HTMLButtonElement>(null);
  const dialogOpenRef = useRef(false);
  infoLoader.current = loadInfo;
  markdownLoader.current = loadMarkdown;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setInfo({ status: "loading" });
    void infoLoader.current({ sessionId, runId, signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setInfo({ status: "ready", value }); })
      .catch(() => { if (!controller.signal.aborted) setInfo({ status: "error" }); });
    return () => controller.abort();
  }, [open, retry, runId, sessionId]);

  useEffect(() => {
    if (!dialogOpen) return;
    const controller = new AbortController();
    setMarkdown({ status: "loading" });
    void markdownLoader.current({ sessionId, runId, signal: controller.signal })
      .then(({ markdown: value }) => { if (!controller.signal.aborted) setMarkdown({ status: "ready", value }); })
      .catch(() => { if (!controller.signal.aborted) setMarkdown({ status: "error" }); });
    return () => controller.abort();
  }, [dialogOpen, retry, runId, sessionId]);

  useLayoutEffect(() => {
    if (!dialogOpen) return;
    const closeDialogBeforePopover = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dialogOpenRef.current = false;
      setDialogOpen(false);
    };
    window.addEventListener("keydown", closeDialogBeforePopover, true);
    return () => window.removeEventListener("keydown", closeDialogBeforePopover, true);
  }, [dialogOpen]);

  return (
    <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && dialogOpenRef.current) return;
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={avatarTrigger}
            type="button"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={t("console.agentRunInfo.view", { name: displayName })}
          >
            {/* The run's engine only arrives with the popover payload, so the badge appears
                once loaded rather than being threaded in separately. */}
            <AgentPortrait
              displayName={displayName}
              slug={role}
              engine={info.status === "ready" && info.value.profile !== null
                ? { cli: info.value.profile.cli }
                : undefined}
              className="h-6 w-6"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          collisionPadding={12}
          className="w-[min(340px,calc(100vw-24px))] p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            avatarTrigger.current?.focus();
          }}
        >
          {info.status === "loading" || info.status === "idle" ? <p className="p-4 text-sm text-sub">{t("console.agentRunInfo.loading")}</p> : null}
          {info.status === "error" ? (
            <div className="p-4 text-sm">
              <p className="text-danger">{t("console.agentRunInfo.loadFailed")}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
                <RotateCcw className="mr-1.5 h-3 w-3" strokeWidth={1.5} aria-hidden="true" />{t("common.retry")}
              </Button>
            </div>
          ) : null}
          <Dialog open={dialogOpen} onOpenChange={(nextOpen) => {
            dialogOpenRef.current = nextOpen;
            setDialogOpen(nextOpen);
          }}>
            {info.status === "ready" ? <AgentRunInfoContent
              info={info.value}
              t={t}
              markdownTrigger={markdownTrigger}
            /> : null}
            <DialogContent
              className="grid grid-rows-[auto_minmax(0,1fr)]"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                markdownTrigger.current?.focus();
              }}
            >
              <header className="flex min-h-[52px] items-center justify-between border-b border-line bg-card px-4">
                <DialogTitle className="font-semibold">{t("console.agentRunInfo.markdownTitle")}</DialogTitle>
                <DialogClose asChild><button type="button" className="rounded-sm p-2 text-sub hover:bg-hover" aria-label={t("common.close")}><X className="h-4 w-4" strokeWidth={1.5} /></button></DialogClose>
              </header>
              <div className="scroll-thin min-h-0 overflow-auto p-4">
                {markdown.status === "loading" || markdown.status === "idle" ? <p className="text-sm text-sub">{t("console.agentRunInfo.loading")}</p> : null}
                {markdown.status === "error" ? (
                  <div className="text-sm">
                    <p className="text-danger">{t("console.agentRunInfo.markdownLoadFailed")}</p>
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
                      <RotateCcw className="mr-1.5 h-3 w-3" strokeWidth={1.5} aria-hidden="true" />{t("common.retry")}
                    </Button>
                  </div>
                ) : null}
                {markdown.status === "ready" ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">{markdown.value}</pre> : null}
              </div>
            </DialogContent>
          </Dialog>
        </PopoverContent>
    </Popover>
  );
}

function AgentRunInfoContent({ info, t, markdownTrigger }: {
  info: AgentRunInfoView;
  t: Translate;
  markdownTrigger: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const evidence = {
    executed: t("console.agentRunInfo.executed"),
    "planned-not-started": t("console.agentRunInfo.plannedNotStarted"),
    "bound-start-unknown": t("console.agentRunInfo.boundStartUnknown"),
  }[info.evidence];
  const notRecorded = t("console.agentRunInfo.notRecorded");
  return (
    <div className="grid gap-3 p-4 text-xs">
      <div><p className="font-medium text-ink">{info.agent.displayName ?? `@${info.agent.slug}`}</p><p className="text-sub">@{info.agent.slug}</p></div>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-sub">{t("console.agentRunInfo.team")}</dt><dd className="text-ink">{info.team.name ?? notRecorded}{info.team.ownership ? ` · ${info.team.ownership === "system" ? (info.team.sourceName ?? t("console.agentRunInfo.official")) : t("console.agentRunInfo.user")}` : ""}</dd>
        <dt className="text-sub">{t("console.agentRunInfo.evidence")}</dt><dd className="text-ink">{evidence}</dd>
        <dt className="text-sub">CLI / model</dt><dd className="break-words text-ink">{info.profile ? `${info.profile.cli} / ${info.profile.model}` : notRecorded}</dd>
        <dt className="text-sub">effort</dt><dd className="text-ink">{info.profile?.effort ?? notRecorded}</dd>
        <dt className="text-sub">{t("console.agentRunInfo.loaded")}</dt><dd className="text-ink">{info.loadedAt ?? notRecorded}</dd>
      </dl>
      <DialogTrigger asChild>
        <Button ref={markdownTrigger} type="button" variant="outline" size="sm"><FileText className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />{t("console.agentRunInfo.viewMarkdown")}</Button>
      </DialogTrigger>
    </div>
  );
}
