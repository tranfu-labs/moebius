import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationEmptyState } from "./conversation-empty-state";

describe("ConversationEmptyState", () => {
  it("renders a Codex-style project invitation without a nested composer", () => {
    render(<ConversationEmptyState projectName="moebius" />);

    expect(screen.getByRole("heading", { name: "想在 moebius 中完成什么？" })).toBeInTheDocument();
    expect(screen.getByText("新对话")).toBeVisible();
    expect(screen.getByText("描述你的目标，Moebius 会让团队接力完成。")).toBeVisible();
    expect(document.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
