/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import type { AiTeamBuilderIpcResponse } from "../src/ai-team-builder/contract.js";
import { App } from "../src/console-page/app.js";
import type { DesktopApi } from "../src/console-page/desktop-api-contract.js";
import type { DoctorCheck } from "../src/env-doctor.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop onboarding routing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/?api=http://127.0.0.1:8787/#/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(localConsoleState)));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("drives a fresh data root through the independent route and consumes its team pick once", async () => {
    const completeOnboarding = vi.fn(async () => ({
      completed: true,
      completedAt: "2026-07-24T00:00:00.000Z",
    }));
    const recordSuccessfulConversationAgentTeam = vi.fn();
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      completeOnboarding,
      checkOnboardingCodex: async () => ({
        status: "ok",
        message: "已找到",
        detail: "codex-cli 1.0",
      }),
      recordSuccessfulConversationAgentTeam,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    expect(document.querySelector('[data-testid="operator-sidebar"]')).toBeNull();

    await clickButton("继续");
    const selectedTeam = await findElement<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(selectedTeam.textContent).toContain("开发团队");
    await clickButton("继续");
    await findElement('[data-testid="onboarding-relay-demo-slot"]');
    expect(document.body.textContent).toContain("拆解任务");
    expect(document.querySelectorAll('[data-testid="relay-message-row"]')).toHaveLength(2);
    await clickButton("继续");
    await findElement('[data-testid="onboarding-step-4"]');
    await clickButton("开始使用");

    const teamSelect = await findElement<HTMLButtonElement>(
      '[data-testid="new-conversation-column"] button[aria-label="Agent 团队"]',
    );
    await waitFor(() => teamSelect.textContent?.includes("开发团队") === true);
    await waitFor(() => window.location.hash === "#/");
    await waitFor(() => window.history.state?.usr == null);

    expect(completeOnboarding).toHaveBeenCalledOnce();
    expect(teamSelect.textContent).toContain("开发团队");
    expect(recordSuccessfulConversationAgentTeam).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid^="onboarding-step-"]')).toBeNull();
  });

  it("sends a completed data root straight to the operator console", async () => {
    installApi({
      getOnboardingStatus: async () => ({
        completed: true,
        completedAt: "2026-07-24T00:00:00.000Z",
      }),
    });

    await act(async () => root.render(<App />));

    await findElement('[data-testid="operator-sidebar"]');
    expect(document.querySelector('[data-testid^="onboarding-step-"]')).toBeNull();
    expect(window.location.hash).toBe("#/");
  });

  it("follows a replaced status port, ignores its slow predecessor, and exposes current failure", async () => {
    const staleStatus = deferred<Awaited<ReturnType<
      NonNullable<DesktopApi["getOnboardingStatus"]>
    >>>();
    installApi({ getOnboardingStatus: () => staleStatus.promise });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="desktop-route-loading"]');

    installApi({
      getOnboardingStatus: async () => ({
        completed: true,
        completedAt: "2026-07-24T00:00:00.000Z",
      }),
    });
    await act(async () => root.render(<App />));
    await findElement('[data-testid="operator-sidebar"]');

    await act(async () => staleStatus.resolve({ completed: false, completedAt: null }));
    expect(document.querySelector('[data-testid="operator-sidebar"]')).not.toBeNull();
    expect(document.querySelector('[data-testid^="onboarding-step-"]')).toBeNull();

    installApi({
      getOnboardingStatus: async () => Promise.reject(new Error("status unavailable")),
    });
    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    expect(document.querySelector('[data-testid="operator-sidebar"]')).toBeNull();
  });

  it.each([
    "checking",
    "ready",
    "missing",
    "needs-login",
    "unavailable",
  ] as const)("does not consume %s readiness when the normal console mounts or navigates", async (readinessStatus) => {
    const checkOnboardingCliReadiness = vi.fn(async (cli: "codex" | "claude" | "kimi") =>
      readinessSnapshot(cli, readinessStatus, 1));
    const getOnboardingCliReadinessState = vi.fn(async () => ({
      codex: readinessSnapshot("codex", readinessStatus, 1),
      claude: readinessSnapshot("claude", readinessStatus, 1),
      kimi: readinessSnapshot("kimi", readinessStatus, 1),
    }));
    let statusListener: Parameters<NonNullable<DesktopApi["onStatus"]>>[0] | null = null;
    installApi({
      getOnboardingStatus: async () => ({
        completed: true,
        completedAt: "2026-07-24T00:00:00.000Z",
      }),
      checkOnboardingCliReadiness,
      getOnboardingCliReadinessState,
      getOnboardingCliInstallState: async () => ({
        codex: installSnapshot("codex", "idle", 0),
        claude: installSnapshot("claude", "idle", 0),
        kimi: installSnapshot("kimi", "idle", 0),
      }),
      onStatus(listener) {
        statusListener = listener;
        return () => {
          statusListener = null;
        };
      },
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="operator-sidebar"]');
    await act(async () => statusListener?.({
      shellPath: { status: "ok", path: "/opt/homebrew/bin:/usr/bin" },
      seed: { status: "ok" },
    }));
    await clickButton("Agent 团队");
    await findElement('[data-testid="agent-team-list"]');
    await clickButton("新建对话");
    await findElement('[aria-label="新建对话"]');

    expect(checkOnboardingCliReadiness).not.toHaveBeenCalled();
    expect(getOnboardingCliReadinessState).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid*="compatibility"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /名成员仍需|Codex 准备|Claude Code 准备|Kimi 准备|可在 Agent 团队页调整/u,
    );
  });

  it.each(["deferred", "rejected"] as const)(
    "does not start a %s readiness IPC request in the normal console",
    async (mode) => {
      const readiness = deferred<Awaited<ReturnType<
        NonNullable<DesktopApi["getOnboardingCliReadinessState"]>
      >>>();
      const getOnboardingCliReadinessState = vi.fn(
        () => mode === "deferred"
          ? readiness.promise
          : Promise.reject(new Error("readiness unavailable")),
      );
      installApi({
        getOnboardingStatus: async () => ({
          completed: true,
          completedAt: "2026-07-24T00:00:00.000Z",
        }),
        getOnboardingCliReadinessState,
        getOnboardingCliInstallState: async () => ({
          codex: installSnapshot("codex", "idle", 0),
          claude: installSnapshot("claude", "idle", 0),
          kimi: installSnapshot("kimi", "idle", 0),
        }),
      });

      await act(async () => root.render(<App />));
      await findElement('[data-testid="operator-sidebar"]');
      await clickButton("新建对话");
      await findElement('[aria-label="新建对话"]');

      expect(getOnboardingCliReadinessState).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid*="compatibility"]')).toBeNull();
    },
  );

  it("replaces the displayed version after the existing shell PATH recheck", async () => {
    const versions = ["codex-cli 0.144.1", "codex-cli 0.145.0"];
    const checkOnboardingCodex = vi.fn(async () => ({
      status: "ok" as const,
      message: "已找到",
      detail: versions.shift(),
    }));
    let statusListener: Parameters<NonNullable<DesktopApi["onStatus"]>>[0] | null = null;
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex,
      onStatus(listener) {
        statusListener = listener;
        return () => undefined;
      },
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await waitFor(() => document.body.textContent?.includes("codex-cli 0.144.1") === true);
    expect(document.body.textContent).not.toContain("codex-cli 0.145.0");
    expect((await findButton("继续")).disabled).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("重新检查"),
    )).toBe(true);

    await act(async () => statusListener?.({
      shellPath: { status: "ok", path: "/opt/homebrew/bin:/usr/bin" },
      seed: { status: "pending" },
    }));
    await waitFor(() => document.body.textContent?.includes("codex-cli 0.145.0") === true);

    expect(checkOnboardingCodex).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("codex-cli 0.144.1");
    expect(document.body.textContent).toContain("codex-cli 0.145.0");
    expect(Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("重新检查"),
    )).toBe(true);
  });

  it("keeps the later shell PATH recheck when the initial check resolves last", async () => {
    const initialCheck = deferred<DoctorCheck>();
    const shellPathRecheck = deferred<DoctorCheck>();
    const checkOnboardingCodex = vi.fn()
      .mockImplementationOnce(() => initialCheck.promise)
      .mockImplementationOnce(() => shellPathRecheck.promise);
    let statusListener: Parameters<NonNullable<DesktopApi["onStatus"]>>[0] | null = null;
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex,
      onStatus(listener) {
        statusListener = listener;
        return () => undefined;
      },
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await waitFor(() => statusListener !== null);

    await act(async () => statusListener?.({
      shellPath: { status: "ok", path: "/opt/homebrew/bin:/usr/bin" },
      seed: { status: "pending" },
    }));
    await waitFor(() => checkOnboardingCodex.mock.calls.length === 2);

    await act(async () => shellPathRecheck.resolve({
      status: "ok",
      message: "已找到",
      detail: "codex-cli 0.145.0",
    }));
    await waitFor(() => document.body.textContent?.includes("codex-cli 0.145.0") === true);

    await act(async () => {
      initialCheck.resolve({
        status: "ok",
        message: "已找到",
        detail: "codex-cli 0.144.1",
      });
      await initialCheck.promise;
      await Promise.resolve();
    });

    expect(checkOnboardingCodex).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("codex-cli 0.145.0");
    expect(document.body.textContent).not.toContain("codex-cli 0.144.1");
    expect((await findButton("继续")).disabled).toBe(false);
  });

  it("keeps Continue disabled until a failed Codex check succeeds", async () => {
    let codexReady = false;
    const checkOnboardingCodex = vi.fn(async () => codexReady
      ? { status: "ok" as const, message: "已找到", detail: "codex-cli 1.0" }
      : { status: "error" as const, message: "Codex 未找到" });
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex,
    });

    await act(async () => root.render(<App />));
    const continueButton = await findButton("继续");
    await waitFor(() => continueButton.disabled);
    expect(continueButton.disabled).toBe(true);
    expect(document.body.textContent).toContain("Codex CLI 未安装");
    expect(document.body.textContent).toContain("npm install -g @openai/codex");

    codexReady = true;
    await clickButton("重新检查");
    await waitFor(() => !continueButton.disabled);

    expect(checkOnboardingCodex).toHaveBeenCalledTimes(2);
    expect(continueButton.disabled).toBe(false);
    expect(document.body.textContent).toContain("codex-cli 1.0");
  });

  it("uses the three-CLI readiness boundary and allows a Kimi-only machine", async () => {
    const checkOnboardingCliReadiness = vi.fn(async (cli: "codex" | "claude" | "kimi") => (
      cli === "codex"
        ? {
            cli,
            status: "missing" as const,
            code: "cli-missing" as const,
            revision: 1,
            version: null,
            checkedAt: "2026-07-26T00:00:00.000Z",
          }
        : cli === "kimi" ? {
            cli,
            status: "ready" as const,
            code: "ready" as const,
            revision: 1,
            version: "kimi 1.2.3",
            checkedAt: "2026-07-26T00:00:00.000Z",
          }
          : readinessSnapshot("claude", "missing", 1)
    ));
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCliReadiness,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await waitFor(() => document.body.textContent?.includes("kimi 1.2.3") === true);

    expect(checkOnboardingCliReadiness.mock.calls.map(([cli]) => cli).sort()).toEqual([
      "claude",
      "codex",
      "kimi",
    ]);
    expect(document.body.textContent).toContain("Codex CLI 未安装");
    expect(document.body.textContent).toContain("Kimi CLI 可用");
    expect((await findButton("继续")).disabled).toBe(false);
    expect((await findButton("重新检查")).disabled).toBe(false);
  });

  it("merges installer responses monotonically and shows pending before IPC resolves", async () => {
    const initialState = deferred<Awaited<ReturnType<
      NonNullable<DesktopApi["getOnboardingCliInstallState"]>
    >>>();
    const started = deferred<Awaited<ReturnType<
      NonNullable<DesktopApi["startOnboardingCliInstall"]>
    >>>();
    const startOnboardingCliInstall = vi.fn(() => started.promise);
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCliReadiness: async (cli) => cli === "codex"
        ? readinessSnapshot("codex", "missing", 2)
        : cli === "kimi"
          ? readinessSnapshot("kimi", "ready", 2, "kimi 1.2.3")
          : readinessSnapshot("claude", "missing", 2),
      getOnboardingCliInstallState: () => initialState.promise,
      startOnboardingCliInstall,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    const install = await findElement<HTMLButtonElement>(
      'button[aria-label="安装 Codex CLI"]',
    );
    await act(async () => {
      install.click();
      install.click();
    });

    expect(startOnboardingCliInstall).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Codex CLI 正在安装");
    expect(document.body.textContent).toContain("正在启动受信任安装程序");

    await act(async () => started.resolve(installSnapshot(
      "codex",
      "running",
      3,
      "verifying",
    )));
    await waitFor(() =>
      document.body.textContent?.includes("正在自动复检登录与模型能力") === true);

    await act(async () => initialState.resolve({
      codex: installSnapshot("codex", "idle", 1),
      claude: installSnapshot("claude", "idle", 1),
      kimi: installSnapshot("kimi", "idle", 1),
    }));
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("Codex CLI 正在安装");
    expect(document.body.textContent).toContain("正在自动复检登录与模型能力");
  });

  it("does not let an older full readiness response overwrite newer per-CLI results", async () => {
    const oldState = deferred<Awaited<ReturnType<
      NonNullable<DesktopApi["getOnboardingCliReadinessState"]>
    >>>();
    let installListener: ((
      snapshot: Awaited<ReturnType<NonNullable<DesktopApi["startOnboardingCliInstall"]>>>,
    ) => void) | null = null;
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCliReadiness: async (cli) => cli === "codex"
        ? readinessSnapshot("codex", "missing", 3)
        : cli === "kimi"
          ? readinessSnapshot("kimi", "ready", 3, "kimi latest")
          : readinessSnapshot("claude", "missing", 3),
      getOnboardingCliReadinessState: () => oldState.promise,
      getOnboardingCliInstallState: async () => ({
        codex: installSnapshot("codex", "idle", 0),
        claude: installSnapshot("claude", "idle", 0),
        kimi: installSnapshot("kimi", "idle", 0),
      }),
      onOnboardingCliInstallSnapshot(listener) {
        installListener = listener;
        return () => {
          installListener = null;
        };
      },
    });

    await act(async () => root.render(<App />));
    await waitFor(() => document.body.textContent?.includes("kimi latest") === true);
    await act(async () => {
      installListener?.(installSnapshot("kimi", "running", 1, "verifying"));
      installListener?.(installSnapshot("kimi", "succeeded", 2));
    });
    await act(async () => oldState.resolve({
      codex: readinessSnapshot("codex", "ready", 1, "codex stale"),
      claude: readinessSnapshot("claude", "missing", 1),
      kimi: readinessSnapshot("kimi", "missing", 1),
    }));
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain("kimi latest");
    expect(document.body.textContent).not.toContain("codex stale");
    expect((await findButton("继续")).disabled).toBe(false);
  });

  it("allows same-revision checking to become ready but never ready to regress to checking", async () => {
    const kimiCheck = deferred<Awaited<ReturnType<
      NonNullable<DesktopApi["checkOnboardingCliReadiness"]>
    >>>();
    let installListener: ((
      snapshot: Awaited<ReturnType<NonNullable<DesktopApi["startOnboardingCliInstall"]>>>,
    ) => void) | null = null;
    const getOnboardingCliReadinessState = vi.fn(async () => ({
      codex: readinessSnapshot("codex", "missing", 4),
      claude: readinessSnapshot("claude", "missing", 4),
      kimi: {
        cli: "kimi" as const,
        status: "checking" as const,
        code: "checking" as const,
        revision: 4,
        version: null,
        checkedAt: null,
      },
    }));
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCliReadiness: (cli) => cli === "kimi"
        ? kimiCheck.promise
        : Promise.resolve(readinessSnapshot(cli, "missing", 4)),
      getOnboardingCliReadinessState,
      getOnboardingCliInstallState: async () => ({
        codex: installSnapshot("codex", "idle", 0),
        claude: installSnapshot("claude", "idle", 0),
        kimi: installSnapshot("kimi", "idle", 0),
      }),
      onOnboardingCliInstallSnapshot(listener) {
        installListener = listener;
        return () => {
          installListener = null;
        };
      },
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      installListener?.(installSnapshot("codex", "running", 1, "verifying"));
      installListener?.(installSnapshot("codex", "succeeded", 2));
    });
    await waitFor(() => getOnboardingCliReadinessState.mock.calls.length === 1);
    expect(document.body.textContent).toContain("正在检查 Kimi CLI");

    await act(async () => kimiCheck.resolve(
      readinessSnapshot("kimi", "ready", 4, "kimi ready rev4"),
    ));
    await waitFor(() => document.body.textContent?.includes("kimi ready rev4") === true);
    expect((await findButton("继续")).disabled).toBe(false);

    await act(async () => {
      installListener?.(installSnapshot("codex", "running", 3, "verifying"));
      installListener?.(installSnapshot("codex", "succeeded", 4));
    });
    await waitFor(() => getOnboardingCliReadinessState.mock.calls.length === 2);
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain("kimi ready rev4");
    expect(document.body.textContent).not.toContain("正在检查 Kimi CLI");
    expect((await findButton("继续")).disabled).toBe(false);
  });

  it("converges a rejected installer start to a safe failure", async () => {
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCliReadiness: async (cli) => cli === "codex"
        ? readinessSnapshot("codex", "missing", 1)
        : cli === "kimi"
          ? readinessSnapshot("kimi", "ready", 1, "kimi 1.2.3")
          : readinessSnapshot("claude", "missing", 1),
      getOnboardingCliInstallState: async () => ({
        codex: installSnapshot("codex", "idle", 0),
        claude: installSnapshot("claude", "idle", 0),
        kimi: installSnapshot("kimi", "idle", 0),
      }),
      startOnboardingCliInstall: async () => {
        throw new Error("/Users/example/private installer failure");
      },
    });

    await act(async () => root.render(<App />));
    const install = await findElement<HTMLButtonElement>(
      'button[aria-label="安装 Codex CLI"]',
    );
    await act(async () => install.click());
    await waitFor(() => document.body.textContent?.includes("Codex CLI 安装未完成") === true);
    expect(document.body.textContent).not.toContain("/Users/example");
  });

  it("requires explicit confirmation before cancelling one CLI installation", async () => {
    const cancelOnboardingCliInstall = vi.fn(async () =>
      installSnapshot("kimi", "cancelled", 2));
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCliReadiness: async (cli) =>
        readinessSnapshot(cli, cli === "codex" ? "ready" : "missing", 1),
      getOnboardingCliInstallState: async () => ({
        codex: installSnapshot("codex", "idle", 0),
        claude: installSnapshot("claude", "idle", 0),
        kimi: installSnapshot("kimi", "running", 1, "installing"),
      }),
      cancelOnboardingCliInstall,
    });

    await act(async () => root.render(<App />));
    const cancel = await findElement<HTMLButtonElement>(
      'button[aria-label="取消安装 Kimi CLI"]',
    );
    await act(async () => cancel.click());
    expect(cancelOnboardingCliInstall).not.toHaveBeenCalled();

    await act(async () => cancel.click());
    await waitFor(() => cancelOnboardingCliInstall.mock.calls.length === 1);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("另一套 CLI 不受影响"));
    await waitFor(() => document.body.textContent?.includes("Kimi CLI 安装已取消") === true);
  });

  it.each([
    {
      name: "a classified unavailable result",
      check: async () => ({
        status: "error" as const,
        message: "Codex 不可用",
        detail: "permission denied at /Users/example/bin/codex",
      }),
    },
    {
      name: "an unknown error result",
      check: async () => ({
        status: "error" as const,
        message: "内部未找到 /Users/example/.codex",
        detail: "raw stderr from /Users/example/.codex",
      }),
    },
    {
      name: "a rejected check",
      check: async () => {
        throw new Error("spawn failed at /Users/example/bin/codex");
      },
    },
  ])("maps $name to safe unavailable recovery", async ({ check }) => {
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex: check,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await waitFor(() => document.body.textContent?.includes("Codex CLI 暂时无法验证") === true);

    expect(document.body.textContent).toContain(
      "暂时无法确认 Agent 可启动，请按终端提示修复后重新检查。",
    );
    expect(document.body.textContent).not.toContain("npm install -g @openai/codex");
    expect(document.body.textContent).not.toContain("/Users/example");
    expect(Array.from(document.querySelectorAll("button")).some(
      (button) => button.getAttribute("aria-label") === "安装 Codex CLI",
    )).toBe(false);
    expect((await findButton("重新检查")).disabled).toBe(false);
    expect((await findButton("继续")).disabled).toBe(true);
  });

  it("finishes replay with Start using and preserves the mounted console draft", async () => {
    const completeOnboarding = vi.fn();
    installApi({
      getOnboardingStatus: async () => ({
        completed: true,
        completedAt: "2026-07-24T00:00:00.000Z",
      }),
      completeOnboarding,
      checkOnboardingCodex: async () => ({
        status: "ok",
        message: "已找到",
        detail: "codex-cli 0.144.1",
      }),
      listAgentTeams: async () => ({
        status: "ready",
        teams: [developmentTeam, editorialTeam],
      }),
    });

    await act(async () => root.render(<App />));
    const consoleBeforeReplay = await findElement(
      '[data-testid="operator-console-preserved-during-onboarding-replay"]',
    );
    const draft = await findElement<HTMLTextAreaElement>('textarea[aria-label="消息内容"]');
    await changeTextarea(draft, "保留这份未提交草稿");
    await clickButton("重新查看引导");

    await findElement('[data-testid="onboarding-step-1"]');
    expect(document.body.textContent).toContain("回看引导");
    await clickButton("继续");
    await clickButton("编辑团队");
    await clickButton("继续");
    await clickButton("继续");
    expect((await findButton("开始使用")).disabled).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("完成回看"),
    )).toBe(false);
    await clickButton("开始使用");

    const consoleAfterReplay = await findElement(
      '[data-testid="operator-console-preserved-during-onboarding-replay"]',
    );
    expect(consoleAfterReplay).toBe(consoleBeforeReplay);
    expect(draft.value).toBe("保留这份未提交草稿");
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid^="onboarding-step-"]')).toBeNull();
  });

  it("keeps global installer activity live when a preserved console starts from zero tasks", async () => {
    let codexReady = false;
    const installListeners = new Set<(
      snapshot: Awaited<ReturnType<NonNullable<DesktopApi["startOnboardingCliInstall"]>>>,
    ) => void>();
    const getOnboardingCliReadinessState = vi.fn(async () => ({
      codex: readinessSnapshot("codex", codexReady ? "ready" : "missing", codexReady ? 2 : 1),
      claude: readinessSnapshot("claude", "missing", 1),
      kimi: readinessSnapshot("kimi", "ready", 1, "kimi 1.2.3"),
    }));
    const checkOnboardingCliReadiness = vi.fn(
      async (cli: "codex" | "claude" | "kimi") => cli === "codex"
        ? readinessSnapshot("codex", codexReady ? "ready" : "missing", codexReady ? 2 : 1)
        : cli === "kimi"
          ? readinessSnapshot("kimi", "ready", 1, "kimi 1.2.3")
          : readinessSnapshot("claude", "missing", 1),
    );
    installApi({
      getOnboardingStatus: async () => ({
        completed: true,
        completedAt: "2026-07-24T00:00:00.000Z",
      }),
      checkOnboardingCliReadiness,
      getOnboardingCliReadinessState,
      getOnboardingCliInstallState: async () => ({
        codex: installSnapshot("codex", "idle", 0),
        claude: installSnapshot("claude", "idle", 0),
        kimi: installSnapshot("kimi", "idle", 0),
      }),
      onOnboardingCliInstallSnapshot(listener) {
        installListeners.add(listener);
        return () => installListeners.delete(listener);
      },
      startOnboardingCliInstall: async () => {
        const snapshot = installSnapshot("codex", "running", 1, "installing");
        for (const listener of installListeners) listener(snapshot);
        return snapshot;
      },
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="operator-sidebar"]');
    await clickButton("重新查看引导");
    const install = await findElement<HTMLButtonElement>(
      'button[aria-label="安装 Codex CLI"]',
    );
    await act(async () => install.click());
    await waitFor(() => document.body.textContent?.includes("Codex CLI 正在安装") === true);

    await clickButton("继续");
    await clickButton("继续");
    await clickButton("继续");
    await clickButton("开始使用");
    await findElement('[data-testid="operator-sidebar"]');
    await waitFor(() => document.body.textContent?.includes("正在安装 Codex…") === true);

    const readinessCallsBeforeCompletion = getOnboardingCliReadinessState.mock.calls.length;
    const checksBeforeCompletion = checkOnboardingCliReadiness.mock.calls.length;
    codexReady = true;
    await act(async () => {
      const succeeded = installSnapshot("codex", "succeeded", 2);
      for (const listener of installListeners) listener(succeeded);
    });
    await waitFor(() => checkOnboardingCliReadiness.mock.calls.length > checksBeforeCompletion);
    await waitFor(() => !document.body.textContent?.includes("正在安装 Codex…"));
    expect(getOnboardingCliReadinessState).toHaveBeenCalledTimes(readinessCallsBeforeCompletion);
    expect(checkOnboardingCliReadiness.mock.calls.at(-1)?.[0]).toBe("codex");
    expect(checkOnboardingCliReadiness.mock.calls.slice(checksBeforeCompletion)).toEqual([["codex"]]);
    expect(document.querySelector('[data-testid*="compatibility"]')).toBeNull();
  });

  it("opens the existing AI team builder service inside step 2", async () => {
    const startOnboardingTeamBuilder = vi.fn(async () => ({
      ok: true as const,
      state: {
        phase: "idle" as const,
        messages: [{
          role: "assistant" as const,
          text: "你希望这支团队长期替你完成什么工作？",
        }],
        proposal: null,
        proposalRevision: null,
        error: null,
        actions: ["cancel" as const],
        selectedTeamId: null,
        builderCli: null,
      },
    }));
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex: async () => ({ status: "ok", message: "已找到" }),
      startOnboardingTeamBuilder,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await clickButton("继续");
    await clickButton("跟 AI 聊出一支新团队");
    await findElement('[aria-label="返回选团队"]');

    expect(startOnboardingTeamBuilder).toHaveBeenCalledWith({ draftId: "onboarding-team-builder" });
    expect(document.body.textContent).toContain("仍在第 2 步");
  });

  it("shows the submitted AI builder message before the desktop IPC turn returns", async () => {
    let resolveSubmit: ((response: AiTeamBuilderIpcResponse) => void) | null = null;
    const submitOnboardingTeamBuilder = vi.fn(() => new Promise<AiTeamBuilderIpcResponse>(
      (resolve) => {
        resolveSubmit = resolve;
      },
    ));
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex: async () => ({ status: "ok", message: "已找到" }),
      startOnboardingTeamBuilder: async () => ({
        ok: true,
        state: {
          phase: "idle",
          messages: [{
            role: "assistant",
            text: "你希望这支团队长期替你完成什么工作？",
          }],
          proposal: null,
          proposalRevision: null,
          error: null,
          actions: ["cancel"],
          selectedTeamId: null,
          builderCli: null,
        },
      }),
      submitOnboardingTeamBuilder,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await clickButton("继续");
    await clickButton("跟 AI 聊出一支新团队");
    const composer = await findElement<HTMLTextAreaElement>(
      'textarea[aria-label="描述团队目标或回答问题"]',
    );
    await changeTextarea(composer, "持续做产品发布");
    const sendButton = await findElement<HTMLButtonElement>('button[aria-label="发送"]');
    await act(async () => sendButton.click());

    const pendingMessage = await findElement('[data-testid="pending-team-builder-user-message"]');
    expect(pendingMessage.textContent).toContain("持续做产品发布");
    expect(document.querySelector('[role="status"][aria-label="AI 正在处理"]')).not.toBeNull();

    await act(async () => resolveSubmit?.({
      ok: true,
      state: {
        phase: "clarifying",
        messages: [
          { role: "assistant", text: "你希望这支团队长期替你完成什么工作？" },
          { role: "user", text: "持续做产品发布" },
          { role: "assistant", text: "主要面向谁？" },
        ],
        proposal: null,
        proposalRevision: null,
        error: null,
        actions: ["cancel"],
        selectedTeamId: null,
        builderCli: "codex",
      },
    }));
    await waitFor(() =>
      document.querySelector('[data-testid="pending-team-builder-user-message"]') === null);

    expect((document.body.textContent?.match(/持续做产品发布/g) ?? [])).toHaveLength(1);
    expect(document.body.textContent).toContain("主要面向谁？");
  });

  function installApi(overrides: Partial<DesktopApi>): void {
    const api: DesktopApi = {
      getLocalConsoleAttachmentCapability: async () => null,
      listAgentTeams: async () => ({ status: "ready", teams: [developmentTeam] }),
      readLastUsedAgentTeam: async () => null,
      ...overrides,
    };
    Object.defineProperty(window, "moebius", {
      configurable: true,
      value: api,
    });
  }

  async function clickButton(name: string): Promise<void> {
    const button = await findButton(name);
    await act(async () => button.click());
  }
});

