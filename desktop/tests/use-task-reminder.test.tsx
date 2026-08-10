/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "../src/console-page/desktop-api-contract.js";
import { useTaskReminderController } from "../src/console-page/use-task-reminder.js";
import type { TaskReminderClickedPayload, TaskReminderReadState } from "../src/task-reminder-contract.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Controller = ReturnType<typeof useTaskReminderController>;

function deniedState(): TaskReminderReadState {
  return {
    enabled: true,
    permission: {
      authorizationStatus: "denied",
      alert: "enabled",
      sound: "enabled",
      badge: "enabled",
      error: null,
    },
    channelStatus: "anomaly",
    modal: { open: false, phase: "idle", entries: [], saveFailed: false },
    dockCount: 0,
    pendingClick: null,
  };
}

describe("task reminder controller first-load permission sync", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: Controller;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows denied without any interaction when the first async read returns denied", async () => {
    const api = makeApi();
    vi.mocked(api.readTaskReminderState!).mockResolvedValue(deniedState());
    await render(api);
    expect(latest.permission).toBe("denied");
    expect(api.readTaskReminderState).toHaveBeenCalledTimes(1);
  });

  it("stays undetermined without crashing when the first read is rejected", async () => {
    const api = makeApi();
    vi.mocked(api.readTaskReminderState!).mockRejectedValue(new Error("ipc unavailable"));
    await render(api);
    expect(latest.permission).toBe("undetermined");
  });

  it("syncs permission to denied after the request action refresh even when the first read was unavailable", async () => {
    const api = makeApi();
    vi.mocked(api.readTaskReminderState!)
      .mockResolvedValueOnce({ ...deniedState(), permission: null })
      .mockResolvedValueOnce(deniedState());
    vi.mocked(api.applyTaskReminderModalAction!).mockResolvedValue({
      ok: true,
      state: { open: false, phase: "idle", entries: [], saveFailed: false },
    });
    await render(api);
    expect(latest.permission).toBe("undetermined");
    act(() => {
      latest.onRequestPermission?.();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.permission).toBe("denied");
  });

  it("re-syncs from the notification click subscription", async () => {
    const api = makeApi();
    vi.mocked(api.readTaskReminderState!).mockResolvedValue(deniedState());
    let captured: ((payload: TaskReminderClickedPayload) => void) | undefined;
    vi.mocked(api.onTaskReminderClicked!).mockImplementation((listener) => {
      captured = listener;
      return () => undefined;
    });
    await render(api);
    vi.mocked(api.readTaskReminderState!).mockResolvedValue({
      ...deniedState(),
      pendingClick: { sessionId: "session-1", roundId: 3, terminalMessageId: 7 },
    });
    act(() => {
      captured?.({ sessionId: "session-1", roundId: 3, terminalMessageId: 7 });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.pendingClick).toEqual({ sessionId: "session-1", roundId: 3, terminalMessageId: 7 });
  });

  async function render(api: DesktopApi): Promise<void> {
    await act(async () => {
      root.render(<Harness api={api} />);
    });
  }

  function Harness(props: { api: DesktopApi }): null {
    latest = useTaskReminderController(props.api);
    return null;
  }
});

function makeApi(): DesktopApi {
  return {
    readTaskReminderState: vi.fn(),
    setTaskReminderEnabled: vi.fn(async () => ({ ok: true })),
    applyTaskReminderModalAction: vi.fn(async () => ({ ok: true, state: null })),
    openTaskReminderSystemSettings: vi.fn(async () => undefined),
    recheckTaskReminderChannel: vi.fn(async () => "unknown"),
    onTaskReminderClicked: vi.fn(),
  } as unknown as DesktopApi;
}
