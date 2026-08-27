import { Check, ExternalLink, LoaderCircle, ScrollText, SquareTerminal, StopCircle } from "lucide-react";
import { useState } from "react";

import type { Translate } from "@/i18n";
import { cn } from "@/lib/utils";
import { AnimatedPopoverContent, Popover, PopoverTrigger } from "@/ui/popover";

export interface ManagedProcessPanelItem {
  id: string;
  label: string;
  kind: "service" | "watcher" | "task";
  state: "starting" | "running" | "ready" | "unhealthy" | "stopping" | "exited";
  endpoint: { url: string } | null;
  exitCode: number | null;
  signal: string | null;
}

export type ManagedProcessLogView =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; stdout: string; stderr: string; truncated: boolean; cursor?: string; unchanged?: boolean; message?: string };

export interface ManagedProcessPanelController {
  state: { status: "loading" | "ready" | "failed"; items: ManagedProcessPanelItem[]; message?: string };
  logs: Readonly<Record<string, ManagedProcessLogView>>;
  pendingIds: ReadonlySet<string>;
  onRefresh(): void;
  onOpenChange?(open: boolean): void;
  onReadLogs(id: string): void;
  onStop(id: string): void;
  onAcknowledge(): void;
  onOpenEndpoint(url: string): void;
}

export function ManagedProcessPanel({ controller, t }: { controller: ManagedProcessPanelController; t: Translate }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const items = controller.state.items;
  if (items.length === 0) return null;
  const active = items.filter((item) => item.state !== "exited");
  const exited = items.filter((item) => item.state === "exited");
  const label = active.length === 1
    ? `${active[0]!.label} · ${stateLabel(active[0]!.state, t)}`
    : active.length > 1
      ? t("console.managedProcesses.count", { count: active.length })
      : exited.length === 1
        ? `${exited[0]!.label} · ${stateLabel("exited", t)}`
        : t("console.managedProcesses.exitedCount", { count: exited.length });
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); controller.onOpenChange?.(next); if (next) controller.onRefresh(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="window-no-drag z-layer-local-high ml-auto flex h-7 max-w-[220px] items-center gap-1.5 rounded-lg px-2 text-xs text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-label={`${t("console.managedProcesses.open")} · ${label}`}
          aria-expanded={open}
          data-testid="managed-process-indicator"
        >
          <SquareTerminal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <AnimatedPopoverContent align="end" className="window-no-drag w-[min(420px,calc(100vw-24px))] p-0" data-testid="managed-process-panel">
        <header className="flex h-10 items-center border-b border-line px-3 text-sm font-normal">{t("console.managedProcesses.title")}</header>
        {controller.state.message !== undefined ? <p className="border-b border-line px-3 py-2 text-xs text-danger">{controller.state.message}</p> : null}
        <div className="max-h-[420px] overflow-y-auto p-2">
          {items.map((item) => {
            const log = controller.logs[item.id];
            const pending = controller.pendingIds.has(item.id);
            return (
              <section key={item.id} className="rounded-lg border border-line bg-card p-3" data-testid={`managed-process-${item.id}`}>
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full bg-sub", item.state === "ready" && "bg-accent", item.state === "unhealthy" && "bg-danger")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-normal">{item.label}</strong>
                    <span className="text-xs text-sub">{stateLabel(item.state, t)}</span>
                  </div>
                  {item.endpoint !== null ? (
                    <button type="button" className="rounded p-1 text-sub hover:bg-hover hover:text-ink" aria-label={`${t("console.managedProcesses.openEndpoint")} · ${item.label}`} onClick={() => controller.onOpenEndpoint(item.endpoint!.url)}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {item.state === "exited" ? (
                  <p className="mt-2 text-xs text-sub">{item.signal ?? (item.exitCode === null ? t("console.managedProcesses.exited") : `exit ${item.exitCode}`)}</p>
                ) : null}
                {log?.status === "ready" ? (
                  <>
                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-meta leading-4 text-sub">{`${log.stdout}${log.stderr}` || t("console.managedProcesses.noLogs")}</pre>
                    {log.truncated ? <p className="mt-1 text-xs text-sub">{t("console.managedProcesses.logsTruncated")}</p> : null}
                    {log.message !== undefined ? <p className="mt-1 text-xs text-danger">{log.message}</p> : null}
                  </>
                ) : log?.status === "loading" ? <p className="mt-2 text-xs text-sub">{t("console.managedProcesses.logsLoading")}</p>
                  : log?.status === "failed" ? <p className="mt-2 text-xs text-danger">{log.message}</p> : null}
                <div className="mt-2 flex justify-end gap-1">
                  <button type="button" aria-label={`${t("console.managedProcesses.logs")} · ${item.label}`} className="flex h-7 items-center gap-1 rounded px-2 text-xs text-sub hover:bg-hover hover:text-ink" onClick={() => controller.onReadLogs(item.id)}>
                    <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />{t("console.managedProcesses.logs")}
                  </button>
                  {item.state !== "exited" ? (
                    <button type="button" aria-label={`${t("console.managedProcesses.stop")} · ${item.label}`} disabled={pending || item.state === "stopping"} className="flex h-7 items-center gap-1 rounded px-2 text-xs text-danger hover:bg-hover disabled:opacity-50" onClick={() => controller.onStop(item.id)}>
                      {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <StopCircle className="h-3.5 w-3.5" aria-hidden="true" />}{t("console.managedProcesses.stop")}
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
        {items.some((item) => item.state === "exited") ? (
          <footer className="flex justify-end border-t border-line p-2">
            <button type="button" disabled={controller.pendingIds.has("acknowledge-exited")} className="flex h-7 items-center gap-1 rounded px-2 text-xs text-sub hover:bg-hover hover:text-ink disabled:opacity-50" onClick={() => controller.onAcknowledge()}>
              {controller.pendingIds.has("acknowledge-exited") ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}{t("console.managedProcesses.dismiss")}
            </button>
          </footer>
        ) : null}
      </AnimatedPopoverContent>
    </Popover>
  );
}

function stateLabel(state: ManagedProcessPanelItem["state"], t: Translate): string {
  return t(`console.managedProcesses.state.${state}`);
}
