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
    expect(screen.getByText("Kimi CLI 未安装")).toBeVisible();
    expect(screen.getByText("npm install -g @openai/codex")).toBeInTheDocument();
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
    expect(screen.getByTestId("onboarding-content-column")).toHaveClass("max-w-lg");
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

    expect(screen.getByTestId("onboarding-content-column")).toHaveClass("max-w-lg");
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByTestId("open-onboarding-team-builder"));

    expect(screen.getByRole("heading", { name: "AI 团队设计器" })).toBeInTheDocument();
    expect(screen.getByText("使用 Codex CLI · 仍在第 2 步")).toBeInTheDocument();
    expect(screen.getByText("第 2 步，共 4 步")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-layout-frame")).toHaveClass("max-w-[780px]");
    expect(screen.getByTestId("onboarding-content-column")).not.toHaveClass("max-w-lg");
    expect(screen.queryByTestId("onboarding-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续" })).not.toBeInTheDocument();
    expect(screen.getByTestId("team-builder-view")).toHaveClass(
      "h-[min(720px,calc(100dvh-220px))]",
    );
    expect(onOpenTeamBuilder).toHaveBeenCalledOnce();
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
    kimi: { status: "missing", revision: 1 },
    ...overrides,
  };
}

function createInstallations(
  overrides: Partial<OnboardingInstallationState> = {},
): OnboardingInstallationState {
  return {
    codex: { cli: "codex", status: "idle", revision: 0 },
    kimi: { cli: "kimi", status: "idle", revision: 0 },
    ...overrides,
  };
}
