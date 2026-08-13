import {
  AlertTriangle,
  Brain,
  Braces,
  Cpu,
  FilePenLine,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { RunTime } from "@/console/run-time";

export interface OperatorProcessPromptLayer {
  status: "recorded" | "not-recorded";
  contents: string[];
}

export interface OperatorProcessContextSection {
  key: string;
  label: string;
  source: "codex-rollout" | "claude-transcript" | "kimi-wire" | "provider-native";
  status: "recorded" | "not-recorded";
  contents: string[];
}

export type OperatorProcessDebugInvocation =
  | {
      status: "available";
      sessionId: string;
      runId: string;
      engine?: "codex" | "claude" | "kimi" | "pi";
      sections?: OperatorProcessContextSection[];
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
        externalSessionId?: string;
        identityLabel?: "thread" | "session";
        threadId: string;
        metadataSource: "rollout" | "provider-native" | "immutable-context" | "not-recorded";
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
  engine?: "codex" | "claude" | "kimi" | "pi";
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
      engine: "codex" | "claude" | "kimi" | "pi";
      model: string | null;
      effort: string | null;
      provider: string | null;
      cliVersion: string | null;
      metadataSource: "rollout" | "provider-native" | "immutable-context" | "not-recorded";
      externalSessionId?: string;
      identityLabel?: "thread" | "session";
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
      kind: "thinking";
      thinking: string;
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
  const { t } = useI18n();
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
        {t("console.processEvent.callsAndOutput")}
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
        <DebugCard icon={<Braces className="h-4 w-4" strokeWidth={1.5} />} title={t("console.processEvent.agentRawOutput")} header={header}>
          <ReadonlyBlock label={t("console.processEvent.rawOutput")} value={event.output} />
          <ReadonlyBlock label="raw payload" value={event.rawPayload} />
        </DebugCard>
      );
    case "thinking":
      return (
        <DebugCard icon={<Brain className="h-4 w-4" strokeWidth={1.5} />} title={t("console.processEvent.thinking")} header={header}>
          <ReadonlyBlock
            label={t("console.processEvent.thinking")}
            value={event.thinking.trim().length > 0
              ? event.thinking
              : t("console.processEvent.thinkingUnavailable")}
          />
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
        <DebugCard icon={<Braces className="h-4 w-4" strokeWidth={1.5} />} title={t("console.processEvent.unknownEvent")} header={header}>
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
  const { t } = useI18n();
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
        <span>{t("console.processEvent.attempt", { attempt: event.attempt, status: event.status })}</span>
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
        <DebugMeta label="engine" value={event.engine} />
        <DebugMeta label="run" value={event.runId} />
        <DebugMeta
          label={metadata?.identityLabel ?? event.identityLabel ?? (event.engine === "codex" ? "thread" : "session")}
          value={metadata?.externalSessionId ?? metadata?.threadId ?? event.externalSessionId ?? event.threadId}
        />
        <DebugMeta label={t("console.processEvent.started")} value={event.startedAt} />
        <DebugMeta label={t("console.processEvent.completed")} value={event.completedAt ?? (event.status === "running" ? "running" : null)} />
        {metadata?.cwd !== null && metadata?.cwd !== undefined
          ? <DebugMeta label="cwd" value={metadata.cwd} />
          : null}
      </dl>
      <p className="mt-3 rounded-sm border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub">
        {t("console.processEvent.sensitiveNotice")}
      </p>
      <div className="mt-3 grid gap-2">
        {(invocation?.sections ?? defaultContextSections(event.engine)).map((section) => (
          <PromptDisclosure
            key={section.key}
            label={section.label}
            sectionKey={section.key}
            legacyLayer={legacyLayer(section.key)}
            state={invocationState}
            sessionId={sessionId}
            runId={event.runId}
            onLoadInvocation={onLoadInvocation}
          />
        ))}
      </div>
    </article>
  );
}

