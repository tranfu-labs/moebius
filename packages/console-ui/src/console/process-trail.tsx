import {
  Brain,
  ChevronRight,
  FilePen,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type ProcessStepKind = "thinking" | "tool" | "command" | "file" | "search";
export type ProcessStepStatus = "running" | "done" | "failed";

export interface ProcessStep {
  id: string;
  kind: ProcessStepKind;
  /** One line, already human-readable — this is not a raw log line. */
  title: string;
  detail?: string | null;
  status?: ProcessStepStatus;
  /** Read-only input captured for this step. `undefined` means an older record did not store it. */
  input?: string | null;
  /** Bounded, plain-text output. `undefined` means an older record did not store it. */
  output?: string | null;
  outputRemainingLines?: number;
  /** A sanitized failure description; pure exit-code lines are ignored by the view. */
  error?: string | null;
}

const stepIcons: Record<ProcessStepKind, LucideIcon> = {
  thinking: Brain,
  tool: Wrench,
  command: Terminal,
  file: FilePen,
  search: Search,
};

/**
 * The work a member did on the way to its answer.
 *
 * While the run is live the steps accumulate in the open, so the user can watch
 * and interrupt. Once the answer lands the trail folds into a single line: the
 * conclusion should read as one self-contained message, with the process still
 * one click away rather than deleted.
 */
export function ProcessTrail({ steps, collapsed = false, className }: {
  steps: readonly ProcessStep[];
  /** true once the final answer landed. */
  collapsed?: boolean;
  className?: string;
}): JSX.Element | null {
  const { t } = useI18n();
  const trailId = useId();
  const [open, setOpen] = useState(!collapsed);
  const [openStepIds, setOpenStepIds] = useState<Set<string>>(() => new Set());

  if (steps.length === 0) return null;

  const folded = collapsed && !open;

  return (
    <div className={cn("text-sm", className)}>
      {collapsed ? (
        <button
          type="button"
          className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-sub transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={open}
          aria-controls={`${trailId}-content`}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", open ? "rotate-90" : undefined)}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {t("console.processTrail.summary", { count: String(steps.length) })}
        </button>
      ) : null}
      <DisclosureMotion id={`${trailId}-content`} open={!folded}>
        <ol className={cn("space-y-0.5", collapsed ? "mt-1.5 pl-[18px]" : undefined)}>
          {steps.map((step, index) => {
            const Icon = stepIcons[step.kind];
            const running = step.status === "running";
            const stepOpen = openStepIds.has(step.id);
            const panelId = `${trailId}-step-${String(index)}`;
            const error = readableFailureSummary(step.error);
            return (
              <li key={step.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 leading-5">
                <div className="relative flex justify-center" aria-hidden="true">
                  {index < steps.length - 1 ? (
                    <span className="absolute bottom-[-4px] top-4 w-px bg-line" />
                  ) : null}
                  <span
                    className={cn(
                      "relative mt-[11px] h-2 w-2 rounded-full border border-line bg-sub",
                      step.status === "failed"
                        ? "border-[var(--status-danger-line)] bg-danger"
                        : running
                          ? "border-[var(--status-run-line)] bg-[var(--status-run-fg)] motion-safe:animate-breathe"
                          : undefined,
                    )}
                  />
                </div>
                <div
                  className={cn(
                    "min-w-0 overflow-hidden rounded-lg border transition-colors",
                    stepOpen ? "border-line bg-card" : "border-transparent",
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "group grid w-full grid-cols-[14px_minmax(0,1fr)_14px] items-start gap-2 px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                      stepOpen ? "bg-sunken" : undefined,
                    )}
                    aria-expanded={stepOpen}
                    aria-controls={panelId}
                    aria-label={t(stepOpen ? "console.processTrail.collapseStep" : "console.processTrail.expandStep", {
                      step: [step.title, step.detail].filter(Boolean).join(" "),
                    })}
                    onClick={() => setOpenStepIds((current) => {
                      const next = new Set(current);
                      if (next.has(step.id)) next.delete(step.id);
                      else next.add(step.id);
                      return next;
                    })}
                  >
                    <Icon
                      className={cn(
                        "mt-[3px] h-3.5 w-3.5 text-hint",
                        step.status === "failed"
                          ? "text-danger"
                          : running
                            ? "text-[var(--status-run-fg)]"
                            : undefined,
                      )}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words pt-px">
                      <span className="text-ink">{step.title}</span>
                      {step.detail?.trim() ? (
                        <span className="mt-0.5 block font-mono text-xs leading-4 text-sub">{step.detail.trim()}</span>
                      ) : null}
                      {error ? (
                        <span className="mt-0.5 block text-xs leading-4 text-danger">{error}</span>
                      ) : null}
                    </span>
                    <ChevronRight
                      className={cn("mt-[3px] h-3.5 w-3.5 shrink-0 text-hint transition-transform group-hover:text-sub", stepOpen ? "rotate-90" : undefined)}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </button>
                  <DisclosureMotion id={panelId} open={stepOpen}>
                    <StepDetail step={step} />
                  </DisclosureMotion>
                </div>
              </li>
            );
          })}
        </ol>
      </DisclosureMotion>
    </div>
  );
}

function DisclosureMotion({ id, open, children }: {
  id: string;
  open: boolean;
  children: ReactNode;
}): JSX.Element {
  const [hasOpened, setHasOpened] = useState(open);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  const visualOpen = open && hasOpened;

  return (
    <div
      id={id}
      aria-hidden={!visualOpen}
      data-state={visualOpen ? "open" : "closed"}
      className="grid overflow-hidden transition-[grid-template-rows,opacity] [transition-duration:var(--dur)] [transition-timing-function:var(--ease)] motion-reduce:transition-none"
      style={{ gridTemplateRows: visualOpen ? "1fr" : "0fr", opacity: visualOpen ? 1 : 0 }}
    >
      <div className="min-h-0 overflow-hidden">{hasOpened ? children : null}</div>
    </div>
  );
}

function StepDetail({ step }: { step: ProcessStep }): JSX.Element {
  const { t } = useI18n();
  const input = nonBlank(step.input);
  const output = nonBlank(step.output);
  const legacyMissing = step.input === undefined && step.output === undefined;
  const codeLikeInput = step.kind !== "thinking";

  return (
    <div className="select-text border-t border-line bg-card">
      {legacyMissing ? (
        <p className="px-3 py-2.5 text-xs text-hint">{t("console.processTrail.notRecorded")}</p>
      ) : (
        <div>
          {input ? (
            <InputSection kind={step.kind} value={input} mono={codeLikeInput} />
          ) : step.input === undefined ? (
            <MissingSection label={inputLabel(t, step.kind)} />
          ) : null}
          {output ? (
            <OutputSection status={step.status} value={output} />
          ) : step.output === undefined ? (
            <MissingSection label={t("console.processTrail.output")} divided={input !== null} />
          ) : step.status === "running" ? (
            <OutputPending divided={input !== null} />
          ) : input === null ? (
            <p className="bg-sunken px-3 py-2.5 text-xs text-hint">{t("console.processTrail.noDetails")}</p>
          ) : null}
          {(step.outputRemainingLines ?? 0) > 0 ? (
            <p className="border-t border-line bg-sunken px-3 py-2 text-meta text-hint">
              {t("console.processTrail.outputRemaining", { count: String(step.outputRemainingLines) })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function InputSection({ kind, value, mono = false }: {
  kind: ProcessStepKind;
  value: string;
  mono?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="bg-card px-3 py-2.5">
      <p className="text-meta text-sub">{inputLabel(t, kind)}</p>
      <div className="mt-1.5 flex items-start gap-2 rounded-md border border-line bg-sunken px-2.5 py-2">
        {mono ? <span aria-hidden="true" className="shrink-0 font-mono text-xs text-accent">›</span> : null}
        <pre className={cn("min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-ink", mono ? "font-mono" : "font-sans")}>{value}</pre>
      </div>
    </section>
  );
}

function OutputSection({ status, value }: { status: ProcessStepStatus | undefined; value: string }): JSX.Element {
  const { t } = useI18n();
  const failed = status === "failed";
  return (
    <section className="border-t border-line bg-card px-3 py-2.5">
      <p className={cn("text-meta", failed ? "text-danger" : "text-sub")}>{t("console.processTrail.output")}</p>
      <pre
        className={cn(
          "mt-1.5 whitespace-pre-wrap break-words rounded-md border bg-sunken px-2.5 py-2 font-mono text-xs leading-5 text-ink",
          failed ? "border-[var(--status-danger-line)] bg-[var(--status-danger-bg)]" : "border-line",
        )}
      >{value}</pre>
    </section>
  );
}

function OutputPending({ divided }: { divided: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <p className={cn("flex items-center gap-1.5 bg-card px-3 py-2.5 text-xs text-sub", divided ? "border-t border-line" : undefined)}>
      <LoaderCircle className="h-3 w-3 motion-safe:animate-spin" strokeWidth={2} aria-hidden="true" />
      {t("console.processTrail.outputPending")}
    </p>
  );
}

function MissingSection({ label, divided = false }: { label: string; divided?: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <section className={cn("bg-card px-3 py-2.5", divided ? "border-t border-line" : undefined)}>
      <p className="text-meta text-sub">{label}</p>
      <p className="mt-1 text-xs text-hint">{t("console.processTrail.notRecorded")}</p>
    </section>
  );
}

function inputLabel(t: ReturnType<typeof useI18n>["t"], kind: ProcessStepKind): string {
  return t(`console.processTrail.inputKind.${kind}`);
}

function nonBlank(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readableFailureSummary(value: string | null | undefined): string | null {
  return value
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line !== "" && !/^(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|退出码)\s*[:=]?\s*-?\d+\.?$/iu.test(line))
    ?? null;
}
