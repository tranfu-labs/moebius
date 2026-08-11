import type {
  LocalConsoleServerOptions,
  StartedLocalConsoleServer,
} from "../../src/local-console/start.js";
import type { LocalConsoleStore } from "../../src/local-console/types.js";

import {
  decideRequiredLocalConsoleSession,
  decideLocalConsoleRunningTaskCount,
  decideLocalConsoleUrl,
  planLocalConsoleServerAccess,
} from "./desktop-local-console-plan.js";
import type { DesktopStatusSnapshot } from "./status.js";

type TeamRuntimeOptions = Pick<
  LocalConsoleServerOptions,
  "listAgentFiles" | "loadAgentTeamSnapshot" | "resolveAgentTeamHealth" | "runPi"
>;

interface DesktopLocalConsolePaths {
  dataRoot: string;
  sqlitePath: string;
  sessionLogRoot: string;
  workdirRoot: string;
  attachmentRoot: string;
}

export class DesktopLocalConsoleRuntime {
  readonly #status: DesktopStatusSnapshot;
  readonly #paths: DesktopLocalConsolePaths;
  readonly #createStore: () => Promise<LocalConsoleStore>;
  readonly #startServer: (options: LocalConsoleServerOptions) => Promise<StartedLocalConsoleServer>;
  readonly #createCapability: () => string;
  readonly #createTeamOptions: (
    findSession: (sessionId: string) => Promise<ReturnType<typeof decideRequiredLocalConsoleSession>>,
  ) => TeamRuntimeOptions;
  readonly #publishStatus: () => void;
  readonly #formatError: (error: unknown) => string;
  #server: StartedLocalConsoleServer | null = null;
  #attachmentCapability: string | null = null;

  constructor(input: {
    status: DesktopStatusSnapshot;
    paths: DesktopLocalConsolePaths;
    createStore(): Promise<LocalConsoleStore>;
    startServer(options: LocalConsoleServerOptions): Promise<StartedLocalConsoleServer>;
    createCapability(): string;
    createTeamOptions(
      findSession: (sessionId: string) => Promise<ReturnType<typeof decideRequiredLocalConsoleSession>>,
    ): TeamRuntimeOptions;
    publishStatus(): void;
    formatError(error: unknown): string;
  }) {
    this.#status = input.status;
    this.#paths = input.paths;
    this.#createStore = input.createStore;
    this.#startServer = input.startServer;
    this.#createCapability = input.createCapability;
    this.#createTeamOptions = input.createTeamOptions;
    this.#publishStatus = input.publishStatus;
    this.#formatError = input.formatError;
  }

  get attachmentCapability(): string | null {
    return this.#attachmentCapability;
  }

  get url(): string | null {
    return decideLocalConsoleUrl(this.#status.localConsole);
  }

  get pathSource(): StartedLocalConsoleServer["runtime"] | null {
    const access = planLocalConsoleServerAccess(this.#server !== null);
    if (access === "unavailable") {
      return null;
    }
    return this.#server!.runtime;
  }

  getRunningTaskCount(): number {
    return decideLocalConsoleRunningTaskCount(this.#server);
  }

  async stopRunningTasks(): Promise<void> {
    await this.#server?.stopRunningTasks();
  }

  async start(): Promise<void> {
    try {
      this.#attachmentCapability = this.#createCapability();
      const store = await this.#createStore();
      const findSession = async (sessionId: string) => decideRequiredLocalConsoleSession(
        await store.listSessions(),
        sessionId,
      );
      this.#server = await this.#startServer({
        host: "127.0.0.1",
        port: 0,
        dataRoot: this.#paths.dataRoot,
        projectRoot: this.#paths.dataRoot,
        workdirRoot: this.#paths.workdirRoot,
        store,
        attachmentRoot: this.#paths.attachmentRoot,
        attachmentCapability: this.#attachmentCapability,
        ...this.#createTeamOptions(findSession),
      });
      this.#status.localConsole = {
        status: "running",
        url: this.#server.url,
        sqlitePath: this.#server.sqlitePath,
      };
    } catch (error) {
      this.#attachmentCapability = null;
      this.#status.localConsole = { status: "error", error: this.#formatError(error) };
    }
    this.#publishStatus();
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const localState = await this.#server?.runtime.state({ sessionId });
    return localState?.selectedSession?.sessionId === sessionId;
  }

  async close(): Promise<void> {
    await this.#server?.close();
    this.#server = null;
    this.#attachmentCapability = null;
    this.#status.localConsole = { status: "stopped" };
  }
}
