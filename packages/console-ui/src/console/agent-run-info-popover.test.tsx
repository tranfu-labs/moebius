import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentRunInfoPopover, type AgentRunInfoView } from "./agent-run-info-popover";
import { defaultPortraitId, portraitSrc } from "./agent-portrait";

describe("AgentRunInfoPopover", () => {
  it("threads a chosen portrait into the trigger avatar and falls back to the slug default", () => {
    const { rerender } = render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={async () => info("run-a", "Team")}
    />);
    expect(portraitImage()?.getAttribute("src")).toBe(portraitSrc(defaultPortraitId("lead")));

    rerender(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead" portraitId="bengal"
      loadInfo={async () => info("run-a", "Team")}
    />);
    expect(portraitImage()?.getAttribute("src")).toBe(portraitSrc("bengal"));

    rerender(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead" portraitId={null}
      loadInfo={async () => info("run-a", "Team")}
    />);
    expect(portraitImage()?.getAttribute("src")).toBe(portraitSrc(defaultPortraitId("lead")));
  });
  it("ignores a late response after the run key changes despite callback identity changes", async () => {
    const first = deferred<AgentRunInfoView>();
    const second = deferred<AgentRunInfoView>();
    const { rerender } = render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={() => first.promise}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    rerender(<AgentRunInfoPopover
      sessionId="session-a" runId="run-b" role="lead" displayName="Lead"
      loadInfo={() => second.promise}
    />);
    await act(async () => second.resolve(info("run-b", "New team")));
    expect(await screen.findByText("New team · 用户")).toBeVisible();
    await act(async () => first.resolve(info("run-a", "Old team")));
    expect(screen.queryByText("Old team · 用户")).not.toBeInTheDocument();
  });

  it("opens the historical team member detail from the Popover", async () => {
    const onOpenAgentTeamMember = vi.fn();
    render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={async () => info("run-a", "Team")}
      onOpenAgentTeamMember={onOpenAgentTeamMember}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开 Agent 详情" }));
    expect(onOpenAgentTeamMember).toHaveBeenCalledWith("user:team-a", "lead");
  });

  it("does not offer a detail target when the historical team key is missing", async () => {
    const onOpenAgentTeamMember = vi.fn();
    render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={async () => info("run-a", "Team", null)}
      onOpenAgentTeamMember={onOpenAgentTeamMember}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    await screen.findByText("Team · 用户");
    expect(screen.queryByRole("button", { name: "打开 Agent 详情" })).not.toBeInTheDocument();
    expect(onOpenAgentTeamMember).not.toHaveBeenCalled();
  });

  it("restores focus to the avatar when the Popover closes", async () => {
    const user = userEvent.setup();
    render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={async () => info("run-a", "Team")}
    />);
    const avatar = screen.getByRole("button", { name: "查看 Lead 当时使用的信息" });

    await user.click(avatar);
    await screen.findByText("Team · 用户");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(avatar).toHaveFocus());

    await user.click(avatar);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(avatar).toHaveFocus());
  });

  it("keeps one request across parent callback changes and retries with the latest loader after failure", async () => {
    const first = deferred<AgentRunInfoView>();
    const firstLoader = vi.fn(() => first.promise);
    const retryLoader = vi.fn(async () => info("run-a", "Recovered team"));
    const { rerender } = render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={firstLoader}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    rerender(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={retryLoader}
    />);
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(retryLoader).not.toHaveBeenCalled();

    await act(async () => first.reject(new Error("unavailable")));
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("Recovered team · 用户")).toBeVisible();
    expect(retryLoader).toHaveBeenCalledTimes(1);
  });

  it("shows the roster engine badge before the popover has loaded", () => {
    render(
      <AgentRunInfoPopover
        sessionId="session-a"
        runId="run-a"
        role="lead"
        displayName="Lead"
        portraitId="tuxedo"
        engine={{ cli: "claude" }}
        loadInfo={() => new Promise<AgentRunInfoView>(() => undefined)}
      />,
    );

    // 角标与画像不能等弹层加载完才出现——时间线本来就知道它们
    expect(document.querySelector('[data-agent-portrait="lead"]')).not.toBeNull();
    expect(document.querySelector('[data-agent-engine="claude"]')).not.toBeNull();
  });
});

function info(runId: string, teamName: string, teamKey: string | null = "user:team-a"): AgentRunInfoView {
  return {
    sessionId: "session-a", runId, role: "lead",
    agent: { slug: "lead", displayName: "Lead", description: "Ships" },
    team: { teamKey, name: teamName, ownership: "user", sourceName: null },
    profile: { cli: "codex", model: "gpt", effort: "high" },
    loadedAt: "2026-08-04T00:00:00.000Z", evidence: "executed",
  };
}

function portraitImage(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>('[data-agent-portrait="lead"] img');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
