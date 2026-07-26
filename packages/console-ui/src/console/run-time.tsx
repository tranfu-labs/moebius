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

export function formatRunCompletedAt(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "完成时刻未知";
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return `完成于 ${clock}`;
  const day = `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${clock}`;
  return sameYear ? `完成于 ${day}` : `完成于 ${String(date.getFullYear())}年${day}`;
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
  const duration = formatRunDuration(elapsedMs);
  const visible = `${mode === "running" ? "已进行" : "耗时"} ${duration}`;
  const completedLabel = completedAt ? formatRunCompletedAt(completedAt) : null;
  const accessible = completedLabel === null ? visible : `${visible}，${completedLabel}`;
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
