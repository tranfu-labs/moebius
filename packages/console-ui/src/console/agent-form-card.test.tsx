import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentFormCard } from "./agent-form-card";
import {
  createAgentFormDraft,
  type AgentFormDraft,
  type AgentFormSpec,
} from "./agent-form-model";

const spec: AgentFormSpec = {
  id: "form-1",
  memberName: "开发",
  memberSlug: "dev",
  questions: [
    {
      id: "wrap-up",
      kind: "single",
      title: "这段做完怎么收尾",
      options: [
        { id: "merge", title: "合并进主线", description: "改动已经自测过" },
        { id: "keep", title: "先留在分支上", description: "还想再看两天" },
      ],
    },
    {
      id: "cleanup",
      kind: "multiple",
      title: "顺手清理哪些东西",
      options: [
        { id: "workspace", title: "删掉独立工作空间" },
        { id: "logs", title: "清掉本地日志" },
      ],
    },
    { id: "note", kind: "text", title: "还有什么要交代的" },
  ],
};

/** The host owns the draft, so the tests drive the card the way the renderer will. */
function Harness({
  spec: formSpec = spec,
  onSubmit,
}: {
  spec?: AgentFormSpec;
  onSubmit?: (message: string) => void;
}): JSX.Element {
  const [draft, setDraft] = React.useState<AgentFormDraft>(() => createAgentFormDraft(formSpec));
  return (
    <AgentFormCard
      spec={formSpec}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={(message) => onSubmit?.(message)}
    />
  );
}

describe("AgentFormCard", () => {
  it("attributes the form and shows where the user is", () => {
    render(<Harness />);

    expect(screen.getByRole("region", { name: "来自 开发 的表单" })).toBeVisible();
    expect(screen.getByText("开发")).toBeVisible();
    expect(screen.getByText("1/3")).toBeVisible();
    expect(screen.getByRole("group", { name: "第 1 题，共 3 题" })).toBeVisible();
  });

  it("advances without an answer and never disables next", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole("button", { name: "上一步" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("2/3")).toBeVisible();
    expect(screen.getByRole("button", { name: "第 1 题，未答" })).toBeVisible();
    expect(screen.getByRole("button", { name: "上一步" })).toBeVisible();
  });

  it("disables send while the whole form is empty, and explains nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));

    const send = screen.getByRole("button", { name: "发送你的回答" });
    expect(send).toBeDisabled();
    expect(screen.queryByRole("button", { name: "下一步" })).not.toBeInTheDocument();
    // 没有可发送的东西这件事，禁用态本身已经说完了。
    expect(send).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/答一题|至少/u)).not.toBeInTheDocument();
  });

  it("appends a write-in option the form never declared", () => {
    render(<Harness />);

    expect(screen.getByRole("radio", { name: /合并进主线/u })).toBeVisible();
    expect(screen.getByRole("radio", { name: /先留在分支上/u })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "这一项可以自己写答案" })).toBeVisible();
  });

  it("treats written text as the selection on a single-choice question", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("radio", { name: /合并进主线/u }));
    expect(screen.getByRole("radio", { name: /合并进主线/u })).toBeChecked();

    await user.type(screen.getByRole("textbox", { name: "这一项可以自己写答案" }), "先合并再删分支");
    expect(screen.getByRole("radio", { name: /合并进主线/u })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "第 1 题，已答" })).toBeVisible();

    await user.clear(screen.getByRole("textbox", { name: "这一项可以自己写答案" }));
    expect(screen.getByRole("button", { name: "第 1 题，未答" })).toBeVisible();
  });

  it("jumps back through the progress track without losing later answers", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("radio", { name: /合并进主线/u }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("checkbox", { name: "清掉本地日志" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));

    await user.click(screen.getByRole("button", { name: "第 1 题，已答" }));
    expect(screen.getByRole("radio", { name: /合并进主线/u })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /先留在分支上/u }));

    await user.click(screen.getByRole("button", { name: "第 2 题，已答" }));
    expect(screen.getByRole("checkbox", { name: "清掉本地日志" })).toBeChecked();
  });

  it("sends one line per answered question and leaves descriptions out", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.click(screen.getByRole("radio", { name: /先留在分支上/u }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("checkbox", { name: "删掉独立工作空间" }));
    await user.click(screen.getByRole("checkbox", { name: "清掉本地日志" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "发送你的回答" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "这段做完怎么收尾：先留在分支上\n顺手清理哪些东西：删掉独立工作空间、清掉本地日志",
    );
  });

  it("drops progress and shows only send for a one-question form", () => {
    const onlyOne: AgentFormSpec = { ...spec, questions: [spec.questions[2]!] };
    render(<Harness spec={onlyOne} />);

    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /共 1 题/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一步" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送你的回答" })).toBeVisible();
  });

  it("starts over when the host swaps the form but keeps the old draft", () => {
    const replacement: AgentFormSpec = { ...spec, id: "form-2" };
    const stale: AgentFormDraft = {
      formId: "form-1",
      activeIndex: 2,
      answers: { note: { selectedOptionIds: [], ownText: "旧答案" } },
    };
    render(<AgentFormCard spec={replacement} draft={stale} />);

    expect(screen.getByText("1/3")).toBeVisible();
    expect(screen.queryByDisplayValue("旧答案")).not.toBeInTheDocument();
  });

  it("completes a whole form from the keyboard", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "第 1 题，未答" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("radio", { name: /合并进主线/u })).toHaveFocus();
    await user.keyboard("[Space]");
    // Enter outside a text area moves on; the focused radio does not swallow it.
    await user.keyboard("{Enter}");
    expect(screen.getByText("2/3")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "删掉独立工作空间" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByText("3/3")).toBeVisible();

    // Advancing hands focus to the new answer area, so typing continues without a reach.
    expect(screen.getByRole("textbox", { name: "还有什么要交代的" })).toHaveFocus();
    await user.keyboard("周五之前{Enter}给我");
    expect(screen.getByText("3/3")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "还有什么要交代的" })).toHaveValue("周五之前\n给我");

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith(
      "这段做完怎么收尾：合并进主线\n还有什么要交代的：周五之前\n给我",
    );
  });
});
