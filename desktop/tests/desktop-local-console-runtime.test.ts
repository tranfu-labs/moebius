import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type {
  LocalConsoleServerOptions,
  StartedLocalConsoleServer,
} from "../../src/local-console/start.js";
import type { LocalConsoleStore } from "../../src/local-console/types.js";
import { DesktopLocalConsoleRuntime } from "../src/desktop-local-console-runtime.js";
import type { DesktopStatusSnapshot } from "../src/status.js";

describe("desktop local console runtime", () => {
  it("passes the Desktop Trash adapter into the local console server", async () => {
    const status = startingStatus();
    const moveWorkspaceToTrash = vi.fn(async (_workspacePath: string) => undefined);
    let receivedOptions: LocalConsoleServerOptions | undefined;
    const startServer = vi.fn(async (options: LocalConsoleServerOptions) => {
      receivedOptions = options;
      return fakeServer();
    });
    const runtime = new DesktopLocalConsoleRuntime({
      status,
      paths: {
        dataRoot: "/tmp/moebius-data",
        sqlitePath: "/tmp/moebius-data/.state/local-console.sqlite",
        sessionLogRoot: "/tmp/moebius-data/sessions",
        workdirRoot: "/tmp/moebius-data/workdir",
        attachmentRoot: "/tmp/moebius-data/.state/attachments",
      },
      createStore: async () => ({ listSessions: vi.fn().mockResolvedValue([]) } as unknown as LocalConsoleStore),
      startServer,
      createCapability: () => "attachment-capability",
      createTeamOptions: () => ({}),
      moveWorkspaceToTrash,
      publishStatus: vi.fn(),
      formatError: (error) => String(error),
    });

    await runtime.start();

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(receivedOptions?.moveWorkspaceToTrash).toBe(moveWorkspaceToTrash);
  });
});

function startingStatus(): DesktopStatusSnapshot {
  return {
    appVersion: "0.5.14",
    dataRoot: "/tmp/moebius-data",
    localConsole: { status: "starting" },
    doctor: null,
    shellPath: null,
    seed: { status: "ok", copied: 0, skipped: 0 },
    update: null,
  };
}

function fakeServer(): StartedLocalConsoleServer {
  return {
    server: {} as Server,
    runtime: {} as StartedLocalConsoleServer["runtime"],
    managedProcessSupervisor: {} as StartedLocalConsoleServer["managedProcessSupervisor"],
    url: "http://127.0.0.1:1234/",
    sqlitePath: "/tmp/moebius-data/.state/local-console.sqlite",
    stopRunningTasks: async () => undefined,
    close: async () => undefined,
    skillRegistry: null,
  };
}
