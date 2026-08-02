import { describe, expect, it } from "vitest";

import {
  beginConsoleErrorOperation,
  createConsoleErrorState,
  failConsoleErrorOperation,
  selectVisibleConsoleError,
  succeedConsoleErrorOperation,
} from "../src/console-page/console-error-model.js";

describe("console error ownership model", () => {
  it("keeps unrelated failures unresolved and reveals the previous one after the latest source recovers", () => {
    const initial = createConsoleErrorState();
    const project = beginConsoleErrorOperation(initial, { family: "project", scope: "project-a" });
    const projectFailed = failConsoleErrorOperation(project.state, project.operation, "project failed");
    const attachment = beginConsoleErrorOperation(projectFailed, { family: "attachment", scope: "draft-a" });
    const attachmentFailed = failConsoleErrorOperation(
      attachment.state,
      attachment.operation,
      "attachment failed",
    );

    expect(selectVisibleConsoleError(attachmentFailed)).toBe("attachment failed");
    const attachmentRecovered = succeedConsoleErrorOperation(attachmentFailed, attachment.operation);
    expect(selectVisibleConsoleError(attachmentRecovered)).toBe("project failed");
    expect(selectVisibleConsoleError(
      succeedConsoleErrorOperation(attachmentRecovered, project.operation),
    )).toBeNull();
  });

  it("lets the latest operation replace the same source and ignores stale settlements", () => {
    const first = beginConsoleErrorOperation(createConsoleErrorState(), {
      family: "session-run",
      scope: "session-a:retry",
    });
    const firstFailed = failConsoleErrorOperation(first.state, first.operation, "first failed");
    const retry = beginConsoleErrorOperation(firstFailed, {
      family: "session-run",
      scope: "session-a:retry",
    });

    expect(selectVisibleConsoleError(
      failConsoleErrorOperation(retry.state, first.operation, "stale failure"),
    )).toBe("first failed");
    expect(selectVisibleConsoleError(
      succeedConsoleErrorOperation(retry.state, first.operation),
    )).toBe("first failed");

    const retryFailed = failConsoleErrorOperation(retry.state, retry.operation, "retry failed");
    expect(selectVisibleConsoleError(retryFailed)).toBe("retry failed");
    expect(selectVisibleConsoleError(
      succeedConsoleErrorOperation(retryFailed, retry.operation),
    )).toBeNull();
  });

  it("isolates instances within the same source family", () => {
    const draftA = beginConsoleErrorOperation(createConsoleErrorState(), {
      family: "attachment",
      scope: "draft-a",
    });
    const failedA = failConsoleErrorOperation(draftA.state, draftA.operation, "draft A failed");
    const draftB = beginConsoleErrorOperation(failedA, {
      family: "attachment",
      scope: "draft-b",
    });
    const failedB = failConsoleErrorOperation(draftB.state, draftB.operation, "draft B failed");

    expect(selectVisibleConsoleError(
      succeedConsoleErrorOperation(failedB, draftB.operation),
    )).toBe("draft A failed");
  });
});
