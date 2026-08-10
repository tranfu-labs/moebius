import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";

/**
 * Terminal notification settings group under the Settings "General" section;
 * a controlled display-only component. Maps decided state only: effective
 * switch value, save lifecycle, macOS permission, and channel anomaly are all
 * passed in; it never reads/writes preferences, requests permission, or calls
 * IPC. Actions are exposed as optional callbacks.
 */
export type NotificationPermissionState = "undetermined" | "allowed" | "denied" | "unavailable";
export type NotificationSaveStatus = "idle" | "saving" | "failed";

export interface TerminalNotificationSettingsProps {
  /** Effective switch value; keeps the old value while saving. */
  enabled: boolean;
  saveStatus: NotificationSaveStatus;
  /** Visible outcome of a completed save (e.g. terminal notifications turned off). */
  saveResult?: "closed" | null;
  permission: NotificationPermissionState;
  /** System notification channel anomaly (unsupported / init failure / last submit failure). */
  channelAnomaly: boolean;
  /** Visible outcome of the last channel recheck, kept until the next recheck. */
  channelCheckResult?: "recovered" | "still-anomaly" | null;
  /** A permission request or channel recheck is in progress. */
  checking?: boolean;
  onToggle?: (enabled: boolean) => void;
  onRequestPermission?: () => void;
  onOpenSystemSettings?: () => void;
  onRecheckChannel?: () => void;
  onReportProblem?: () => void;
  onRetrySave?: () => void;
}

