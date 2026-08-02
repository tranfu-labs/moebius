/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import type { OnboardingCliInstallSnapshot } from "../src/onboarding/cli-installer-contract.js";
import {
  type ConsoleCliInstallationPort,
  useActiveCliInstallationsBundle,
} from "../src/console-page/use-active-cli-installations.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("active CLI installation bundle", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("ignores an old parent subscription and rechecks an accepted terminal event", async () => {
    let firstListener!: (snapshot: OnboardingCliInstallSnapshot) => void;
    let latestListener!: (snapshot: OnboardingCliInstallSnapshot) => void;
    const recheck = vi.fn(async () => undefined);
    const first: ConsoleCliInstallationPort = {
      onOnboardingCliInstallSnapshot(listener) {
        firstListener = listener;
        return () => undefined;
      },
    };
    const latest: ConsoleCliInstallationPort = {
      onOnboardingCliInstallSnapshot(listener) {
        latestListener = listener;
        return () => undefined;
      },
      checkOnboardingCliReadiness: recheck,
    };

    await act(async () => root.render(<InstallationHarness api={first} />));
    await act(async () => root.render(<InstallationHarness api={latest} />));
    await act(async () => firstListener(snapshot("running", 1)));
    expect(host.textContent).toBe("");

    await act(async () => latestListener(snapshot("running", 1)));
    await waitFor(() => host.textContent === "codex");
    await act(async () => latestListener(snapshot("succeeded", 2)));
    await waitFor(() => host.textContent === "");
    expect(recheck).toHaveBeenCalledWith("codex");
  });
});

function InstallationHarness({ api }: { api: ConsoleCliInstallationPort }): JSX.Element {
  const bundle = useActiveCliInstallationsBundle(api);
  return <div>{bundle.activeCliInstallations.join(",")}</div>;
}

function snapshot(
  status: OnboardingCliInstallSnapshot["status"],
  revision: number,
): OnboardingCliInstallSnapshot {
  return {
    cli: "codex",
    status,
    stage: status === "running" ? "installing" : null,
    revision,
    displayCommand: "npm install -g @openai/codex",
    startedAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:01.000Z",
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await waitForCondition(predicate, {
    describe: "active CLI installation state",
    snapshot: () => ({ text: document.body.textContent }),
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
  });
}
