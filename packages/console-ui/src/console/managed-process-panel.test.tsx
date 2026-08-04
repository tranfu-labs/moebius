import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ManagedProcessPanel, type ManagedProcessPanelController } from "./managed-process-panel";
import { translate } from "../i18n";

const item = {
  id: "mp-1",
  label: "Storybook",
  kind: "service" as const,
  state: "ready" as const,
  endpoint: { url: "http://127.0.0.1:6006/" },
  exitCode: null,
  signal: null,
};

function controller(overrides: Partial<ManagedProcessPanelController> = {}): ManagedProcessPanelController {
  return {
    state: { status: "ready", items: [item] },
    logs: {},
    pendingIds: new Set(),
    onRefresh: vi.fn(),
    onReadLogs: vi.fn(),
    onStop: vi.fn(),
    onAcknowledge: vi.fn(),
    onOpenEndpoint: vi.fn(),
    ...overrides,
  };
}

describe("ManagedProcessPanel", () => {
  it("hides without records and exposes endpoint, logs, and idempotent stop intents", () => {
    const empty = controller({ state: { status: "ready", items: [] } });
    const view = render(<ManagedProcessPanel controller={empty} t={(key, values) => translate("zh-CN", key, values)} />);
    expect(screen.queryByTestId("managed-process-indicator")).not.toBeInTheDocument();

    const active = controller();
    view.rerender(<ManagedProcessPanel controller={active} t={(key, values) => translate("zh-CN", key, values)} />);
    fireEvent.click(screen.getByTestId("managed-process-indicator"));
    fireEvent.click(screen.getByRole("button", { name: "打开链接 · Storybook" }));
    fireEvent.click(screen.getByRole("button", { name: "日志 · Storybook" }));
    fireEvent.click(screen.getByRole("button", { name: "停止 · Storybook" }));
    expect(active.onOpenEndpoint).toHaveBeenCalledWith(item.endpoint.url);
    expect(active.onReadLogs).toHaveBeenCalledWith(item.id);
    expect(active.onStop).toHaveBeenCalledWith(item.id);
  });

  it("keeps the final exited fact until explicit acknowledgement", async () => {
    const exited = controller({
      state: { status: "ready", items: [{ ...item, state: "exited", endpoint: null, signal: "SIGTERM" }] },
      logs: { "mp-1": { status: "ready", stdout: "done", stderr: "", truncated: true } },
    });
    render(<ManagedProcessPanel controller={exited} t={(key, values) => translate("zh-CN", key, values)} />);
    expect(screen.getByTestId("managed-process-indicator")).toHaveTextContent("已结束");
    fireEvent.click(screen.getByTestId("managed-process-indicator"));
    expect(screen.getByText("较早日志已截断", { exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(() => expect(exited.onAcknowledge).toHaveBeenCalledWith());
  });

  it("keeps the panel open when acknowledgement fails", () => {
    const exited = controller({
      state: { status: "ready", items: [{ ...item, state: "exited", endpoint: null }] },
    });
    const view = render(<ManagedProcessPanel controller={exited} t={(key, values) => translate("zh-CN", key, values)} />);
    fireEvent.click(screen.getByTestId("managed-process-indicator"));
    fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
    view.rerender(<ManagedProcessPanel controller={{ ...exited, state: { ...exited.state, message: "清除失败" } }} t={(key, values) => translate("zh-CN", key, values)} />);
    expect(screen.getByTestId("managed-process-panel")).toBeVisible();
    expect(screen.getByText("清除失败")).toBeVisible();
  });
});
