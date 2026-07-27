import * as Dialog from "@radix-ui/react-dialog";
import { Check, LoaderCircle, X } from "lucide-react";

import { useI18n, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";

export type LanguageSaveStatus = "idle" | "saving" | "failed";

export interface SettingsDialogProps {
  open: boolean;
  activeLocale: Locale;
  pendingLocale: Locale | null;
  saveStatus: LanguageSaveStatus;
  onOpenChange(open: boolean): void;
  onSelectLocale(locale: Locale): void;
  onRetry(): void;
}

const localeOptions: readonly Locale[] = ["zh-CN", "en"];

export function SettingsDialog({
  open,
  activeLocale,
  pendingLocale,
  saveStatus,
  onOpenChange,
  onSelectLocale,
  onRetry,
}: SettingsDialogProps): JSX.Element {
  const { t } = useI18n();
  const selectedLocale = pendingLocale ?? activeLocale;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-ink/50" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100vh-48px)] w-[min(680px,calc(100vw-48px))]",
            "-translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[14px] border border-line bg-sunken text-ink",
            "grid-cols-[180px_minmax(0,1fr)] max-[620px]:grid-cols-1",
          )}
          aria-describedby="settings-language-description"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <aside className="border-r border-line bg-card p-3 max-[620px]:border-b max-[620px]:border-r-0">
            <Dialog.Title className="px-2 py-2 font-display text-base font-semibold tracking-[-0.01em]">
              {t("settings.title")}
            </Dialog.Title>
            <div
              className="mt-2 rounded-sm bg-sel px-2.5 py-2 text-sm font-medium"
              aria-current="page"
            >
              {t("settings.general")}
            </div>
          </aside>

          <section className="min-w-0 p-6 max-[620px]:p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold tracking-[-0.01em]">
                  {t("settings.general")}
                </h2>
              </div>
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
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-medium">{t("settings.language")}</legend>
              <p id="settings-language-description" className="mt-1 text-sm text-sub">
                {t("settings.language.description")}
              </p>
              <div className="mt-4 grid gap-2">
                {localeOptions.map((locale) => {
                  const checked = selectedLocale === locale;
                  return (
                    <label
                      key={locale}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 text-sm",
                        "focus-within:ring-2 focus-within:ring-accent",
                        checked ? "border-accent bg-sel" : "border-line bg-card hover:bg-hover",
                        saveStatus === "saving" && "cursor-wait opacity-70",
                      )}
                    >
                      <input
                        type="radio"
                        name="moebius-interface-language"
                        value={locale}
                        checked={checked}
                        disabled={saveStatus === "saving"}
                        onChange={() => onSelectLocale(locale)}
                        className="sr-only"
                      />
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-full border",
                          checked ? "border-accent bg-accent text-accent-fg" : "border-line",
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
            </fieldset>

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
                  <Button type="button" variant="outline" onClick={onRetry}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
