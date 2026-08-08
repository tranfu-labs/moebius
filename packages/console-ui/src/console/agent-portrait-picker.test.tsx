import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

  it("stays open on a pick and grows the chosen face into the preview, so candidates can be compared", async () => {
    const user = userEvent.setup();
    const Harness = (): JSX.Element => {
      const [portraitId, setPortraitId] = useState<string | null>(null);
      return (
        <AgentPortraitPicker
          displayName="软件测试"
          slug="qa"
          portraitId={portraitId}
          onChange={setPortraitId}
        />
      );
    };
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    const preview = (): string | null =>
      screen.getByRole("dialog").querySelector("[data-agent-portrait] img")?.getAttribute("src") ?? null;
    const options = within(screen.getByRole("radiogroup")).getAllByRole("radio");

    await user.click(options[2]!);
    expect(screen.getByRole("radiogroup")).toBeVisible();
    expect(preview()).toBe(portraitSrc(PORTRAIT_IDS[2]!));

    // The whole point of not dismissing: a second candidate can be judged against the first.
    await user.click(options[9]!);
    expect(screen.getByRole("radiogroup")).toBeVisible();
    expect(preview()).toBe(portraitSrc(PORTRAIT_IDS[9]!));

    // Focus follows the pick, so only one ring is lit and the arrows resume from here.
    expect(options.filter((option) => option.tabIndex === 0)).toEqual([options[9]]);
    expect(document.activeElement).toBe(options[9]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(options[10]);
  });

  it("keeps no restore affordance: the default face is simply one of the tiles", async () => {
    const user = userEvent.setup();
    render(
      <AgentPortraitPicker
        displayName="软件测试"
        slug="qa"
        portraitId={PORTRAIT_IDS[3]!}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    expect(screen.queryByRole("button", { name: /恢复|默认|restore|default/iu })).toBeNull();
    // Nothing labels one tile "the default" either; that distinction is ours, not the user's.
    expect(screen.getByRole("radiogroup").textContent).toBe("");
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

  it("keeps candidates large enough to actually tell apart, without relying on hover", async () => {
    const user = userEvent.setup();
    render(
      <AgentPortraitPicker displayName="软件测试" slug="qa" portraitId={null} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    const options = within(screen.getByRole("radiogroup")).getAllByRole("radio");

    for (const option of options) {
      // 40px faces: portrait styles stop reading around 28px, and a candidate the user cannot
      // make out is not a candidate. Fixed and permanent, not revealed by pointer hover.
      expect(option.querySelector("span")).toHaveClass("h-10", "w-10");
      // Tiles follow the grid column rather than a fixed width, so they cannot overflow it.
      expect(option).toHaveClass("aspect-square", "w-full");
      expect(option.className).not.toMatch(/hover:scale|hover:h-|hover:w-/u);
    }
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

  it("opens without the View Transition API and leaves no transition name behind", async () => {
    const user = userEvent.setup();
    expect("startViewTransition" in document).toBe(false); // jsdom: the fallback path

    render(
      <AgentPortraitPicker displayName="软件测试" slug="qa" portraitId={null} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /软件测试/u }));
    expect(screen.getByRole("radiogroup")).toBeVisible();

    // A name left on a detached or idle element would collide with the next morph anywhere in
    // the product, so it must only exist while one is running.
    const named = [...document.querySelectorAll<HTMLElement>("[style]")]
      .filter((element) => element.style.viewTransitionName !== "");
    expect(named).toEqual([]);
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
