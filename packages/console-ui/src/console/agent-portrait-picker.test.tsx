import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentPortraitPicker } from "./agent-portrait-picker";
import { PORTRAIT_IDS, defaultPortraitId, portraitSrc } from "./agent-portrait";

function triggerPortraitSrc(slug: string): string | null {
  return document.querySelector(`[data-agent-portrait="${slug}"] img`)?.getAttribute("src") ?? null;
}

describe("AgentPortraitPicker", () => {
  it("shows the slug default until a face is chosen, and reports the pick", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AgentPortraitPicker displayName="软件测试" slug="qa" portraitId={null} onChange={onChange} />,
    );

    expect(triggerPortraitSrc("qa")).toBe(portraitSrc(defaultPortraitId("qa")));

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    const options = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(options).toHaveLength(PORTRAIT_IDS.length);

    const chosenIndex = PORTRAIT_IDS.indexOf(defaultPortraitId("qa")) === 0 ? 1 : 0;
    await user.click(options[chosenIndex]!);
    expect(onChange).toHaveBeenCalledWith(PORTRAIT_IDS[chosenIndex]);
  });

  it("reports null rather than the default id when the default face is picked back", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const fallback = defaultPortraitId("qa");
    render(
      <AgentPortraitPicker
        displayName="软件测试"
        slug="qa"
        portraitId={PORTRAIT_IDS[0] === fallback ? PORTRAIT_IDS[1]! : PORTRAIT_IDS[0]!}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    const options = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    await user.click(options[PORTRAIT_IDS.indexOf(fallback)]!);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("only offers restore once a face is actually stored", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <AgentPortraitPicker displayName="软件测试" slug="qa" portraitId={null} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    expect(screen.getByRole("button", { name: "恢复默认画像" })).toBeDisabled();
    await user.keyboard("{Escape}");

    rerender(
      <AgentPortraitPicker
        displayName="软件测试"
        slug="qa"
        portraitId={PORTRAIT_IDS[3]!}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    await user.click(screen.getByRole("button", { name: "恢复默认画像" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders every candidate on the member's own identity colour, so the grid is not a preview lie", async () => {
    const user = userEvent.setup();
    render(
      <AgentPortraitPicker displayName="软件测试" slug="qa" portraitId={null} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    const swatches = within(screen.getByRole("radiogroup"))
      .getAllByRole("radio")
      .map((option) => option.querySelector("span")?.getAttribute("style"));

    expect(new Set(swatches).size).toBe(1);
  });

  it("keeps the whole grid to a single tab stop and moves focus with arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <AgentPortraitPicker displayName="软件测试" slug="qa" portraitId={null} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    const options = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    const startIndex = PORTRAIT_IDS.indexOf(defaultPortraitId("qa"));
    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);

    options[startIndex]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(options[startIndex + 1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[startIndex + 7]);
  });

  it("falls back to the default face when a stored id no longer exists in the pool", () => {
    render(
      <AgentPortraitPicker
        displayName="软件测试"
        slug="qa"
        portraitId="a-face-removed-in-a-later-release"
        onChange={vi.fn()}
      />,
    );

    expect(triggerPortraitSrc("qa")).toBe(portraitSrc(defaultPortraitId("qa")));
  });

  it("stops being a trigger when the detail is read-only", () => {
    render(
      <AgentPortraitPicker
        displayName="软件测试"
        slug="qa"
        portraitId={null}
        disabled
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(triggerPortraitSrc("qa")).toBe(portraitSrc(defaultPortraitId("qa")));
  });
});
