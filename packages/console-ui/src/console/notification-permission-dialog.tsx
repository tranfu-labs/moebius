import * as Dialog from "@radix-ui/react-dialog";
import { CircleAlert, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";

/**
 * Send-time permission recovery dialog; a controlled display-only component.
 * Shows the terminal outcomes that triggered a send attempt while the
 * pre-send permission check failed. It only maps decided state; it never
 * reads permission, requests authorization, or persists anything. The three
 * actions are exposed as optional callbacks. The dialog has no fourth silent
 * dismiss path (title-bar close, Escape, and overlay click are unavailable);
 * turning notifications off only happens through the three actions.
 */
export type NotificationOutcome = "completed" | "awaiting-user";
export type PermissionModalOpenSettingsStatus =
  | "idle"
  | "requesting"
  | "request-done"
  | "opening"
  | "opened"
  | "failed";
export type NotificationPermissionOutcome = NotificationOutcome;
export type PermissionModalCloseSaveStatus = "idle" | "saving" | "failed";

export interface PendingTerminalEntry {
  id: string;
  conversationTitle: string;
  outcome: NotificationOutcome;
}

export interface NotificationPermissionDialogProps {
  open: boolean;
  entries: readonly PendingTerminalEntry[];
  openingSettings: PermissionModalOpenSettingsStatus;
  closingSave: PermissionModalCloseSaveStatus;
  onOpenChange?: (open: boolean) => void;
  onEnablePermission?: () => void;
  onRecheck?: () => void;
  onCloseNotifications?: () => void;
  onRetryOpenSettings?: () => void;
  onRetryCloseSave?: () => void;
}

export function NotificationPermissionDialog({
  open,
  entries,
  openingSettings,
  closingSave,
  onOpenChange,
  onEnablePermission,
  onRecheck,
  onCloseNotifications,
  onRetryOpenSettings,
  onRetryCloseSave,
}: NotificationPermissionDialogProps): JSX.Element {
  const { t } = useI18n();
  const busy = openingSettings === "opening"
    || openingSettings === "requesting"
    || closingSave === "saving";
  const openSettingsFailed = openingSettings === "failed";
  const closeSaveFailed = closingSave === "failed";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-ink/50" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
            "rounded-[14px] border border-line bg-sunken text-ink",
          )}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          aria-describedby={undefined}
        >
          <div className="p-5">
            <Dialog.Title className="font-sans text-base font-semibold tracking-[-0.01em]">
              {t("notification.dialog.title")}
            </Dialog.Title>

            <div className="mt-4 divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex min-h-11 items-center gap-3 px-3 py-2"
                  data-testid="notification-permission-entry"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={entry.conversationTitle}>
                    {entry.conversationTitle}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-xs font-normal",
                      entry.outcome === "awaiting-user"
                        ? "border-[var(--status-violet-line)] bg-[var(--status-violet-bg)] text-[var(--status-violet-fg)]"
                        : "border-[var(--status-neutral-line)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
                    )}
                  >
                    {t(entry.outcome === "awaiting-user"
                      ? "notification.outcome.awaitingUser"
                      : "notification.outcome.completed")}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-3 text-sm text-sub">
              {t("notification.dialog.afterEnable")}
            </p>

            <div className="mt-3 min-h-9" aria-live="polite">
              {openingSettings === "requesting" ? (
                <p
                  className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2 text-xs leading-5 text-sub"
                  role="status"
                  data-testid="notification-permission-requesting"
                >
                  <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                  {t("notification.dialog.waitingConfirmation")}
                </p>
              ) : null}
              {openingSettings === "request-done" ? (
                <p
                  className="flex items-center gap-2 rounded-md border border-[var(--status-info-line)] bg-[var(--status-info-bg)] px-3 py-2 text-xs leading-5 text-[var(--status-info-fg)]"
                  role="status"
                  data-testid="notification-permission-request-done"
                >
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  {t("notification.dialog.requestDone")}
                </p>
              ) : null}
              {openingSettings === "opened" ? (
                <p
                  className="flex items-start gap-2 rounded-md border border-[var(--status-info-line)] bg-[var(--status-info-bg)] px-3 py-2 text-xs leading-5 text-[var(--status-info-fg)]"
                  role="status"
                >
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  {t("notification.dialog.openedHint")}
                </p>
              ) : null}
              {openSettingsFailed ? (
                <p className="flex items-start gap-2 rounded-md border border-danger/40 bg-[var(--status-danger-bg)] px-3 py-2 text-xs leading-5 text-danger" role="alert">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  {t("notification.dialog.openFailed")}
                </p>
              ) : null}
              {closingSave === "saving" ? (
                <p className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2 text-xs leading-5 text-sub" role="status">
                  <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                  {t("notification.dialog.closing")}
                </p>
              ) : null}
              {closeSaveFailed ? (
                <p className="flex items-start gap-2 rounded-md border border-danger/40 bg-[var(--status-danger-bg)] px-3 py-2 text-xs leading-5 text-danger" role="alert">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span>
                    {t("notification.dialog.closeFailed")}
                    {onRetryCloseSave ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-2 h-6 px-2 text-xs"
                        onClick={onRetryCloseSave}
                      >
                        {t("common.retry")}
                      </Button>
                    ) : null}
                  </span>
                </p>
              ) : null}
            </div>

            <p className="mt-4 text-xs leading-5 text-sub" data-testid="notification-permission-close-impact">
              {t("notification.dialog.closeImpact")}
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="default"
                disabled={busy}
                onClick={openSettingsFailed ? onRetryOpenSettings : onEnablePermission}
                aria-busy={openingSettings === "opening" || openingSettings === "requesting"}
              >
                {openingSettings === "opening" || openingSettings === "requesting" ? (
                  <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                ) : null}
                {t(openingSettings === "opening"
                  ? "notification.dialog.openingSettings"
                  : openSettingsFailed
                    ? "notification.dialog.retryOpen"
                    : "notification.dialog.enable")}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={onRecheck}>
                {t("notification.dialog.recheck")}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={onCloseNotifications}>
                {t("notification.dialog.closeNotifications")}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
