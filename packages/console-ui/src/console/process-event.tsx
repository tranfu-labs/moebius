import {
  AlertTriangle,
  FilePenLine,
  Terminal,
  Wrench,
} from "lucide-react";

import { MarkdownMessage } from "@/console/markdown-message";
import { cn } from "@/lib/utils";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";
import { RunTime } from "@/console/run-time";

export interface OperatorProcessPublicAttachment {
  kind: "image" | "file";
  displayName: string;
  mediaType: string;
  byteSize: number;
}

export type OperatorProcessTimelineEvent =
  | {
      key: string;
      kind: "attempt-header";
      runId: string;
      attempt: number;
      startedAt: string;
      status: "running" | "settled";
      elapsedMs?: number | null;
      completedAt?: string | null;
    }
  | {
      key: string;
      kind: "execution-header";
      runId: string;
      attempt: number;
    }
  | {
      key: string;
      kind: "public-message";
      messageId: number;
      speaker: "user" | "agent";
      role: string | null;
      markdown: string;
      attachments: OperatorProcessPublicAttachment[];
      timestamp: string;
    }
  | {
      key: string;
      kind: "agent-markdown";
      timestamp: string | null;
      markdown: string;
    }
  | {
      key: string;
      kind: "command";
      timestamp: string | null;
      phase: "started" | "completed";
      command: string;
      output: string | null;
      exitCode: number | null;
    }
  | {
      key: string;
      kind: "tool";
      timestamp: string | null;
      phase: "started" | "completed";
      name: string;
      input: string | null;
      output: string | null;
      status: string | null;
    }
  | {
      key: string;
      kind: "file";
      timestamp: string | null;
      action: string;
      path: string | null;
      detail: string | null;
    }
  | {
      key: string;
      kind: "error";
      timestamp: string | null;
      message: string;
      detail: string | null;
    }
  | {
      key: string;
      kind: "unsupported";
      timestamp: string | null;
    };

export interface ProcessEventProps {
  event: OperatorProcessTimelineEvent;
  memberName: string;
  memberIdentities?: readonly OperatorMemberIdentity[];
  onOpenExternalLink?: (url: string) => void;
}

export function ProcessEvent({
  event,
  memberName,
  memberIdentities = [],
  onOpenExternalLink,
}: ProcessEventProps): JSX.Element {
  switch (event.kind) {
    case "attempt-header":
      return (
        <div className="border-t border-line pb-2 pt-5 first:border-t-0 first:pt-2">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-ink">
            <span>第 {event.attempt} 次执行 · 本轮输入</span>
            {typeof event.elapsedMs === "number" ? (
              <RunTime
                mode={event.status === "running" ? "running" : "completed"}
                elapsedMs={event.elapsedMs}
                completedAt={event.completedAt}
                className="font-normal"
              />
            ) : (
              <span className="font-normal text-sub">未开始</span>
            )}
          </div>
        </div>
      );
    case "execution-header":
      return (
        <div className="border-t border-line pb-2 pt-4 text-xs font-semibold text-ink">
          本轮执行过程
        </div>
      );
    case "public-message":
      return (
        <article
          className="py-2"
          aria-label={event.speaker === "user"
            ? "你"
            : resolveOperatorMemberName(event.role, memberIdentities)}
        >
          <p className="mb-1 text-xs font-medium text-sub">
            {event.speaker === "user"
              ? "你"
              : resolveOperatorMemberName(event.role, memberIdentities)}
          </p>
          <MarkdownMessage
            content={event.markdown}
            mode="static"
            onOpenExternalLink={onOpenExternalLink}
          />
          {event.attachments.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-xs text-sub">
              {event.attachments.map((attachment, index) => (
                <li key={`${attachment.displayName}:${String(index)}`}>
                  {attachment.kind === "image" ? "图片" : "文件"} · {attachment.displayName}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      );
    case "agent-markdown":
      return (
        <article className="py-2" aria-label={memberName}>
          <p className="mb-1 text-xs font-medium text-sub">{memberName}</p>
          <MarkdownMessage
            content={event.markdown}
            mode="static"
            onOpenExternalLink={onOpenExternalLink}
          />
        </article>
      );
    case "command":
      return (
        <ProcessAction
          icon={<Terminal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
          label={event.phase === "started" ? "运行命令" : "命令结果"}
          detail={event.command}
          output={event.output}
          tone={event.exitCode !== null && event.exitCode !== 0 ? "danger" : "neutral"}
        />
      );
    case "tool":
      return (
        <ProcessAction
          icon={<Wrench className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
          label={event.phase === "started" ? "工具调用" : "工具结果"}
          detail={event.name}
          input={event.input}
          output={event.output}
          tone={event.status === "failed" ? "danger" : "neutral"}
        />
      );
    case "file":
      return (
        <ProcessAction
          icon={<FilePenLine className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
          label={event.action}
          detail={event.path}
          output={event.detail}
          tone="neutral"
        />
      );
    case "error":
      return (
        <ProcessAction
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
          label={event.message}
          detail={null}
          output={event.detail}
          tone="danger"
        />
      );
    case "unsupported":
      return (
        <div className="my-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-sub" role="note">
          其他执行活动
        </div>
      );
  }
}

function ProcessAction({
  icon,
  label,
  detail,
  input,
  output,
  tone,
}: {
  icon: JSX.Element;
  label: string;
  detail: string | null;
  input?: string | null;
  output: string | null;
  tone: "neutral" | "danger";
}): JSX.Element {
  return (
    <article
      className={cn(
        "my-2 overflow-hidden rounded-lg border bg-card",
        tone === "danger" ? "border-danger/30" : "border-line",
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs font-medium text-sub">
        {icon}
        <span>{label}</span>
      </header>
      {detail !== null ? (
        <ReadonlyBlock label="详情" value={detail} />
      ) : null}
      {input !== undefined && input !== null ? (
        <ReadonlyBlock label="输入" value={input} />
      ) : null}
      {output !== null ? <ReadonlyBlock label="输出" value={output} /> : null}
    </article>
  );
}

function ReadonlyBlock({ label, value }: { label: string; value: string }): JSX.Element {
  const displayValue = sanitizeProcessMachineText(stripTerminalControls(value));
  const collapsible = displayValue.length > 1_200 || displayValue.split("\n").length > 20;
  return (
    <div className="border-t border-line px-3 py-2">
      {collapsible ? (
        <details>
          <summary className="cursor-pointer text-[11px] font-medium text-sub">
            展开完整{label}
          </summary>
          <pre className="scroll-thin mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">
            {displayValue}
          </pre>
        </details>
      ) : (
        <>
          <p className="mb-1 text-[11px] font-medium text-sub">{label}</p>
          <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">
            {displayValue}
          </pre>
        </>
      )}
    </div>
  );
}

function stripTerminalControls(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");
}

function sanitizeProcessMachineText(value: string): string {
  return value
    .replace(
      /(?:\/Users|\/home|\/private\/tmp|\/tmp|\/var\/folders)\/[^\s"'`<>]+/gu,
      (match) => `…/${displayPathBasename(match)}`,
    )
    .replace(
      /\b(?:sessionId|runId|threadId|messageId|sourceMessageId)\s*[:=]\s*[^\s,;]+/giu,
      "内部标识已隐藏",
    );
}

function displayPathBasename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/[),.;:]+$/u, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "本地文件";
}
