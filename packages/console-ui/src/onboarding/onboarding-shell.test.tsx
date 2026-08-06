import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { I18nProvider } from "@/i18n";
import {
  OnboardingShell,
  type OnboardingShellProps,
} from "./onboarding-shell";
import type {
  OnboardingEnvironmentState,
  OnboardingInstallationState,
} from "./onboarding-state";

const developmentTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: "把目标变成可验证的实现",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "dev"],
  onboardingOrchestration: {
    status: "ready",
    relayBeats: [
      { speakerSlug: "dev-manager", message: "拆解任务" },
      { speakerSlug: "dev", message: "完成实现" },
    ],
  },
  members: [
    {
      slug: "dev-manager",
      displayName: "技术负责人",
      description: "拆解并收尾",
    },
    {
      slug: "dev",
      displayName: "开发者",
      description: "实现和验证",
    },
  ],
  status: "usable",
  canCreateConversation: true,
};

describe("OnboardingShell", () => {
  it("lets a user with no CLI continue after a ready API Provider is present", async () => {
    const missing = { status: "missing" as const, revision: 1 };
    renderShell({
      environment: { codex: missing, claude: missing, kimi: missing },
      providerSettings: {
        state: { status: "ready", profiles: [{
          id: "deepseek-work",
          providerId: "deepseek",
          providerName: "DeepSeek",
          displayName: "工作档案",
          keySuffix: "1234",
          defaultModel: "deepseek-v4-pro",
          verifiedModels: ["deepseek-v4-pro"],
          readiness: "ready",
          reason: null,
          revision: 1,
          updatedAt: "2026-08-04T12:00:00.000Z",
          references: [],
          activity: null,
        }] },
        busyProfileId: null,
        error: null,
        canRetryCreateSave: false,
        refresh: vi.fn(),
        create: vi.fn(async () => true),
        retryCreateSave: vi.fn(async () => true),
        discardCreateSave: vi.fn(),
        rotateKey: vi.fn(async () => true),
        addModel: vi.fn(async () => true),
        setDefaultModel: vi.fn(async () => true),
        removeModel: vi.fn(async () => true),
        replaceDefaultAndRemoveModel: vi.fn(async () => true),
        rename: vi.fn(async () => true),
        disable: vi.fn(async () => undefined),
        enable: vi.fn(async () => undefined),
        migrateReferences: vi.fn(async () => true),
        retryReferenceOperation: vi.fn(async () => true),
        endReference: vi.fn(async () => true),
        delete: vi.fn(async () => undefined),
        cancel: vi.fn(),
      },
    });

    expect(screen.getByText("DeepSeek · Key •••• 1234")).toBeVisible();
    expect(screen.getByRole("button", { name: "继续" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByText(/Pi API/u)).toBeVisible());
  });

  it("offers one atomic API replacement for every unavailable member", async () => {
    const onReplaceTeamWithProvider = vi.fn(async () => undefined);
    const missing = { status: "missing" as const, revision: 1 };
    renderShell({
      environment: { codex: missing, claude: missing, kimi: missing },
      providerSettings: createReadyProviderSettings(),
      teamsState: {
        status: "ready",
        teams: [{
          ...developmentTeam,
          members: developmentTeam.members.map((member) => ({
            ...member,
            executionProfile: {
              binding: { source: "explicit" as const, profile: { cli: "codex" as const, model: "gpt", effort: "high" } },
              recommendation: null,
              effectiveProfile: { cli: "codex" as const, model: "gpt", effort: "high" },
            },
          })),
        }],
      },
      onReplaceTeamWithProvider,
    });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "改用这个 API" })).toBeVisible());
    expect(screen.getByText("也可以暂不替换并继续")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "改用这个 API" }));
    await waitFor(() => expect(onReplaceTeamWithProvider).toHaveBeenCalledWith({
      teamId: "development",
      ownership: "system",
      memberSlugs: ["dev-manager", "dev"],
      providerProfileId: "deepseek-work",
      model: "deepseek-v4-pro",
      effort: "high",
    }));
  });

  it("renders replay copy, exit, and completion without changing first-run copy", async () => {
    const onExit = vi.fn();
    const onComplete = vi.fn(async () => undefined);
    renderShell({
      mode: "replay",
      onExit,
      onComplete,
    });

    expect(screen.getByTestId("onboarding-step-1")).toHaveAttribute("data-onboarding-mode", "replay");
    expect(screen.getByText("回看引导")).toBeInTheDocument();
    expect(screen.queryByText("首次启动")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出引导回看" }));
    expect(onExit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByRole("button", { name: "开始使用" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "完成回看" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("system:development"));
  });

  it("renders the supplied Codex version and uses generic copy when detail is absent", () => {
    const version = "codex-cli 0.144.1";
    const { rerender } = renderShell({
      environment: createEnvironment({
        codex: { status: "ready", revision: 1, version },
      }),
    });

    expect(screen.getByText(version)).toBeVisible();
    expect(screen.queryByText("codex-cli 1.0")).not.toBeInTheDocument();

    const props = createShellProps({
      environment: createEnvironment({
        codex: { status: "ready", revision: 2 },
      }),
    });
    rerender(
      <I18nProvider locale="zh-CN">
        <OnboardingShell {...props} />
      </I18nProvider>,
    );
    expect(screen.getByText("已登录，可用于运行")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\bcodex(?:-cli)?\s+\d+\.\d+/iu);
  });

  it("hard-gates step 1 until either CLI is ready and exposes independent install recovery", async () => {
    const onInstallCli = vi.fn();
    const onRecheckEnvironment = vi.fn();
    renderShell({
      environment: createEnvironment({
        codex: { status: "missing", revision: 1 },
        kimi: { status: "missing", revision: 1 },
      }),
      onInstallCli,
      onRecheckEnvironment,
    });

    expect(screen.getByTestId("moebius-logo")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("首次启动")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退出引导回看" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(screen.getByText("Codex CLI 未安装")).toBeVisible();
    expect(screen.getByText("Claude Code 未安装")).toBeVisible();
    expect(screen.getByText("Kimi CLI 未安装")).toBeVisible();
    expect(screen.getByText("npm install -g @openai/codex")).toBeInTheDocument();
    expect(screen.getByText("curl -fsSL https://claude.ai/install.sh | bash")).toBeInTheDocument();
    expect(screen.getByText(
      "Codex、Claude Code 或 Kimi 至少一个可用，就可以启动团队",
    )).toBeInTheDocument();
    expect(screen.getByText("curl -LsSf https://code.kimi.com/install.sh | bash")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "安装 Kimi CLI" }));
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onInstallCli).toHaveBeenCalledWith("kimi");
    expect(onRecheckEnvironment).toHaveBeenCalledOnce();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toMatch(/\b(?:gh|GitHub|PR|issue)\b/i);
  });

  it("hard-gates unavailable and needs-login CLIs without showing installation recovery", () => {
    renderShell({
      environment: createEnvironment({
        codex: { status: "unavailable", revision: 1 },
        kimi: { status: "needs-login", revision: 1 },
      }),
    });

    expect(screen.getByText("Codex CLI 暂时无法验证")).toBeVisible();
    expect(screen.queryByText(
      "请在终端运行 codex，完成登录或按终端提示修复后，再回来重新检查。",
    )).not.toBeInTheDocument();
    expect(screen.getByText("Kimi CLI 已安装，需要登录")).toBeVisible();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeVisible();
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(screen.queryByText("npm install -g @openai/codex")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /安装 (?:Codex|Kimi) CLI/ })).not.toBeInTheDocument();
  });

  it("shows the installed Codex version and explicit minimum when an upgrade is required", () => {
    renderShell({
      environment: createEnvironment({
        codex: {
          status: "unavailable",
          code: "version-unsupported",
          revision: 1,
          version: "codex-cli 0.144.1",
        },
        kimi: { status: "missing", revision: 1 },
      }),
    });

    expect(screen.getByText("Codex CLI 需要升级")).toBeVisible();
    expect(screen.getByText(
      "当前版本：codex-cli 0.144.1。请升级到 0.145.0 或更高版本后重新检查。",
    )).toBeVisible();
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
  });

  it("offers only the trusted Claude update action for an unsupported installed version", () => {
    const onUpdateClaude = vi.fn();
    const onInstallCli = vi.fn();
    renderShell({
      environment: createEnvironment({
        claude: {
          status: "unavailable",
          code: "version-unsupported",
          revision: 1,
          version: "2.1.169 (Claude Code)",
        },
      }),
      onUpdateClaude,
      onInstallCli,
    });

    expect(screen.getByText("Claude Code 需要升级")).toBeVisible();
    expect(screen.getByText(
      "当前版本：2.1.169 (Claude Code)。请升级到 2.1.170 或更高版本后重新检查。",
    )).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "更新 Claude Code" }));
    expect(onUpdateClaude).toHaveBeenCalledOnce();
    expect(onInstallCli).not.toHaveBeenCalledWith("claude");
  });

  it("allows Kimi-only continuation and keeps Codex recovery visible", () => {
    renderShell({
      environment: createEnvironment({
        codex: { status: "missing", revision: 1 },
        kimi: { status: "ready", revision: 1, version: "kimi 1.2.3" },
      }),
    });

    expect(screen.getByText("Kimi CLI 可用")).toBeVisible();
    expect(screen.getByText("kimi 1.2.3")).toBeVisible();
    expect(screen.getByRole("button", { name: "继续" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "安装 Codex CLI" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeVisible();
  });

  it("keeps running installation feedback in the title bar and supports cancellation", () => {
    const onCancelCliInstallation = vi.fn();
    renderShell({
      installations: createInstallations({
        kimi: { cli: "kimi", status: "running", revision: 2, stage: "downloading" },
      }),
      onCancelCliInstallation,
    });

    fireEvent.click(screen.getByTestId("install-aggregate"));
    expect(screen.getByTestId("install-details")).toBeVisible();
    expect(screen.getAllByText("正在下载安装内容…").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "取消安装 Kimi CLI" })[0]!);
    expect(onCancelCliInstallation).toHaveBeenCalledWith("kimi");
  });

  it("keeps the verifying stage visible instead of collapsing it to generic progress", () => {
    renderShell({
      installations: createInstallations({
        codex: { cli: "codex", status: "running", revision: 3, stage: "verifying" },
      }),
    });

    expect(screen.getByText(
      "安装完成，正在自动复检登录与模型能力…",
    )).toBeVisible();
  });

  it("keeps selection and environment state while navigating all four steps", async () => {
    renderShell();

    expect(screen.getByTestId("onboarding-layout-frame")).toHaveClass("max-w-[780px]");
    expect(screen.getByTestId("onboarding-content-column")).toHaveClass("max-w-[640px]");
    expect(screen.getByTestId("onboarding-progress-bars").children).toHaveLength(4);
    expect(screen.getByTestId("onboarding-step-1")).not.toHaveClass("min-h-[560px]");
    expect(screen.getByTestId("onboarding-footer")).toHaveClass(
      "shrink-0",
      "border-t",
    );
    expect(screen.getByTestId("onboarding-actions")).toHaveClass(
      "max-w-[780px]",
      "justify-end",
      "gap-2",
    );
    expect(screen.getByTestId("onboarding-stage")).not.toContainElement(
      screen.getByTestId("onboarding-actions"),
    );
    expect(screen.queryByText("1 / 4")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-relay-run", "1");
    expect(screen.getByTestId("onboarding-layout-frame")).toHaveClass("max-w-[780px]");
    expect(screen.getByTestId("onboarding-layout-frame")).toHaveClass("justify-start");
    expect(screen.getByTestId("onboarding-content-column")).not.toHaveClass("max-w-lg");
    fireEvent.click(screen.getByRole("button", { name: "重新播放" }));
    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-relay-run", "2");
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByTestId("onboarding-step-4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-relay-run", "3");
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));

    expect(screen.getByTestId("onboarding-step-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the AI builder inline in step 2", () => {
    const onOpenTeamBuilder = vi.fn();
    renderShell({ onOpenTeamBuilder });

    expect(screen.getByTestId("onboarding-content-column")).toHaveClass("max-w-[640px]");
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByTestId("open-onboarding-team-builder"));

    expect(screen.getByRole("heading", { name: "AI 团队设计器" })).toBeInTheDocument();
    expect(screen.getByText("使用 Codex CLI · 仍在第 2 步")).toBeInTheDocument();
    expect(screen.getByText("第 2 步，共 4 步")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-layout-frame")).toHaveClass("max-w-[780px]");
    expect(screen.getByTestId("onboarding-content-column")).not.toHaveClass("max-w-[640px]");
    expect(screen.queryByTestId("onboarding-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续" })).not.toBeInTheDocument();
    expect(screen.getByTestId("team-builder-view")).toHaveClass(
      "h-[min(720px,calc(100dvh-220px))]",
    );
    expect(onOpenTeamBuilder).toHaveBeenCalledOnce();
  });

  it("keeps the Claude-only builder card and inline context label consistent", () => {
    renderShell({
      environment: createEnvironment({
        codex: { status: "missing", revision: 1 },
        claude: { status: "ready", revision: 1, version: "2.1.220 (Claude Code)" },
        kimi: { status: "missing", revision: 1 },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByText(
      "你说一下要做什么样的活，AI 将使用 Claude Code 帮你把成员组齐",
    )).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-onboarding-team-builder"));

    expect(screen.getByText("使用 Claude Code CLI · 仍在第 2 步")).toBeInTheDocument();
    expect(screen.queryByText("使用 Kimi CLI · 仍在第 2 步")).not.toBeInTheDocument();
  });

  it("keeps search, grouped compact teams, the AI entry, and the footer in separate scroll regions", async () => {
    const launchTeam: OperatorAgentTeam = {
      ...developmentTeam,
      teamKey: "user:launch",
      id: "launch",
      ownership: "user",
      name: "发布团队",
      description: "准备发布材料",
      createdAt: "2026-07-30T10:00:00.000Z",
    };
    renderShell({ teamsState: { status: "ready", teams: [developmentTeam, launchTeam] } });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    const search = screen.getByRole("searchbox", { name: "搜索团队" });
    expect(search).toBeVisible();
    expect(screen.getByTestId("onboarding-team-count")).toHaveTextContent("共 2 支团队");
    expect(screen.getByRole("region", { name: "内置团队" })).toBeVisible();
    expect(screen.getByRole("region", { name: "我的团队" })).toBeVisible();

    const scroll = screen.getByTestId("onboarding-team-scroll");
    const aiEntry = screen.getByTestId("open-onboarding-team-builder");
    const footer = screen.getByTestId("onboarding-footer");
    expect(scroll).toHaveClass(
      "min-h-[120px]",
      "min-w-0",
      "overflow-x-hidden",
      "overflow-y-auto",
      "flex-1",
      "shrink-0",
    );
    expect(screen.getByTestId("onboarding-stage")).toHaveClass(
      "[@media(max-height:520px)]:py-3",
    );
    expect(screen.getByTestId("onboarding-content-column")).toHaveClass(
      "[@media(max-height:520px)]:mt-3",
    );
    expect(scroll).not.toContainElement(aiEntry);
    expect(scroll).not.toContainElement(footer);
    for (const team of screen.getAllByRole("button", { name: /团队/u })) {
      if (scroll.contains(team)) expect(team).toHaveClass("min-w-0", "w-full", "max-w-full");
    }

    fireEvent.change(search, { target: { value: "发布" } });
    expect(screen.getByTestId("onboarding-team-count")).toHaveTextContent("匹配 1 / 共 2 支团队");
    expect(screen.getByRole("region", { name: "当前选择" })).toHaveTextContent("开发团队");
    expect(screen.getByRole("region", { name: "我的团队" })).toHaveTextContent("发布团队");
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
  });

  it("preserves a newer search and selection across parent rerenders and callback identity changes", () => {
    const launchTeam: OperatorAgentTeam = {
      ...developmentTeam,
      teamKey: "user:launch",
      id: "launch",
      ownership: "user",
      name: "发布团队",
    };
    const teamsState = { status: "ready" as const, teams: [developmentTeam, launchTeam] };
    const view = renderShell({ teamsState });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索团队" }), { target: { value: "发布" } });
    fireEvent.click(screen.getByRole("button", { name: /发布团队/ }));

    view.rerender(
      <I18nProvider locale="zh-CN">
        <OnboardingShell {...createShellProps({ teamsState, onOpenTeamBuilder: vi.fn() })} />
      </I18nProvider>,
    );
    expect(screen.getByRole("searchbox", { name: "搜索团队" })).toHaveValue("发布");
    expect(screen.getByRole("button", { name: /发布团队/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("distinguishes loading, directory failure, and no usable teams inside the stable selector frame", () => {
    const view = renderShell({ teamsState: { status: "loading" } });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在载入团队");
    expect(screen.getByRole("searchbox", { name: "搜索团队" })).toBeDisabled();
    expect(screen.getByTestId("open-onboarding-team-builder")).toBeDisabled();

    view.rerender(
      <I18nProvider locale="zh-CN">
        <OnboardingShell {...createShellProps({ teamsState: { status: "error" } })} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("团队目录暂时无法读取");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeVisible();

    view.rerender(
      <I18nProvider locale="zh-CN">
        <OnboardingShell {...createShellProps({ teamsState: { status: "ready", teams: [] } })} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("没有可用团队");
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
  });

  it("clears stale search and focuses a newly created team after the builder returns", async () => {
    const createdTeam: OperatorAgentTeam = {
      ...developmentTeam,
      teamKey: "user:created",
      id: "created",
      ownership: "user",
      name: "新团队",
    };
    const teamsState = { status: "ready" as const, teams: [developmentTeam, createdTeam] };
    const onCreatedTeamConsumed = vi.fn();
    const view = renderShell({ teamsState, onCreatedTeamConsumed });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索团队" }), { target: { value: "开发" } });

    view.rerender(
      <I18nProvider locale="zh-CN">
        <OnboardingShell {...createShellProps({
          teamsState,
          createdTeamKey: createdTeam.teamKey,
          onCreatedTeamConsumed,
        })} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索团队" })).toHaveValue(""));
    const created = screen.getByRole("button", { name: /^新团队/u });
    expect(created).toHaveAttribute("aria-pressed", "true");
    expect(created).toHaveFocus();
    expect(onCreatedTeamConsumed).toHaveBeenCalledOnce();
  });

  it("ends partial compatibility messaging at the onboarding boundary", async () => {
    renderShell({
      environment: createEnvironment({
        codex: { status: "missing", revision: 1 },
        claude: { status: "ready", revision: 1, version: "2.1.220 (Claude Code)" },
        kimi: { status: "missing", revision: 1 },
      }),
      teamsState: {
        status: "ready",
        teams: [{
          ...developmentTeam,
          members: developmentTeam.members.map((member) => ({
            ...member,
            executionProfile: {
              binding: { source: "recommended" as const },
              recommendation: { cli: "codex" as const, model: "gpt", effort: "high" },
              effectiveProfile: { cli: "codex" as const, model: "gpt", effort: "high" },
            },
          })),
        }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByText(/其中 \d+ 名成员仍需完成 Codex 准备/u)).toBeVisible();
    expect(screen.queryByText(/进入新对话后仍会保留/u)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ready-compatibility")).not.toBeInTheDocument();
  });

  it("finishes with the selected team key", async () => {
    const onComplete = vi.fn(async () => undefined);
    renderShell({ onComplete });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("system:development"));
  });

  it("keeps continue available when the selected team has no playable orchestration", async () => {
    renderShell({
      teamsState: {
        status: "ready",
        teams: [{
          ...developmentTeam,
          onboardingOrchestration: { status: "unavailable" },
        }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByText("暂无可播放的协作示例")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByTestId("onboarding-step-4")).toBeInTheDocument();
  });
});

function renderShell(overrides: Partial<OnboardingShellProps> = {}) {
  return render(
    <I18nProvider locale="zh-CN">
      <OnboardingShell {...createShellProps(overrides)} />
    </I18nProvider>,
  );
}

function createShellProps(
  overrides: Partial<OnboardingShellProps> = {},
): OnboardingShellProps {
  return {
    environment: createEnvironment(),
    installations: createInstallations(),
    teamsState: { status: "ready", teams: [developmentTeam] },
    teamBuilderState: {
      phase: "idle",
      messages: [{
        role: "assistant",
        text: "你希望这支团队长期替你完成什么工作？",
      }],
      proposal: null,
      proposalRevision: null,
      error: null,
    },
    onRecheckEnvironment: vi.fn(),
    onInstallCli: vi.fn(),
    onCancelCliInstallation: vi.fn(),
    onRetryTeams: vi.fn(),
    onOpenTeamBuilder: vi.fn(),
    onTeamBuilderSubmit: vi.fn(),
    onTeamBuilderAdjust: vi.fn(),
    onTeamBuilderRetry: vi.fn(),
    onTeamBuilderCommit: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
}

function createEnvironment(
  overrides: Partial<OnboardingEnvironmentState> = {},
): OnboardingEnvironmentState {
  return {
    codex: { status: "ready", revision: 1, version: "codex-cli 1.0" },
    claude: { status: "missing", revision: 1 },
    kimi: { status: "missing", revision: 1 },
    ...overrides,
  };
}

function createInstallations(
  overrides: Partial<OnboardingInstallationState> = {},
): OnboardingInstallationState {
  return {
    codex: { cli: "codex", status: "idle", revision: 0 },
    claude: { cli: "claude", status: "idle", revision: 0 },
    kimi: { cli: "kimi", status: "idle", revision: 0 },
    ...overrides,
  };
}

function createReadyProviderSettings(): NonNullable<OnboardingShellProps["providerSettings"]> {
  return {
    state: { status: "ready", profiles: [{
      id: "deepseek-work",
      providerId: "deepseek",
      providerName: "DeepSeek",
      displayName: "工作档案",
      keySuffix: "1234",
      defaultModel: "deepseek-v4-pro",
      verifiedModels: ["deepseek-v4-pro"],
      readiness: "ready",
      reason: null,
      revision: 1,
      updatedAt: "2026-08-04T12:00:00.000Z",
      references: [],
      activity: null,
    }] },
    busyProfileId: null,
    error: null,
    canRetryCreateSave: false,
    refresh: vi.fn(),
    create: vi.fn(async () => true),
    retryCreateSave: vi.fn(async () => true),
    discardCreateSave: vi.fn(),
    rotateKey: vi.fn(async () => true),
    addModel: vi.fn(async () => true),
    setDefaultModel: vi.fn(async () => true),
    removeModel: vi.fn(async () => true),
    replaceDefaultAndRemoveModel: vi.fn(async () => true),
    rename: vi.fn(async () => true),
    disable: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    migrateReferences: vi.fn(async () => true),
    retryReferenceOperation: vi.fn(async () => true),
    endReference: vi.fn(async () => true),
    delete: vi.fn(async () => undefined),
    cancel: vi.fn(),
  };
}
