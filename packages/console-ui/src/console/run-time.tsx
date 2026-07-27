import { translate, useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";

export function formatRunDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatRunCompletedAt(
  value: string,
  now = new Date(),
  t: Translate = (key, values) => translate("zh-CN", key, values),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("console.runTime.completedUnknown");
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return t("console.runTime.completedAt", { time: clock });
  const day = t("console.runTime.monthDay", {
    month: date.getMonth() + 1,
    day: date.getDate(),
    time: clock,
  });
  return sameYear
    ? t("console.runTime.completedAt", { time: day })
    : t("console.runTime.completedAtYear", { year: date.getFullYear(), time: day });
}

export function RunTime({
  mode,
  elapsedMs,
  completedAt,
  className,
}: {
  mode: "running" | "completed";
  elapsedMs: number;
  completedAt?: string | null;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const duration = formatRunDuration(elapsedMs);
  const visible = t(
    mode === "running" ? "console.runTime.elapsed" : "console.runTime.duration",
    { duration },
  );
  const completedLabel = completedAt ? formatRunCompletedAt(completedAt, new Date(), t) : null;
  const accessible = completedLabel === null
    ? visible
    : t("console.runTime.accessible", { duration: visible, completed: completedLabel });
  return (
    <span
      className={cn("tnum whitespace-nowrap text-xs text-sub", className)}
      aria-label={accessible}
      title={completedLabel ?? visible}
      tabIndex={completedLabel === null ? undefined : 0}
    >
      {visible}
    </span>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
