import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/ui/dialog";
import { Button } from "@/ui/button";

export type UpdateReadyDecision = "install" | "remind-later" | "skip-version";
export type UpdateInstallDecision = "cancel" | "continue-working" | "install";
export type UpdateInstallFailureDecision = "dismiss" | "retry";

export interface UpdateInstallFailure {
  kind: "task-stop" | "install";
  version: string;
  runningTaskCount: number;
  hadRunningTasks: boolean;
  tasksStopped: boolean;
  installStarted: boolean;
}

export type UpdatePromptDialogProps =
  | {
      mode: "ready";
      open: boolean;
      currentVersion: string;
      latestVersion: string;
      onDecision(decision: UpdateReadyDecision): void;
      onOpenReleaseNotes(): void;
    }
  | {
      mode: "install-confirmation";
      open: boolean;
      version: string;
      runningTaskCount: number;
      onDecision(decision: UpdateInstallDecision): void;
    }
  | {
      mode: "install-failure";
      open: boolean;
      failure: UpdateInstallFailure;
      onDecision(decision: UpdateInstallFailureDecision): void;
    };

/**
 * The two update-related modal surfaces share one Radix boundary but keep
 * their decision contracts separate. Runtime policy (including reminder and
 * shutdown persistence) belongs to the desktop layer, not this component.
 */
export function UpdatePromptDialog(props: UpdatePromptDialogProps): JSX.Element {
  const { t } = useI18n();

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          if (props.mode === "ready") {
            props.onDecision("remind-later");
          } else if (props.mode === "install-confirmation") {
            props.onDecision(props.runningTaskCount > 0 ? "continue-working" : "cancel");
          } else {
            props.onDecision("dismiss");
          }
        }
      }}
    >
      <DialogContent
        className="z-[111] grid w-[min(480px,calc(100vw-32px))] gap-0 rounded-[14px] bg-card p-0"
        overlayClassName="z-[110] bg-black/60"
        data-testid="update-prompt-dialog"
      >
        {props.mode === "ready" ? (
          <ReadyUpdatePrompt
            currentVersion={props.currentVersion}
            latestVersion={props.latestVersion}
            onDecision={props.onDecision}
            onOpenReleaseNotes={props.onOpenReleaseNotes}
            t={t}
          />
        ) : props.mode === "install-confirmation" ? (
          <InstallConfirmation
            runningTaskCount={props.runningTaskCount}
            version={props.version}
            onDecision={props.onDecision}
            t={t}
          />
        ) : (
          <InstallFailure
            failure={props.failure}
            onDecision={props.onDecision}
            t={t}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadyUpdatePrompt({
  currentVersion,
  latestVersion,
  onDecision,
  onOpenReleaseNotes,
  t,
}: {
  currentVersion: string;
  latestVersion: string;
  onDecision(decision: UpdateReadyDecision): void;
  onOpenReleaseNotes(): void;
  t: ReturnType<typeof useI18n>["t"];
}): JSX.Element {
  return (
    <div className="grid gap-5 p-6">
      <div className="grid gap-3">
        <DialogTitle className="font-display text-lg font-semibold tracking-[-0.01em]">
          {t("updateDialog.ready.title", { version: latestVersion })}
        </DialogTitle>
        <DialogDescription className="text-sm leading-6 text-sub">
          {t("updateDialog.ready.description")}
        </DialogDescription>
        <p className="flex items-center gap-2 text-sm font-medium tnum" aria-label={t("updateDialog.ready.versionLabel", {
          currentVersion,
          latestVersion,
        })}>
          <span>{currentVersion}</span>
          <ArrowRight className="h-4 w-4 text-sub" strokeWidth={1.5} aria-hidden="true" />
          <span>{latestVersion}</span>
        </p>
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 text-sm text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onOpenReleaseNotes}
        >
          {t("updateDialog.ready.releaseNotes")}
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDecision("skip-version")}>
          {t("updateDialog.ready.skip")}
        </Button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onDecision("remind-later")}>
            {t("updateDialog.ready.remindLater")}
          </Button>
          <Button type="button" size="sm" onClick={() => onDecision("install")}>
            {t("updateDialog.ready.install")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InstallConfirmation({
  runningTaskCount,
  version,
  onDecision,
  t,
}: {
  runningTaskCount: number;
  version: string;
  onDecision(decision: UpdateInstallDecision): void;
  t: ReturnType<typeof useI18n>["t"];
}): JSX.Element {
  const hasRunningTasks = runningTaskCount > 0;
  const title = hasRunningTasks
    ? t(runningTaskCount === 1 ? "updateDialog.confirm.runningTitleSingle" : "updateDialog.confirm.runningTitle", { count: runningTaskCount })
    : t("updateDialog.confirm.idleTitle", { version });
  const description = hasRunningTasks
    ? t("updateDialog.confirm.runningDescription")
    : t("updateDialog.confirm.idleDescription");

  return (
    <div className="grid gap-5 p-6">
      <div className="grid gap-3">
        <DialogTitle className="font-display text-lg font-semibold tracking-[-0.01em]">
          {title}
        </DialogTitle>
        <DialogDescription className="flex gap-2 text-sm leading-6 text-sub">
          {hasRunningTasks ? <Info className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" /> : null}
          <span>{description}</span>
        </DialogDescription>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {hasRunningTasks ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onDecision("continue-working")}>
            {t("updateDialog.confirm.continueWorking")}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => onDecision("cancel")}>
            {t("updateDialog.confirm.cancel")}
          </Button>
        )}
        <Button
          type="button"
          variant={hasRunningTasks ? "danger" : "default"}
          size="sm"
          onClick={() => onDecision("install")}
        >
          {hasRunningTasks ? t("updateDialog.confirm.stopAndInstall") : t("updateDialog.confirm.install")}
        </Button>
      </div>
    </div>
  );
}

function InstallFailure({
  failure,
  onDecision,
  t,
}: {
  failure: UpdateInstallFailure;
  onDecision(decision: UpdateInstallFailureDecision): void;
  t: ReturnType<typeof useI18n>["t"];
}): JSX.Element {
  const taskStopFailed = failure.kind === "task-stop";
  const title = taskStopFailed
    ? t("updateDialog.failure.taskStopTitle")
    : t("updateDialog.failure.installTitle");
  const description = taskStopFailed
    ? t(failure.runningTaskCount === 1 ? "updateDialog.failure.taskStopDescriptionSingle" : "updateDialog.failure.taskStopDescription", { count: failure.runningTaskCount })
    : failure.hadRunningTasks
      ? failure.installStarted
        ? t("updateDialog.failure.installStartedWithTasks")
        : t("updateDialog.failure.installNotStartedWithTasks")
      : t("updateDialog.failure.installNoTasks");

  return (
    <div className="grid gap-5 p-6" data-testid="update-install-failure">
      <div className="grid gap-3">
        <DialogTitle className="font-display text-lg font-semibold tracking-[-0.01em]">
          {title}
        </DialogTitle>
        <DialogDescription className="flex gap-2 text-sm leading-6 text-sub">
          <Info className="mt-1 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
          <span>{description}</span>
        </DialogDescription>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDecision("dismiss")}>
          {taskStopFailed
            ? t("updateDialog.failure.continueWorking")
            : t("updateDialog.failure.remindLater")}
        </Button>
        <Button type="button" variant={taskStopFailed ? "outline" : "danger"} size="sm" onClick={() => onDecision("retry")}>
          {taskStopFailed
            ? t("updateDialog.failure.retry")
            : t("updateDialog.failure.retryInstall")}
        </Button>
      </div>
    </div>
  );
}
