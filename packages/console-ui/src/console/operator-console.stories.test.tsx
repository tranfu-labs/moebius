import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectActions } from "./operator-console.stories";

afterEach(() => {
  cleanup();
});

describe("ProjectActions Page Story", () => {
  it("executes every declared project action and observes its local result", async () => {
    installPointerEventForJsdom();
    if (ProjectActions.render === undefined || ProjectActions.play === undefined) {
      throw new Error("ProjectActions must expose both render and play");
    }
    const view = render(ProjectActions.render({} as never, {} as never));
    await ProjectActions.play?.({ canvasElement: view.container } as never);

    expect(view.container.querySelector(
      "[data-testid='conversation-sidebar-project'][data-project-id='project-actions-secondary']",
    )).toBeNull();
    expect(view.container.querySelector("[data-testid='project-actions-feedback']"))
      .toHaveTextContent("项目已从侧栏移除，磁盘文件夹保留。");
  });
});

function installPointerEventForJsdom(): void {
  if (typeof globalThis.PointerEvent === "function") return;
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: TestPointerEvent,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
}
