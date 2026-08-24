import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

const terminalRecords = vi.hoisted(() => [] as Array<{
  options: Record<string, unknown>;
  writes: Array<string | Uint8Array>;
  textarea: HTMLTextAreaElement;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
  disposed: boolean;
}>);

vi.mock("@xterm/xterm", () => ({
  Terminal: class FakeTerminal {
    readonly textarea = document.createElement("textarea");
    readonly record = {
      options: {} as Record<string, unknown>,
      writes: [] as Array<string | Uint8Array>,
      textarea: this.textarea,
      keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
      disposed: false,
    };

    constructor(options: Record<string, unknown>) {
      this.record.options = options;
      terminalRecords.push(this.record);
    }

    open(host: HTMLElement): void {
      host.append(this.textarea);
    }

    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.record.keyHandler = handler;
    }

    write(data: string | Uint8Array): void {
      this.record.writes.push(data);
    }

    dispose(): void {
      this.record.disposed = true;
    }
  },
}));

import {
  ClaudeTerminalSurface,
  type OperatorClaudeTerminalTraceState,
} from "./claude-terminal-surface";

afterEach(() => {
  terminalRecords.splice(0);
});

describe("ClaudeTerminalSurface", () => {
  it("sends ordered raw bytes to a read-only xterm surface without creating HTML or input", async () => {
    const first = new Uint8Array(Buffer.from("\u001b[2J<image src=x onerror=alert(1)>", "utf8"));
    const second = new Uint8Array([0xff, 0x00, 0x1b]);
    const view = render(
      <I18nProvider locale="zh-CN">
        <ClaudeTerminalSurface trace={trace([
          { cursor: 0, dataBase64: Buffer.from(first).toString("base64") },
          { cursor: 1, dataBase64: Buffer.from(second).toString("base64") },
        ])} />
      </I18nProvider>,
    );

    await waitFor(() => expect(terminalRecords).toHaveLength(1));
    const record = terminalRecords[0]!;
    expect(record.options).toMatchObject({
      allowProposedApi: false,
      disableStdin: true,
      linkHandler: null,
    });
    expect(record.writes.map(bytes)).toEqual([Array.from(first), Array.from(second)]);
    expect(record.textarea).toHaveAttribute("aria-hidden", "true");
    expect(record.textarea).toHaveAttribute("readonly", "true");
    expect(record.textarea.tabIndex).toBe(-1);
    expect(record.keyHandler?.(new KeyboardEvent("keydown", { key: "x" }))).toBe(false);
    expect(screen.getByTestId("claude-terminal-surface").querySelector("img")).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    view.rerender(
      <I18nProvider locale="zh-CN">
        <ClaudeTerminalSurface trace={trace([
          { cursor: 0, dataBase64: Buffer.from(first).toString("base64") },
          { cursor: 1, dataBase64: Buffer.from(second).toString("base64") },
          { cursor: 2, dataBase64: Buffer.from("next ANSI block").toString("base64") },
        ])} />
      </I18nProvider>,
    );
    expect(record.writes.map(bytes)).toEqual([
      Array.from(first),
      Array.from(second),
      Array.from(Buffer.from("next ANSI block")),
    ]);
  });
});

function trace(chunks: OperatorClaudeTerminalTraceState["chunks"]): OperatorClaudeTerminalTraceState {
  return {
    status: "ready",
    chunks,
    nextCursor: chunks.length,
    bytesObserved: chunks.length,
    bytesRetained: chunks.length,
    incomplete: false,
  };
}

function bytes(value: string | Uint8Array): number[] {
  return typeof value === "string" ? Array.from(Buffer.from(value)) : Array.from(value);
}