async function findButton(name: string): Promise<HTMLButtonElement> {
  let found: HTMLButtonElement | undefined;
  await waitFor(() => {
    found = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim().includes(name),
    );
    return found !== undefined;
  });
  return found!;
}

async function findElement<T extends Element = Element>(selector: string): Promise<T> {
  let found: T | null = null;
  await waitFor(() => {
    found = document.querySelector<T>(selector);
    return found !== null;
  });
  return found!;
}

async function changeTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs?: number): Promise<void> {
  await waitForCondition(predicate, {
    describe: "onboarding route",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    pollMs: 10,
    tick: async (ms) => {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, ms));
      });
    },
    snapshot: () => document.body.textContent ?? "",
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readinessSnapshot(
  cli: "codex" | "claude" | "kimi",
  status: "checking" | "ready" | "missing" | "needs-login" | "unavailable",
  revision: number,
  version: string | null = null,
) {
  const code = {
    checking: "checking",
    ready: "ready",
    missing: "cli-missing",
    "needs-login": "authentication-required",
    unavailable: "capability-unavailable",
  } as const;
  return {
    cli,
    status,
    code: code[status],
    revision,
    version,
    checkedAt: "2026-07-26T00:00:00.000Z",
  };
}

function installSnapshot(
  cli: "codex" | "claude" | "kimi",
  status: "idle" | "running" | "succeeded" | "failed" | "cancelled" | "timed-out",
  revision: number,
  stage: "starting" | "downloading" | "installing" | "verifying" | null = null,
) {
  return {
    cli,
    status,
    revision,
    stage,
    displayCommand: cli === "codex"
      ? "npm install -g @openai/codex"
      : cli === "claude"
        ? "curl -fsSL https://claude.ai/install.sh | bash"
        : "curl -LsSf https://code.kimi.com/install.sh | bash",
    startedAt: status === "idle" ? null : "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}

const developmentTeam = {
  id: "development",
  ownership: "system" as const,
  definition: {
    name: "开发团队",
    description: "把目标变成可验证的实现",
    primaryAgentSlug: "dev-manager",
    memberOrder: ["dev-manager", "dev"],
  },
  onboardingOrchestration: {
    status: "ready" as const,
    relayBeats: [
      { speakerSlug: "dev-manager", message: "拆解任务" },
      { speakerSlug: "dev", message: "完成实现" },
    ],
  },
  members: [
    { slug: "dev-manager", displayName: "技术负责人", description: "拆解并收尾" },
    { slug: "dev", displayName: "开发者", description: "实现和验证" },
  ],
  status: "usable" as const,
  canCreateConversation: true,
  issues: [],
};

const editorialTeam = {
  ...developmentTeam,
  id: "editorial",
  ownership: "user" as const,
  definition: {
    ...developmentTeam.definition,
    name: "编辑团队",
    description: "整理内容并复核发布",
  },
};

const project = {
  projectId: "local",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "/tmp/moebius",
  worktreeMode: false,
  workspaceCwd: "/tmp/moebius",
  workspaceMode: "direct",
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: null,
  branchName: "main",
  isGitRepository: true,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions: [],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const localConsoleState = {
  projects: [project],
  project,
  selectedProjectId: "local",
  selectedSessionId: "default",
  selectedSession: null,
  messages: [],
  pendingPrimaryMessages: [],
  childSessions: [],
  activeRun: null,
  activeRuns: [],
  workspaceDiff: { available: false, fileCount: null, reason: "unavailable" },
  sqlitePath: "/tmp/local-console.sqlite",
  lastError: null,
};