export function TerminalNotificationSettings({
  enabled,
  saveStatus,
  saveResult = null,
  permission,
  channelAnomaly,
  channelCheckResult = null,
  checking = false,
  onToggle,
  onRequestPermission,
  onOpenSystemSettings,
  onRecheckChannel,
  onReportProblem,
  onRetrySave,
}: TerminalNotificationSettingsProps): JSX.Element {
  const { t } = useI18n();
  const saving = saveStatus === "saving";
  const failed = saveStatus === "failed";

  return (
    <fieldset aria-busy={saving}>
      <legend className="text-sm font-medium">{t("notification.settings.title")}</legend>
      <p id="terminal-notification-description" className="mt-1 text-sm text-sub">
        {t("notification.settings.description")}
      </p>

      <div className="mt-4 divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
        <div className="flex min-h-11 items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-ink">{t("notification.settings.title")}</span>
            <span className="mt-0.5 block text-xs leading-5 text-sub" aria-live="polite">
              {saving
                ? t(enabled ? "notification.settings.savingOff" : "notification.settings.savingOn")
                : failed
                  ? t("notification.settings.saveFailed")
                  : null}
            </span>
          </span>
          {failed ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetrySave}>
              {t("common.retry")}
            </Button>
          ) : null}
          {saving ? (
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("notification.settings.title")}
            aria-disabled={saving}
            data-testid="terminal-notification-toggle"
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              saving ? "cursor-wait opacity-60" : "cursor-pointer",
              enabled ? "border-accent bg-accent" : "border-line-strong bg-sunken",
            )}
            onClick={() => {
              if (!saving) {
                onToggle?.(!enabled);
              }
            }}
          >
            <span
              className={cn(
                "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left]",
                enabled ? "left-[18px] bg-accent-fg" : "left-[3px] bg-sub",
              )}
              aria-hidden="true"
            />
          </button>
        </div>

        {!saving && saveResult === "closed" ? (
          <div
            className="flex items-start gap-2 px-3 py-2.5"
            role="status"
            data-testid="terminal-notification-save-result"
          >
            <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-pass" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-sm text-ink">{t("notification.settings.closed")}</span>
          </div>
        ) : null}

        <div className="px-3 py-2.5">
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">{t("notification.settings.systemPermission")}</span>
              <span className="mt-0.5 block text-xs leading-5 text-sub">
                {t("notification.settings.privacyNote")}
              </span>
            </span>
            <PermissionAction
              permission={permission}
              checking={checking}
              onRequestPermission={onRequestPermission}
              onOpenSystemSettings={onOpenSystemSettings}
              onRecheckChannel={onRecheckChannel}
            />
          </div>
          {!enabled ? (
            <p className="mt-1.5 text-xs leading-5 text-sub" data-testid="terminal-notification-switch-off-detail">
              {t("notification.settings.switchOffDetail")}
            </p>
          ) : null}
          {enabled && permission === "denied" ? (
            <p className="mt-1.5 text-xs leading-5 text-sub" data-testid="terminal-notification-denied-detail">
              {t("notification.settings.deniedDetail")}
            </p>
          ) : null}
        </div>

        {channelCheckResult === "recovered" && !channelAnomaly ? (
          <div
            className="flex items-start gap-2 border-t border-line px-3 py-2.5"
            role="status"
            data-testid="terminal-notification-channel-recovered"
          >
            <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-pass" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-sm text-ink">{t("notification.settings.channelRecovered")}</span>
          </div>
        ) : null}

        {channelAnomaly ? (
          <div
            className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5"
            role="alert"
            data-testid="terminal-notification-channel-anomaly"
          >
            <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">
                {t("notification.settings.channelAnomaly")}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-sub">
                {t("notification.settings.channelAnomalyDetail")}
              </span>
              {checking ? (
                <span
                  className="mt-1.5 flex items-center gap-1.5 text-xs text-sub"
                  role="status"
                  data-testid="terminal-notification-checking"
                >
                  <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                  {t("notification.settings.checking")}
                </span>
              ) : null}
              {!checking && channelCheckResult === "still-anomaly" ? (
                <span
                  className="mt-1.5 block text-xs text-danger"
                  role="status"
                  data-testid="terminal-notification-still-anomaly"
                >
                  {t("notification.settings.channelStillUnavailable")}
                </span>
              ) : null}
            </span>
            {onRecheckChannel ? (
              <Button type="button" variant="outline" size="sm" onClick={onRecheckChannel} disabled={checking} aria-busy={checking}>
                {checking ? (
                  <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                )}
                {t("notification.action.recheck")}
              </Button>
            ) : null}
            {onReportProblem ? (
              <Button type="button" variant="ghost" size="sm" onClick={onReportProblem}>
                {t("notification.settings.reportProblem")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

function PermissionAction({
  permission,
  checking,
  onRequestPermission,
  onOpenSystemSettings,
  onRecheckChannel,
}: {
  permission: NotificationPermissionState;
  checking: boolean;
  onRequestPermission?: () => void;
  onOpenSystemSettings?: () => void;
  onRecheckChannel?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  if (permission === "allowed") {
    return (
      <span
        className="rounded-full border border-[var(--status-pass-line)] bg-[var(--status-pass-bg)] px-2.5 py-1 text-xs font-medium text-pass"
        data-testid="terminal-notification-permission"
      >
        {t("notification.state.allowed")}
      </span>
    );
  }
  if (permission === "denied") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full border border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] px-2.5 py-1 text-xs font-medium text-danger"
          data-testid="terminal-notification-permission"
        >
          {t("notification.state.denied")}
        </span>
        {onOpenSystemSettings ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenSystemSettings}>
            {t("notification.settings.openSystemSettings")}
          </Button>
        ) : null}
      </span>
    );
  }
  if (permission === "unavailable") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-sub"
          data-testid="terminal-notification-permission"
        >
          {t("notification.state.unavailable")}
        </span>
        {onRecheckChannel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRecheckChannel}
            disabled={checking}
            aria-busy={checking}
          >
            {checking ? (
              <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            )}
            {t("notification.action.recheck")}
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className="rounded-full border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-sub"
        data-testid="terminal-notification-permission"
      >
        {t("notification.state.undetermined")}
      </span>
      {onRequestPermission ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRequestPermission}
          disabled={checking}
          aria-busy={checking}
        >
          {checking ? (
            <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
          ) : null}
          {t("notification.settings.allow")}
        </Button>
      ) : null}
    </span>
  );
}
