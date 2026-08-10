import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Languages,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { MoebiusLogo } from "@/brand/moebius-logo";
import { useI18n, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { ProviderSettingsPanel, type ProviderSettingsController } from "./provider-settings-panel";
import { TerminalNotificationSettings, type TerminalNotificationSettingsProps } from "./terminal-notification-settings";

export type LanguageSaveStatus = "idle" | "saving" | "failed";
export type SettingsSection = "general" | "providers" | "about";
export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "ready"
  | "failed"
  | "installing";
export type VersionCopyStatus = "idle" | "copied" | "failed";

export interface SettingsAboutState {
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  updateStatus: UpdateCheckStatus;
  copyStatus?: VersionCopyStatus;
}

export type TaskReminderModalOutcome = "completed" | "awaiting-user" | "no-new-content" | "silent-closeout";

export interface TaskReminderModalEntry {
  sessionId: string;
  title: string;
  outcome: TaskReminderModalOutcome;
}

export interface TaskReminderModalState {
  open: boolean;
  phase:
    | "idle"
    | "requesting"
    | "request-done"
    | "opening-settings"
    | "opened"
    | "failed"
    | "closing-save"
    | "closing-save-failed";
  entries: TaskReminderModalEntry[];
  saveFailed: boolean;
}

export type TaskReminderModalAction =
  | { kind: "open"; entry: TaskReminderModalEntry }
  | { kind: "request" }
  | { kind: "request-finished"; permissionAllowed: boolean }
  | { kind: "open-settings" }
  | { kind: "settings-opened" }
  | { kind: "settings-failed" }
  | { kind: "recheck"; permissionAllowed?: boolean }
  | { kind: "close-notifications" }
  | { kind: "close-save-finished" }
  | { kind: "close-save-failed" };

export type TaskReminderSettingsController = TerminalNotificationSettingsProps & {
  modal: TaskReminderModalState;
  /** Unconsumed notification click payload; cold-start navigation recovery (desktop main). */
  pendingClick?: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
  } | null;
  onRetrySave?(): void;
  onModalAction(action: TaskReminderModalAction): void;
};

export interface SettingsDialogProps {
  open: boolean;
  activeLocale: Locale;
  pendingLocale: Locale | null;
  saveStatus: LanguageSaveStatus;
  activeSection?: SettingsSection;
  about?: SettingsAboutState;
  providers?: ProviderSettingsController;
  taskReminder?: TaskReminderSettingsController;
  externalLinkStatus?: "idle" | "failed";
  onOpenChange(open: boolean): void;
  onSectionChange?(section: SettingsSection): void;
  onSelectLocale(locale: Locale): void;
  onRetry(): void;
  onCheckForUpdates?(): void;
  onCopyVersion?(): void;
  onOpenReleaseNotes?(): void;
  onOpenFeedback?(): void;
  onOpenRepository?(): void;
}

const localeOptions: readonly Locale[] = ["zh-CN", "en"];