function PromptDisclosure({
  label,
  sectionKey,
  legacyLayer,
  state,
  sessionId,
  runId,
  onLoadInvocation,
}: {
  label: string;
  sectionKey: string;
  legacyLayer: "system" | "developer" | "user" | null;
  state: OperatorProcessInvocationState;
  sessionId: string;
  runId: string;
  onLoadInvocation?: (sessionId: string, runId: string) => void;
}): JSX.Element {
  const { t } = useI18n();
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
      <summary className="cursor-pointer select-none font-mono text-xs font-normal text-ink">
        {label}
      </summary>
      <div className="mt-2 border-t border-line pt-2">
        {state.status === "idle" || state.status === "loading" ? (
          <p className="text-xs text-sub">{t("console.processEvent.loadingPrompts")}</p>
        ) : state.status === "error" ? (
          <p className="text-xs text-sub">
            {t("console.processEvent.promptLoadFailed", { error: state.message })}
            <button
              type="button"
              className="ml-2 rounded-sm border border-line px-2 py-1 text-ink hover:bg-hover"
              onClick={request}
            >
              {t("common.retry")}
            </button>
          </p>
        ) : state.invocation.status !== "available" ? (
          <p className="text-xs text-sub">
            {state.invocation.status === "malformed"
              ? t("console.processEvent.promptMalformed")
              : t("console.processEvent.promptUnavailable")}
          </p>
        ) : resolveContextSection(state.invocation, sectionKey, legacyLayer).status === "not-recorded" ? (
          <p className="text-xs text-sub">{t("console.processEvent.layerNotRecorded")}</p>
        ) : (
          <div className="grid gap-2">
            {resolveContextSection(state.invocation, sectionKey, legacyLayer).contents.map((content, index) => (
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

function defaultContextSections(
  engine: "codex" | "claude" | "kimi" | "pi",
): OperatorProcessContextSection[] {
  const definitions = engine === "claude"
    ? [["user", "USER"], ["assistant", "ASSISTANT"], ["session-metadata", "SESSION_METADATA"]]
    : engine === "kimi"
      ? [["system", "SYSTEM_PROMPT"], ["turn", "TURN_PROMPT"], ["context", "CONTEXT"], ["request", "LLM_REQUEST"]]
      : engine === "pi"
        ? [["system", "SYSTEM_PROMPT"], ["turn", "TURN_PROMPT"], ["context", "SAFE_PI_TRACE"]]
        : [["system", "SYSTEM_PROMPT"], ["developer", "DEVELOPER_PROMPT"], ["user", "USER_INPUT"]];
  return definitions.map(([key, label]) => ({
    key: key!,
    label: label!,
    source: engine === "claude"
      ? "claude-transcript"
      : engine === "kimi"
        ? "kimi-wire"
        : engine === "pi"
          ? "provider-native"
          : "codex-rollout",
    status: "not-recorded",
    contents: [],
  }));
}

function legacyLayer(key: string): "system" | "developer" | "user" | null {
  return key === "system" || key === "developer" || key === "user" ? key : null;
}

function resolveContextSection(
  invocation: Extract<OperatorProcessDebugInvocation, { status: "available" }>,
  sectionKey: string,
  layer: "system" | "developer" | "user" | null,
): OperatorProcessPromptLayer {
  const section = invocation.sections?.find((candidate) => candidate.key === sectionKey);
  if (section !== undefined) {
    return section;
  }
  return layer === null
    ? { status: "not-recorded", contents: [] }
    : invocation.prompts[layer];
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
  const { t } = useI18n();
  return (
    <article className={cn(
      "my-2 overflow-hidden rounded-lg border bg-card",
      danger ? "border-danger/30" : "border-line",
    )}>
      <header className="border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-normal text-ink">
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
  const { t } = useI18n();
  return (
    <p className="mt-1 break-all font-mono text-meta leading-4 text-sub">
      {timestamp ?? t("console.processEvent.timestampMissing")} · {protocolType}
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
  const { t } = useI18n();
  return (
    <p className="mt-1 break-all font-mono text-meta leading-4 text-sub">
      call_id: {callId ?? t("console.processEvent.notRecorded")} · {status ?? phase}
    </p>
  );
}

function DebugMeta({ label, value }: { label: string; value: string | null }): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <dt className="font-mono text-sub">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-ink">{value ?? t("console.processEvent.notRecorded")}</dd>
    </>
  );
}

function ReadonlyBlock({ label, value }: { label: string; value: string }): JSX.Element {
  const { t } = useI18n();
  const displayValue = escapeTerminalControls(value);
  const collapsible = displayValue.length > 1_200 || displayValue.split("\n").length > 20;
  return (
    <details className="border-t border-line px-3 py-2" open={!collapsible}>
      <summary className="cursor-pointer select-none text-meta font-normal text-sub">
        {collapsible ? t("console.processEvent.expandFull", { label }) : label}
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
