import "@xterm/xterm/css/xterm.css";

import type { Terminal } from "@xterm/xterm";
import { useLayoutEffect, useRef } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface OperatorClaudeTerminalTraceChunk {
  cursor: number;
  dataBase64: string;
}

export interface OperatorClaudeTerminalTraceState {
  status: "connecting" | "ready" | "reconnecting" | "unavailable";
  chunks: readonly OperatorClaudeTerminalTraceChunk[];
  nextCursor: number;
  bytesObserved: number;
  bytesRetained: number;
  incomplete: boolean;
}

export interface OperatorClaudeTerminalTracePage {
  sessionId: string;
  runId: string;
  chunks: readonly OperatorClaudeTerminalTraceChunk[];
  nextCursor: number;
  bytesObserved: number;
  bytesRetained: number;
  incomplete: boolean;
}

export interface OperatorClaudeTerminalTrace {
  sessionId: string;
  runId: string;
  state: OperatorClaudeTerminalTraceState;
}

/** Active terminal projections are kept as exact session/run pairs, not a shared transport key. */
export type OperatorClaudeTerminalTraces = readonly OperatorClaudeTerminalTrace[];

export interface ClaudeTerminalSurfaceProps {
  trace: OperatorClaudeTerminalTraceState;
  className?: string;
}

/**
 * Displays raw Claude PTY bytes with xterm only. It has no outbound event
 * subscription: the conversation composer remains the sole human input path.
 */
export function ClaudeTerminalSurface({ trace, className }: ClaudeTerminalSurfaceProps): JSX.Element {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const appliedCursorRef = useRef(0);
  const latestChunksRef = useRef(trace.chunks);
  latestChunksRef.current = trace.chunks;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let disposed = false;
    let disposeTerminal = () => undefined;
    void import("@xterm/xterm").then(({ Terminal }) => {
      if (disposed) return;
      const terminal = new Terminal({
        allowProposedApi: false,
        cols: 120,
        rows: 40,
        cursorBlink: false,
        cursorInactiveStyle: "none",
        disableStdin: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.35,
        linkHandler: null,
        theme: terminalTheme(host),
      });
      terminal.open(host);
      terminal.attachCustomKeyEventHandler(() => false);
      terminal.textarea?.setAttribute("aria-hidden", "true");
      terminal.textarea?.setAttribute("readonly", "true");
      if (terminal.textarea !== undefined) terminal.textarea.tabIndex = -1;
      terminal.element?.setAttribute("aria-hidden", "true");
      const defocusTerminalInput = () => terminal.textarea?.blur();
      host.addEventListener("focusin", defocusTerminalInput);
      terminalRef.current = terminal;
      appliedCursorRef.current = 0;
      writeUnappliedChunks(terminal, latestChunksRef.current, appliedCursorRef);
      disposeTerminal = () => {
        host.removeEventListener("focusin", defocusTerminalInput);
        if (terminalRef.current === terminal) terminalRef.current = null;
        terminal.dispose();
      };
    }).catch(() => {
      // The bundled xterm module is local. A failed lazy import leaves the
      // surrounding read-only status intact and never changes Claude's run.
    });
    return () => {
      disposed = true;
      disposeTerminal();
    };
  }, []);

  useLayoutEffect(() => {
    const terminal = terminalRef.current;
    if (terminal !== null) writeUnappliedChunks(terminal, trace.chunks, appliedCursorRef);
  }, [trace.chunks]);

  return (
    <section
      className={cn("mt-2.5 max-w-full overflow-auto rounded-md border border-line bg-sunken", className)}
      aria-label={t("console.claudeTerminal.title")}
      data-testid="claude-terminal-surface"
    >
      <div className="flex min-w-[960px] items-center gap-1.5 border-b border-line px-2.5 py-1.5 text-xs text-sub">
        <span className="font-medium text-ink">{t("console.claudeTerminal.title")}</span>
        <span aria-hidden="true">·</span>
        <span data-testid="claude-terminal-status">{terminalStatusLabel(trace.status, t)}</span>
      </div>
      {trace.incomplete ? (
        <p
          className="border-b border-line px-2.5 py-2 text-xs leading-5 text-sub"
          data-testid="claude-terminal-incomplete"
        >
          {t("console.claudeTerminal.incomplete")}
        </p>
      ) : null}
      <div
        ref={hostRef}
        className="h-[648px] w-[960px] cursor-text select-text"
        data-testid="claude-terminal-host"
      />
    </section>
  );
}

function writeUnappliedChunks(
  terminal: Terminal,
  chunks: readonly OperatorClaudeTerminalTraceChunk[],
  appliedCursorRef: { current: number },
): void {
  for (const chunk of [...chunks].sort((left, right) => left.cursor - right.cursor)) {
    if (chunk.cursor < appliedCursorRef.current) continue;
    // Never synthesize a missing terminal block: wait for the next snapshot so
    // xterm receives exactly the PTY byte ordering supplied by the runtime.
    if (chunk.cursor !== appliedCursorRef.current) return;
    const bytes = decodeTerminalChunk(chunk.dataBase64);
    // Do not discard an unrenderable block: keeping the cursor in place makes
    // a malformed transport response visible as a stalled projection rather
    // than silently omitting bytes from the terminal history.
    if (bytes === null) return;
    terminal.write(bytes);
    appliedCursorRef.current += 1;
  }
}

function decodeTerminalChunk(value: string): Uint8Array | null {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function terminalStatusLabel(
  status: OperatorClaudeTerminalTraceState["status"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (status) {
    case "connecting":
      return t("console.claudeTerminal.connecting");
    case "reconnecting":
      return t("console.claudeTerminal.reconnecting");
    case "unavailable":
      return t("console.claudeTerminal.unavailable");
    case "ready":
      return t("console.claudeTerminal.readOnly");
  }
}

function terminalTheme(host: HTMLElement): { background: string; foreground: string; cursor: string } {
  const styles = globalThis.getComputedStyle(host);
  return {
    // Electron resolves the same tokens used by surrounding surfaces. Fallbacks
    // only cover CSSOM-less unit-test environments.
    background: styles.getPropertyValue("--sunken").trim() || "#F0F0F0",
    foreground: styles.getPropertyValue("--ink").trim() || "#181818",
    cursor: styles.getPropertyValue("--sub").trim() || "#636363",
  };
}
