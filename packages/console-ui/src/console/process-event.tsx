import {
  AlertTriangle,
  Braces,
  Cpu,
  FilePenLine,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { RunTime } from "@/console/run-time";

export interface OperatorProcessPromptLayer {
  status: "recorded" | "not-recorded";
  contents: string[];
}

export type OperatorProcessDebugInvocation =
  | {
      status: "available";
      sessionId: string;
      runId: string;
      prompts: {
        system: OperatorProcessPromptLayer;
        developer: OperatorProcessPromptLayer;
        user: OperatorProcessPromptLayer;
      };
      metadata: {
        model: string | null;
        effort: string | null;
        provider: string | null;
        cliVersion: string | null;
        cwd: string | null;
        threadId: string;
        metadataSource: "rollout" | "immutable-context" | "not-recorded";
      };
    }
  | {
      status: "unavailable" | "malformed";
      sessionId: string;
      runId: string;
      reason: string;
    };

export type OperatorProcessInvocationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; invocation: OperatorProcessDebugInvocation };

type RunStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "stuck"
  | "paused";

interface DebugEventBase {
  key: string;
  timestamp: string | null;
  protocolType: string;
  rawPayload: string;
}

export type OperatorProcessTimelineEvent =
  | {
      key: string;
      kind: "attempt-header";
      runId: string;
      attempt: number;
      role: string;
      engine: "codex";
      model: string | null;
      effort: string | null;
      provider: string | null;
      cliVersion: string | null;
      metadataSource: "rollout" | "immutable-context" | "not-recorded";
      threadId: string;
      startedAt: string;
      status: RunStatus;
      elapsedMs?: number | null;
      completedAt?: string | null;
    }
  | {
      key: string;
      kind: "execution-header";
      runId: string;
      attempt: number;
    }
  | (DebugEventBase & {
      kind: "agent-output";
      output: string;
    })
  | (DebugEventBase & {
      kind: "command";
      phase: "started" | "completed";
      name: string;
      callId: string | null;
      status: string | null;
      input: string | null;
      output: string | null;
      exitCode: number | null;
    })
  | (DebugEventBase & {
      kind: "tool";
      phase: "started" | "completed";
      name: string;
      callId: string | null;
      status: string | null;
      input: string | null;
      output: string | null;
    })
  | (DebugEventBase & {
      kind: "file";
      action: string;
      path: string | null;
      detail: string | null;
    })
  | (DebugEventBase & {
      kind: "error";
      message: string;
      detail: string | null;
    })
  | (DebugEventBase & {
      kind: "usage";
      usage: string;
    })
  | (DebugEventBase & {
      kind: "unsupported-debug";
    });

export interface ProcessEventProps {
  event: OperatorProcessTimelineEvent;
  sessionId: string;
  invocationState?: OperatorProcessInvocationState;
  onLoadInvocation?: (sessionId: string, runId: string) => void;
}