export function SettingsDialog({
  open,
  activeLocale,
  pendingLocale,
  saveStatus,
  activeSection = "general",
  about,
  providers,
  taskReminder,
  externalLinkStatus = "idle",
  onOpenChange,
  onSectionChange,
  onSelectLocale,
  onRetry,
  onCheckForUpdates,
  onCopyVersion,
  onOpenReleaseNotes,
  onOpenFeedback,
  onOpenRepository,
}: SettingsDialogProps): JSX.Element {
  const { t } = useI18n();
  const selectedLocale = pendingLocale ?? activeLocale;
  const visibleSection = activeSection === "providers" && providers !== undefined
    ? "providers"
    : activeSection === "about" && about !== undefined ? "about" : "general";

  useEffect(() => {
    if (open && visibleSection === "providers") {
      providers?.refresh();
    }
  }, [open, providers?.refresh, visibleSection]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-ink/50" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100vh-32px)] w-[min(720px,calc(100vw-32px))]",
            "-translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
            "rounded-[14px] border border-line bg-sunken text-ink",
          )}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <header className="flex min-h-[52px] items-center justify-between border-b border-line bg-card px-4">
            <Dialog.Title className="font-display text-base font-semibold tracking-[-0.01em]">
              {t("settings.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <div className="grid min-h-0 grid-cols-[168px_minmax(0,1fr)] max-[620px]:grid-cols-1 max-[620px]:grid-rows-[auto_minmax(0,1fr)]">
            <nav
              className="border-r border-line bg-card p-3 max-[620px]:flex max-[620px]:gap-1 max-[620px]:border-b max-[620px]:border-r-0"
              aria-label={t("settings.navigation")}
            >
              <SettingsNavItem
                active={visibleSection === "general"}
                icon={<Languages className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
                label={t("settings.general")}
                onClick={() => onSectionChange?.("general")}
              />
              {providers !== undefined ? (
                <SettingsNavItem
                  active={visibleSection === "providers"}
                  icon={<KeyRound className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
                  label={t("settings.providers")}
                  onClick={() => onSectionChange?.("providers")}
                />
              ) : null}
              {about !== undefined ? (
                <SettingsNavItem
                  active={visibleSection === "about"}
                  icon={<Info className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
                  label={t("settings.about")}
                  onClick={() => onSectionChange?.("about")}
                />
              ) : null}
            </nav>

            <div className="min-h-0 overflow-y-auto p-6 max-[620px]:p-4">
              {visibleSection === "general" ? (
                <GeneralSettings
                  selectedLocale={selectedLocale}
                  saveStatus={saveStatus}
                  taskReminder={taskReminder}
                  onSelectLocale={onSelectLocale}
                  onRetry={onRetry}
                />
              ) : visibleSection === "providers" && providers !== undefined ? (
                <ProviderSettingsPanel controller={providers} />
              ) : about !== undefined ? (
                <AboutSettings
                  state={about}
                  onCheckForUpdates={onCheckForUpdates}
                  onCopyVersion={onCopyVersion}
                  onOpenReleaseNotes={onOpenReleaseNotes}
                  onOpenFeedback={onOpenFeedback}
                  onOpenRepository={onOpenRepository}
                  externalLinkStatus={externalLinkStatus}
                />
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsNavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-sm px-2.5 text-left text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "max-[620px]:w-auto max-[620px]:min-w-24",
        active ? "bg-sel font-medium text-ink" : "text-sub hover:bg-hover hover:text-ink",
      )}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function GeneralSettings({
  selectedLocale,
  saveStatus,
  taskReminder,
  onSelectLocale,
  onRetry,
}: {
  selectedLocale: Locale;
  saveStatus: LanguageSaveStatus;
  taskReminder?: TaskReminderSettingsController;
  onSelectLocale(locale: Locale): void;
  onRetry(): void;
}): JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <fieldset>
        <legend className="text-sm font-medium">{t("settings.language")}</legend>
        <p id="settings-language-description" className="mt-1 text-sm text-sub">
          {t("settings.language.description")}
        </p>
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
          {localeOptions.map((locale) => {
            const checked = selectedLocale === locale;
            return (
              <label
                key={locale}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors",
                  "focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent",
                  checked ? "bg-sel" : "hover:bg-hover",
                  saveStatus === "saving" && "cursor-wait opacity-70",
                )}
              >
                <input
                  type="radio"
                  name="moebius-interface-language"
                  value={locale}
                  checked={checked}
                  aria-disabled={saveStatus === "saving"}
                  onChange={() => {
                    if (saveStatus !== "saving") {
                      onSelectLocale(locale);
                    }
                  }}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border",
                    checked ? "border-accent bg-accent text-accent-fg" : "border-line-strong",
                  )}
                  aria-hidden="true"
                >
                  {checked ? <Check className="h-3 w-3" strokeWidth={2} /> : null}
                </span>
                <span>{t(`settings.locale.${locale}`)}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 min-h-9" aria-live="polite">
          {saveStatus === "saving" ? (
            <p className="flex items-center gap-2 text-sm text-sub" role="status">
              <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
              {t("settings.saving")}
            </p>
          ) : null}
          {saveStatus === "failed" ? (
            <div className="flex flex-wrap items-center justify-between gap-3" role="alert">
              <p className="text-sm text-danger">{t("settings.saveFailed")}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
        </div>
      </fieldset>

      {taskReminder !== undefined ? (
        <fieldset className="mt-8 border-t border-line pt-6">
          <legend className="text-sm font-medium">{t("settings.taskReminder")}</legend>
          <TerminalNotificationSettings
            enabled={taskReminder.enabled}
            saveStatus={taskReminder.saveStatus}
            saveResult={taskReminder.saveResult}
            permission={taskReminder.permission}
            channelAnomaly={taskReminder.channelAnomaly}
            channelCheckResult={taskReminder.channelCheckResult}
            checking={taskReminder.checking}
            onToggle={taskReminder.onToggle}
            onRequestPermission={taskReminder.onRequestPermission}
            onOpenSystemSettings={taskReminder.onOpenSystemSettings}
            onRecheckChannel={taskReminder.onRecheckChannel}
            onRetrySave={taskReminder.onRetrySave}
          />
        </fieldset>
      ) : null}
    </>
  );
}

function AboutSettings({
  state,
  onCheckForUpdates,
  onCopyVersion,
  onOpenReleaseNotes,
  onOpenFeedback,
  onOpenRepository,
  externalLinkStatus,
}: {
  state: SettingsAboutState;
  onCheckForUpdates?: () => void;
  onCopyVersion?: () => void;
  onOpenReleaseNotes?: () => void;
  onOpenFeedback?: () => void;
  onOpenRepository?: () => void;
  externalLinkStatus: "idle" | "failed";
}): JSX.Element {
  const { t } = useI18n();
  const copyStatus = state.copyStatus ?? "idle";

  return (
    <div>
      <div className="flex items-center gap-3">
        <MoebiusLogo className="h-11 w-11" decorative />
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold tracking-[-0.01em]">Moebius</p>
          <p className="mt-0.5 text-sm text-sub">{t("settings.about.tagline")}</p>
        </div>
      </div>

      <dl className="mt-6 divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
        <SettingsInfoRow label={t("settings.version")}>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span className="tnum select-text text-sm font-medium">{state.currentVersion}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCopyVersion}
              aria-label={t("settings.copyVersion")}
            >
              {copyStatus === "copied" ? (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              )}
              {copyStatus === "copied" ? t("settings.copyVersion.copied") : t("settings.copyVersion")}
            </Button>
          </div>
          {copyStatus === "failed" ? (
            <p className="mt-1 text-right text-xs text-danger" role="alert">
              {t("settings.copyVersion.failed")}
            </p>
          ) : null}
        </SettingsInfoRow>

        <SettingsInfoRow label={t("settings.platform")}>
          <span className="block w-full text-right text-sm">
            {t("settings.platform.appleSilicon")}
          </span>
        </SettingsInfoRow>

        <SettingsInfoRow label={t("settings.update")} alignStart>
          <UpdateStatus
            state={state}
            onCheckForUpdates={onCheckForUpdates}
          />
        </SettingsInfoRow>
      </dl>

      <div className="mt-5 flex flex-wrap gap-1 border-t border-line pt-4">
        <ExternalAction label={t("settings.releaseNotes")} onClick={onOpenReleaseNotes} />
        <ExternalAction label={t("settings.feedback")} onClick={onOpenFeedback} />
        <ExternalAction label={t("settings.repository")} onClick={onOpenRepository} />
      </div>
      {externalLinkStatus === "failed" ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {t("settings.externalLink.failed")}
        </p>
      ) : null}
    </div>
  );
}

function SettingsInfoRow({
  label,
  alignStart = false,
  children,
}: {
  label: string;
  alignStart?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cn("grid grid-cols-[112px_minmax(0,1fr)] gap-4 px-4 py-3 max-[620px]:grid-cols-1 max-[620px]:gap-2", alignStart && "items-start")}>
      <dt className="text-sm text-sub">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function UpdateStatus({
  state,
  onCheckForUpdates,
}: {
  state: SettingsAboutState;
  onCheckForUpdates?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const checking = state.updateStatus === "checking";
  const checkDisabled = state.updateStatus === "available"
    || state.updateStatus === "downloading"
    || state.updateStatus === "installing";
  const checkBlocked = checking || checkDisabled;
  const checkLabel = state.updateStatus === "failed"
    ? t("common.retry")
    : state.updateStatus === "idle"
      ? t("settings.update.check")
      : t("settings.update.checkAgain");

  return (
    <div className="grid justify-items-end gap-2 max-[620px]:justify-items-start" aria-live="polite">
      {state.updateStatus === "latest" ? (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-sub" strokeWidth={1.5} aria-hidden="true" />
          {t("settings.update.latest")}
        </p>
      ) : null}
      {state.updateStatus === "available" ? (
        <p className="text-sm font-medium">
          {t("settings.update.downloading", { version: state.latestVersion ?? "" })}
        </p>
      ) : null}
      {state.updateStatus === "downloading" ? (
        <p className="text-sm font-medium">
          {t("settings.update.downloadingProgress", {
            version: state.latestVersion ?? "",
            progress: Math.round(state.progress ?? 0),
          })}
        </p>
      ) : null}
      {state.updateStatus === "ready" ? (
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-sub" strokeWidth={1.5} aria-hidden="true" />
          {t("settings.update.ready", { version: state.latestVersion ?? "" })}
        </p>
      ) : null}
      {state.updateStatus === "installing" ? (
        <p className="text-sm font-medium" aria-busy="true">
          {t("settings.update.installing")}
        </p>
      ) : null}
      {state.updateStatus === "failed" ? (
        <p className="text-right text-sm text-danger max-[620px]:text-left" role="alert">
          {t("settings.update.failed")}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={checkDisabled}
        aria-disabled={checkBlocked}
        onClick={() => {
          if (!checkBlocked) {
            onCheckForUpdates?.();
          }
        }}
        aria-busy={checking}
      >
        {checking ? (
          <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        )}
        {checking ? t("settings.update.checking") : checkLabel}
      </Button>
    </div>
  );
}

function ExternalAction({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      {label}
      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
    </Button>
  );
}
