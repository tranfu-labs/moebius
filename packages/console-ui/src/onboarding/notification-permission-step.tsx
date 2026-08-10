import { Check, CircleAlert, LoaderCircle, RefreshCw, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";

/**
 * Controlled display component for onboarding step 4 "Terminal notification
 * permission". Maps already-decided state to display only: the app master
 * switch and macOS permission values are passed in; this component never reads
 * preferences, requests permission, or persists anything. Actions are exposed
 * as optional callbacks so Story review can run without side effects.
 */
export type NotificationPermissionState = "undetermined" | "allowed" | "denied" | "unavailable";

export interface NotificationPermissionStepProps {
  /** Current real value of the in-app "terminal notifications" master switch. */
  masterSwitchEnabled: boolean;
  /** Current real macOS notification permission value. */
  permission: NotificationPermissionState;
  /** A system permission request is in flight, waiting for the macOS prompt. */
  waitingForSystem?: boolean;
  /** A recheck is in progress. */
  checking?: boolean;
  onAllow?: () => void;
  onSkip?: () => void;
  onRecheck?: () => void;
  onBack?: () => void;
  onContinue?: () => void;
}

export function NotificationPermissionStep({
  masterSwitchEnabled,
  permission,
  waitingForSystem = false,
  checking = false,
  onAllow,
  onSkip,
  onRecheck,
  onBack,
  onContinue,
}: NotificationPermissionStepProps): JSX.Element {
  const { t } = useI18n();
  const canRequest = permission === "undetermined" && masterSwitchEnabled && !waitingForSystem;
  const showSkip = permission === "undetermined" && masterSwitchEnabled && !waitingForSystem;
  const primaryLabel = waitingForSystem
    ? t("notification.step.waiting")
    : permission === "undetermined" && masterSwitchEnabled
      ? t("notification.action.allow")
      : t("notification.action.continue");

  return (
    <main className="flex h-screen h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <section className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10 max-sm:px-4 max-sm:py-7">
        <div className="flex w-full max-w-[780px] flex-col justify-center" data-testid="notification-permission-step">
          <header className="mx-auto w-full max-w-lg text-center">
            <p className="text-xs font-medium tabular-nums text-hint">
              {t("notification.step.progress")}
            </p>
            <h1 className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {t(masterSwitchEnabled
                ? "notification.step.titleOn"
                : "notification.step.titleOff")}
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-sub">
              {t(masterSwitchEnabled
                ? "notification.step.subtitleOn"
                : "notification.step.subtitleOff")}
            </p>
          </header>

          <div className="mx-auto mt-7 w-full max-w-[640px]">
            <section
              className="overflow-hidden rounded-xl border border-line bg-card"
              aria-label={t("notification.step.systemPermission")}
              aria-live="polite"
            >
              <StatusRow
                label={t("notification.step.masterSwitch")}
                value={t(masterSwitchEnabled
                  ? "notification.step.masterSwitchOn"
                  : "notification.step.masterSwitchOff")}
                tone={masterSwitchEnabled ? "pass" : "neutral"}
              />
              <PermissionRow
                masterSwitchEnabled={masterSwitchEnabled}
                permission={permission}
                waitingForSystem={waitingForSystem}
              />
              <div className="flex items-start gap-2 border-t border-line bg-sunken px-4 py-3 text-xs leading-5 text-sub">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <p>{t("notification.step.privacyNote")}</p>
              </div>
            </section>

            {masterSwitchEnabled && permission !== "allowed" && !waitingForSystem ? (
              <p
                className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub"
                data-testid="notification-permission-skip-notice"
              >
                {t("notification.step.skipNotice")}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <footer
        className="shrink-0 border-t border-line bg-canvas px-6 py-3.5 max-sm:px-4"
        data-testid="notification-permission-footer"
      >
        <nav
          className="mx-auto flex w-full max-w-[780px] items-center justify-end gap-2"
          aria-label={t("notification.step.systemPermission")}
        >
          {onBack ? (
            <Button type="button" size="lg" variant="outline" onClick={onBack}>
              {t("notification.action.back")}
            </Button>
          ) : null}
          {showSkip && onSkip ? (
            <Button type="button" size="lg" variant="outline" onClick={onSkip}>
              {t("notification.action.skip")}
            </Button>
          ) : null}
          {permission === "unavailable" && onRecheck ? (
            <Button type="button" size="lg" variant="outline" onClick={onRecheck} aria-busy={checking}>
              {checking ? (
                <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              )}
              {t("notification.action.recheck")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            disabled={waitingForSystem}
            onClick={waitingForSystem ? undefined : canRequest ? onAllow : onContinue}
            aria-busy={waitingForSystem}
          >
            {waitingForSystem ? (
              <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
            ) : null}
            {primaryLabel}
          </Button>
        </nav>
      </footer>
    </main>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "pass" | "neutral";
}): JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          tone === "pass"
            ? "border-[var(--status-pass-line)] bg-[var(--status-pass-bg)] text-pass"
            : "border-line bg-sunken text-sub",
        )}
      >
        {tone === "pass" ? (
          <Check className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        ) : (
          <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        )}
        {value}
      </span>
    </div>
  );
}

function PermissionRow({
  masterSwitchEnabled,
  permission,
  waitingForSystem,
}: {
  masterSwitchEnabled: boolean;
  permission: NotificationPermissionState;
  waitingForSystem: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const stateLabel = permission === "undetermined"
    ? t("notification.state.undetermined")
    : permission === "allowed"
      ? t("notification.state.allowed")
      : permission === "denied"
        ? t("notification.state.denied")
        : t("notification.state.unavailable");
  const detail = permission === "allowed"
    ? t(masterSwitchEnabled
        ? "notification.step.allowedDetail"
        : "notification.step.allowedButSwitchOff")
    : permission === "denied"
      ? t("notification.step.deniedDetail")
      : permission === "unavailable"
        ? t(masterSwitchEnabled
            ? "notification.step.unavailableDetailOn"
            : "notification.step.unavailableDetailOff")
        : null;
  return (
    <div className="px-4 py-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <span className="text-sm font-medium text-ink">{t("notification.step.systemPermission")}</span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            permission === "allowed"
              ? "border-[var(--status-pass-line)] bg-[var(--status-pass-bg)] text-pass"
              : permission === "denied"
                ? "border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] text-danger"
                : "border-line bg-sunken text-sub",
          )}
          data-testid="notification-permission-state"
        >
          {waitingForSystem ? t("notification.step.waiting") : stateLabel}
        </span>
      </div>
      {detail !== null ? (
        <p className="mt-1.5 text-xs leading-5 text-sub" data-testid="notification-permission-detail">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