export function ProcessEvent({
  event,
  sessionId,
  invocationState = { status: "idle" },
  onLoadInvocation,
}: ProcessEventProps): JSX.Element {
  if (event.kind === "attempt-header") {
    return (
      <AttemptDebugHeader
        event={event}
        sessionId={sessionId}
        invocationState={invocationState}
        onLoadInvocation={onLoadInvocation}
      />
    );
  }
  if (event.kind === "execution-header") {
    return (
      <div className="border-t border-line pb-2 pt-4 text-xs font-semibold text-ink">
        调用与输出
      </div>
    );
  }

  const header = (
    <DebugEventHeader
      timestamp={event.timestamp}
      protocolType={event.protocolType}
    />
  );
  switch (event.kind) {
    case "agent-output":
      return (
        <DebugCard icon={<Braces className="h-4 w-4" strokeWidth={1.5} />} title="Agent 原始输出" header={header}>
          <ReadonlyBlock label="原始输出" value={event.output} />
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
    case "command":
      return (
        <DebugCard
          icon={<Terminal className="h-4 w-4" strokeWidth={1.5} />}
          title={event.name}
          header={header}
          danger={event.exitCode !== null && event.exitCode !== 0}
          facts={<DebugFacts callId={event.callId} status={event.status} phase={event.phase} />}
        >
          {event.input !== null ? <ReadonlyBlock label="arguments" value={event.input} /> : null}
          {event.output !== null ? <ReadonlyBlock label="output" value={event.output} /> : null}
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
    case "tool":
      return (
        <DebugCard
          icon={<Wrench className="h-4 w-4" strokeWidth={1.5} />}
          title={event.name}
          header={header}
          danger={event.status === "failed"}
          facts={<DebugFacts callId={event.callId} status={event.status} phase={event.phase} />}
        >
          {event.input !== null ? <ReadonlyBlock label="arguments" value={event.input} /> : null}
          {event.output !== null ? <ReadonlyBlock label="result" value={event.output} /> : null}
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
    case "file":
      return (
        <DebugCard
          icon={<FilePenLine className="h-4 w-4" strokeWidth={1.5} />}
          title={event.action}
          header={header}
        >
          {event.path !== null ? <ReadonlyBlock label="path" value={event.path} /> : null}
          {event.detail !== null ? <ReadonlyBlock label="detail" value={event.detail} /> : null}
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
    case "error":
      return (
        <DebugCard
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.5} />}
          title={event.message}
          header={header}
          danger
        >
          {event.detail !== null ? <ReadonlyBlock label="detail" value={event.detail} /> : null}
          {event.rawPayload !== "" ? <ReadonlyBlock label="raw payload" value={event.rawPayload} /> : null}
        </DebugCard>
      );
    case "usage":
      return (
        <DebugCard icon={<Cpu className="h-4 w-4" strokeWidth={1.5} />} title="Token usage" header={header}>
          <ReadonlyBlock label="usage" value={event.usage} />
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
    case "unsupported-debug":
      return (
        <DebugCard icon={<Braces className="h-4 w-4" strokeWidth={1.5} />} title="未识别事件" header={header}>
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
  }
}

function AttemptDebugHeader({
  event,
  sessionId,
  invocationState,
  onLoadInvocation,
}: {
  event: Extract<OperatorProcessTimelineEvent, { kind: "attempt-header" }>;
  sessionId: string;
  invocationState: OperatorProcessInvocationState;
  onLoadInvocation?: (sessionId: string, runId: string) => void;
}): JSX.Element {
  const invocation = invocationState.status === "ready"
    && invocationState.invocation.status === "available"
    ? invocationState.invocation
    : null;
  const metadata = invocation?.metadata;
  const model = metadata?.model ?? event.model;
  const effort = metadata?.effort ?? event.effort;
  const provider = metadata?.provider ?? event.provider;
  const cliVersion = metadata?.cliVersion ?? event.cliVersion;
  return (
    <article className="border-t border-line pb-4 pt-5 first:border-t-0 first:pt-2">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-ink">
        <span>第 {event.attempt} 次执行 · {event.status}</span>
        {typeof event.elapsedMs === "number" ? (
          <RunTime
            mode={event.status === "running" ? "running" : "completed"}
            elapsedMs={event.elapsedMs}
            completedAt={event.completedAt}
            className="font-normal"
          />
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <DebugMeta label="model" value={model} />
        <DebugMeta label="effort" value={effort} />
        <DebugMeta label="provider" value={provider} />
        <DebugMeta label="CLI" value={cliVersion} />
        <DebugMeta label="run" value={event.runId} />
        <DebugMeta label="thread" value={metadata?.threadId ?? event.threadId} />
        <DebugMeta label="开始" value={event.startedAt} />
        <DebugMeta label="完成" value={event.completedAt ?? (event.status === "running" ? "running" : null)} />
        {metadata?.cwd !== null && metadata?.cwd !== undefined
          ? <DebugMeta label="cwd" value={metadata.cwd} />
          : null}
      </dl>
      <p className="mt-3 rounded-sm border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub">
        本地原始调试信息，可能包含提示词、本机路径、内部标识和工具返回内容。
      </p>
      <div className="mt-3 grid gap-2">
        <PromptDisclosure
          label="SYSTEM_PROMPT"
          layer="system"
          state={invocationState}
          sessionId={sessionId}
          runId={event.runId}
          onLoadInvocation={onLoadInvocation}
        />
        <PromptDisclosure
          label="DEVELOPER_PROMPT"
          layer="developer"
          state={invocationState}
          sessionId={sessionId}
          runId={event.runId}
          onLoadInvocation={onLoadInvocation}
        />
        <PromptDisclosure
          label="USER_INPUT"
          layer="user"
          state={invocationState}
          sessionId={sessionId}
          runId={event.runId}
          onLoadInvocation={onLoadInvocation}
        />
      </div>
    </article>
  );
}

function PromptDisclosure({
  label,
  layer,
  state,
  sessionId,
  runId,
  onLoadInvocation,
}: {
  label: string;
  layer: "system" | "developer" | "user";
  state: OperatorProcessInvocationState;
  sessionId: string;
  runId: string;
  onLoadInvocation?: (sessionId: string, runId: string) => void;
}): JSX.Element {
  const request = () => {
    if (state.status === "idle" || state.status === "error") {
      onLoadInvocation?.(sessionId, runId);
    }
  };
  return (
    <details
      className="rounded-sm border border-line bg-card px-3 py-2"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          request();
        }
      }}
    >
      <summary className="cursor-pointer select-none font-mono text-xs font-medium text-ink">
        {label}
      </summary>
      <div className="mt-2 border-t border-line pt-2">
        {state.status === "idle" || state.status === "loading" ? (
          <p className="text-xs text-sub">正在读取这次执行的提示词…</p>
        ) : state.status === "error" ? (
          <p className="text-xs text-sub">
            提示词暂时无法读取：{state.message}
            <button
              type="button"
              className="ml-2 rounded-sm border border-line px-2 py-1 text-ink hover:bg-hover"
              onClick={request}
            >
              重试
            </button>
          </p>
        ) : state.invocation.status !== "available" ? (
          <p className="text-xs text-sub">
            {state.invocation.status === "malformed"
              ? "这次执行的提示词记录无法解析。"
              : "这次执行的提示词记录不可用。"}
          </p>
        ) : state.invocation.prompts[layer].status === "not-recorded" ? (
          <p className="text-xs text-sub">该层未记录。</p>
        ) : (
          <div className="grid gap-2">
            {state.invocation.prompts[layer].contents.map((content, index) => (
              <pre
                key={index}
                className="scroll-thin max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink"
              >
                {escapeTerminalControls(content)}
              </pre>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function DebugCard({
  icon,
  title,
  header,
  facts,
  danger = false,
  children,
}: {
  icon: JSX.Element;
  title: string;
  header: JSX.Element;
  facts?: JSX.Element;
  danger?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <article className={cn(
      "my-2 overflow-hidden rounded-lg border bg-card",
      danger ? "border-danger/30" : "border-line",
    )}>
      <header className="border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-ink">
          {icon}
          <span className="min-w-0 truncate">{title}</span>
        </div>
        {header}
        {facts}
      </header>
      {children}
    </article>
  );
}

function DebugEventHeader({
  timestamp,
  protocolType,
}: {
  timestamp: string | null;
  protocolType: string;
}): JSX.Element {
  return (
    <p className="mt-1 break-all font-mono text-[11px] leading-4 text-sub">
      {timestamp ?? "timestamp 未记录"} · {protocolType}
    </p>
  );
}

function DebugFacts({
  callId,
  status,
  phase,
}: {
  callId: string | null;
  status: string | null;
  phase: string;
}): JSX.Element {
  return (
    <p className="mt-1 break-all font-mono text-[11px] leading-4 text-sub">
      call_id: {callId ?? "未记录"} · {status ?? phase}
    </p>
  );
}

function DebugMeta({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <>
      <dt className="font-mono text-sub">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-ink">{value ?? "未记录"}</dd>
    </>
  );
}

function ReadonlyBlock({ label, value }: { label: string; value: string }): JSX.Element {
  const displayValue = escapeTerminalControls(value);
  const collapsible = displayValue.length > 1_200 || displayValue.split("\n").length > 20;
  return (
    <details className="border-t border-line px-3 py-2" open={!collapsible}>
      <summary className="cursor-pointer select-none text-[11px] font-medium text-sub">
        {collapsible ? `展开完整${label}` : label}
      </summary>
      <pre className="scroll-thin mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">
        {displayValue}
      </pre>
    </details>
  );
}

export function escapeTerminalControls(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\n" || character === "\t") {
      return character;
    }
    if (character === "\r") {
      return "\\r";
    }
    if (code === 0x1b) {
      return "\\x1b";
    }
    if (code < 0x20 || code === 0x7f) {
      return `\\x${code.toString(16).padStart(2, "0")}`;
    }
    return character;
  }).join("");
}
