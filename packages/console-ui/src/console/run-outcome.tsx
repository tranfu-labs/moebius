import { AlertTriangle, Ban, CirclePause, Clock3, FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";

export type RunOutcomeStatus = "run-not-started" | "run-stuck" | "user-stopped" | "retry-exhausted";

export interface RunOutcomeProps {
  status: RunOutcomeStatus;
  role?: string | null;
  memberIdentities?: readonly OperatorMemberIdentity[];
  rawReason?: string | null;
  rawOutput?: string | null;
  defaultOpen?: boolean;
  onOpenOutput?: (rawOutput: string | null) => void;
  onOpenDiagnostics?: () => void;
  onRetry?: () => void;
  onEditAndResend?: () => void;
  className?: string;
}

const outcomeLabels: Record<RunOutcomeStatus, string> = {
  "retry-exhausted": "这一步反复没跑起来，已经不再重试",
  "run-not-started": "这一步没跑起来",
  "user-stopped": "你让这一步停下了",
  "run-stuck": "这一步卡住了",
};

const outcomeDescriptions: Record<RunOutcomeStatus, string> = {
  "retry-exhausted": "你可以说点什么，或换一个成员接手。",
  "run-not-started": "你可以重试，或直接说话、换一个成员接手。",
  "user-stopped": "已经产生的文件改动会保留；你可以继续说话，开启新的一轮。",
  "run-stuck": "你可以重试，或直接说话、换一个成员接手。",
};

export function RunOutcome({
  status,
  role,
  memberIdentities = [],
  rawReason: _rawReason,
  rawOutput,
  defaultOpen: _defaultOpen,
  onOpenOutput,
  onOpenDiagnostics: _onOpenDiagnostics,
  onRetry,
  onEditAndResend,
  className,
}: RunOutcomeProps): JSX.Element {
  const roleLabel = role
    ? resolveOperatorMemberName(role, memberIdentities, "协作者")
    : null;

  return (
    <div
      className={cn(
        "flex max-w-[720px] items-start gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5",
        className,
      )}
    >
      <span className="mt-0.5 flex shrink-0" aria-hidden="true">
        <OutcomeIcon status={status} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
        {outcomeLabels[status]}
        {roleLabel ? <span className="ml-2 text-xs text-sub">{roleLabel}</span> : null}
        <span className="mt-0.5 block text-xs text-sub">{outcomeDescriptions[status]}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {status === "run-not-started" || status === "run-stuck" ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : status === "user-stopped" && onEditAndResend !== undefined ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="改一改重发这轮消息"
            onClick={onEditAndResend}
          >
            改一改重发
          </Button>
        ) : null}
        {onOpenOutput ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenOutput(nonBlank(rawOutput))}>
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            完整输出
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function OutcomeIcon({ status }: { status: RunOutcomeStatus }): JSX.Element {
  if (status === "run-not-started") {
    return <AlertTriangle className="h-[15px] w-[15px] text-[var(--status-run-fg)]" strokeWidth={1.5} />;
  }
  if (status === "run-stuck") {
    return <Clock3 className="h-[15px] w-[15px] text-[var(--status-run-fg)]" strokeWidth={1.5} />;
  }
  if (status === "user-stopped") {
    return <CirclePause className="h-[15px] w-[15px] text-sub" strokeWidth={1.5} />;
  }
  return <Ban className="h-[15px] w-[15px] text-danger" strokeWidth={1.5} />;
}
