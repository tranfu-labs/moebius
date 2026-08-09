import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentRunInfoPopover, type AgentRunInfoView } from "./agent-run-info-popover";

describe("AgentRunInfoPopover", () => {
  it("ignores a late response after the run key changes despite callback identity changes", async () => {
    const first = deferred<AgentRunInfoView>();
    const second = deferred<AgentRunInfoView>();
    const { rerender } = render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={() => first.promise}
      loadMarkdown={async () => ({ markdown: "old" })}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    rerender(<AgentRunInfoPopover
      sessionId="session-a" runId="run-b" role="lead" displayName="Lead"
      loadInfo={() => second.promise}
      loadMarkdown={async () => ({ markdown: "new" })}
    />);
    await act(async () => second.resolve(info("run-b", "New team")));
    expect(await screen.findByText("New team · 用户")).toBeVisible();
    await act(async () => first.resolve(info("run-a", "Old team")));
    expect(screen.queryByText("Old team · 用户")).not.toBeInTheDocument();
  });

  it("opens escaped selectable Markdown through a second explicit load", async () => {
    const loadMarkdown = vi.fn(async () => ({ markdown: "<script>alert(1)</script>" }));
    render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={async () => info("run-a", "Team")}
      loadMarkdown={loadMarkdown}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看当时的 AGENT.md" }));
    expect(await screen.findByText("<script>alert(1)</script>")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    expect(loadMarkdown).toHaveBeenCalledTimes(1);
  });

  it("restores focus through the nested Markdown dialog and back to the avatar", async () => {
    const user = userEvent.setup();
    render(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={async () => info("run-a", "Team")}
      loadMarkdown={async () => ({ markdown: "historical" })}
    />);
    const avatar = screen.getByRole("button", { name: "查看 Lead 当时使用的信息" });

    await user.click(avatar);
    await screen.findByText("Team · 用户");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(avatar).toHaveFocus());

    await user.click(avatar);
    const markdownButton = await screen.findByRole("button", { name: "查看当时的 AGENT.md" });
    await user.click(markdownButton);
    const dialog = await screen.findByRole("dialog", { name: "当时的 AGENT.md" });
    expect(dialog).toBeVisible();
    const closeDialog = screen.getByRole("button", { name: "关闭" });
    await waitFor(() => expect(closeDialog).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog).toHaveAttribute("data-state", "closed"));
    await waitFor(() => expect(markdownButton).toHaveFocus());
    expect(screen.getByText("Team · 用户")).toBeVisible();

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
      loadMarkdown={async () => ({ markdown: "old" })}
    />);
    fireEvent.click(screen.getByRole("button", { name: "查看 Lead 当时使用的信息" }));
    rerender(<AgentRunInfoPopover
      sessionId="session-a" runId="run-a" role="lead" displayName="Lead"
      loadInfo={retryLoader}
      loadMarkdown={async () => ({ markdown: "new" })}
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
        loadMarkdown={async () => ({ markdown: "" })}
      />,
    );

    // 角标与画像不能等弹层加载完才出现——时间线本来就知道它们
    expect(document.querySelector('[data-agent-portrait="lead"]')).not.toBeNull();
    expect(document.querySelector('[data-agent-engine="claude"]')).not.toBeNull();
  });
});

function info(runId: string, teamName: string): AgentRunInfoView {
  return {
    sessionId: "session-a", runId, role: "lead",
    agent: { slug: "lead", displayName: "Lead", description: "Ships" },
    team: { name: teamName, ownership: "user", sourceName: null },
    profile: { cli: "codex", model: "gpt", effort: "high" },
    loadedAt: "2026-08-04T00:00:00.000Z", evidence: "executed",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
