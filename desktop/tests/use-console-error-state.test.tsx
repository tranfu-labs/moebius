/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useConsoleErrorState } from "../src/console-page/use-console-error-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("console error state controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useConsoleErrorState>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("preserves ownership across parent rerenders and callback identity changes", async () => {
    await render("first");
    const originalController = latest.controller;
    let projectOperation!: ReturnType<typeof latest.controller.begin>;
    await act(async () => {
      projectOperation = latest.controller.begin({ family: "project", scope: "project-a" });
      latest.controller.fail(projectOperation, "project failed");
    });
    expect(latest.visibleMessage).toBe("project failed");

    await render("replacement");
    expect(latest.controller).toBe(originalController);
    let attachmentOperation!: ReturnType<typeof latest.controller.begin>;
    await act(async () => {
      attachmentOperation = latest.controller.begin({ family: "attachment", scope: "draft-a" });
      latest.controller.fail(attachmentOperation, "attachment failed");
      latest.controller.succeed(attachmentOperation);
    });
    expect(latest.visibleMessage).toBe("project failed");
  });

  it("ignores a slow old settlement after a newer operation starts", async () => {
    await render("initial");
    let oldOperation!: ReturnType<typeof latest.controller.begin>;
    let currentOperation!: ReturnType<typeof latest.controller.begin>;
    await act(async () => {
      oldOperation = latest.controller.begin({ family: "analysis", scope: "session-a" });
      latest.controller.fail(oldOperation, "old failure");
      currentOperation = latest.controller.begin({ family: "analysis", scope: "session-a" });
      latest.controller.fail(currentOperation, "current failure");
      latest.controller.succeed(oldOperation);
    });
    expect(latest.visibleMessage).toBe("current failure");
  });

  it("does not resurrect a hidden error after an unrelated rerender", async () => {
    await render("initial");
    let operationA!: ReturnType<typeof latest.controller.begin>;
    let operationB!: ReturnType<typeof latest.controller.begin>;
    await act(async () => {
      operationA = latest.controller.begin({ family: "project", scope: "a" });
      latest.controller.fail(operationA, "error A");
      operationB = latest.controller.begin({ family: "search-navigation", scope: "b" });
      latest.controller.fail(operationB, "error B");
    });
    expect(latest.visibleMessage).toBe("error B");

    await act(async () => latest.controller.succeed(operationA));
    expect(latest.visibleMessage).toBe("error B");

    await render("unrelated rerender");
    await act(async () => latest.controller.succeed(operationB));
    expect(latest.visibleMessage).toBeNull();
  });

  async function render(callbackIdentity: string): Promise<void> {
    await act(async () => root.render(<Harness callbackIdentity={callbackIdentity} />));
  }

  function Harness({ callbackIdentity }: { callbackIdentity: string }): null {
    void callbackIdentity;
    latest = useConsoleErrorState();
    return null;
  }
});
