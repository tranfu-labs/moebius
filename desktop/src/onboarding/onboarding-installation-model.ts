import type { OnboardingCliInstallSnapshot } from "./cli-installer-contract.js";
import type { OnboardingCli } from "./cli-readiness-contract.js";

interface InstallationCursor {
  revision: number;
  status: OnboardingCliInstallSnapshot["status"];
}

export interface OnboardingInstallationModel {
  accepted: Record<OnboardingCli, InstallationCursor>;
}

export function createOnboardingInstallationModel(): OnboardingInstallationModel {
  return {
    accepted: {
      codex: { revision: -1, status: "idle" },
      claude: { revision: -1, status: "idle" },
      kimi: { revision: -1, status: "idle" },
    },
  };
}

export function decideOnboardingInstallationSnapshot(
  model: OnboardingInstallationModel,
  snapshot: OnboardingCliInstallSnapshot,
  options: { allowEqual?: boolean } = {},
): {
  accepted: boolean;
  becameSucceeded: boolean;
  model: OnboardingInstallationModel;
} {
  const previous = model.accepted[snapshot.cli];
  if (
    snapshot.revision < previous.revision
    || (snapshot.revision === previous.revision && options.allowEqual !== true)
  ) {
    return { accepted: false, becameSucceeded: false, model };
  }
  return {
    accepted: true,
    becameSucceeded: previous.status === "running" && snapshot.status === "succeeded",
    model: {
      accepted: {
        ...model.accepted,
        [snapshot.cli]: { revision: snapshot.revision, status: snapshot.status },
      },
    },
  };
}

export function decideConsoleInstallationSnapshot(
  model: OnboardingInstallationModel,
  snapshot: OnboardingCliInstallSnapshot,
): ReturnType<typeof decideOnboardingInstallationSnapshot> & {
  cli: OnboardingCli;
  leftRunning: boolean;
  shouldRecheckEvent: boolean;
} {
  const previousStatus = model.accepted[snapshot.cli].status;
  const decision = decideOnboardingInstallationSnapshot(model, snapshot);
  return {
    ...decision,
    cli: snapshot.cli,
    leftRunning: decision.accepted
      && previousStatus === "running"
      && snapshot.status !== "running",
    shouldRecheckEvent: decision.accepted && snapshot.status !== "running",
  };
}

export function planActiveOnboardingInstallations(
  model: OnboardingInstallationModel,
): OnboardingCli[] {
  return (["codex", "claude", "kimi"] as const).filter(
    (cli) => model.accepted[cli].status === "running",
  );
}

export function planOnboardingInstallationStateLoad(
  available: boolean,
): { kind: "load" } | { kind: "skip" } {
  return available ? { kind: "load" } : { kind: "skip" };
}

export function planOnboardingInstallationStateResult<T>(
  state: T | undefined,
): { kind: "merge"; state: T } | { kind: "skip" } {
  return state === undefined ? { kind: "skip" } : { kind: "merge", state };
}

export function decideOnboardingReadinessRefresh(
  decisions: readonly { becameSucceeded: boolean }[],
): boolean {
  return decisions.some((decision) => decision.becameSucceeded);
}

export function decideOnboardingInstallationMutation(input: {
  transportAvailable: boolean;
  pending: boolean;
  status: OnboardingCliInstallSnapshot["status"];
}): { kind: "run" } | { kind: "skip" } {
  return input.transportAvailable && !input.pending && input.status !== "running"
    ? { kind: "run" }
    : { kind: "skip" };
}

export function decideOnboardingInstallationPolling(input: {
  transportAvailable: boolean;
  statuses: readonly OnboardingCliInstallSnapshot["status"][];
}): { kind: "poll" } | { kind: "skip" } {
  return input.transportAvailable && input.statuses.some((status) => status === "running")
    ? { kind: "poll" }
    : { kind: "skip" };
}

export function decideOnboardingInstallationCancellation(confirmed: boolean): {
  kind: "cancel";
} | { kind: "skip" } {
  return confirmed ? { kind: "cancel" } : { kind: "skip" };
}

export function planOnboardingCliDisplayName(cli: OnboardingCli): string {
  if (cli === "codex") return "Codex";
  return cli === "claude" ? "Claude Code" : "Kimi";
}

export function planOnboardingInstallationView(snapshot: OnboardingCliInstallSnapshot): {
  cli: OnboardingCli;
  status: OnboardingCliInstallSnapshot["status"];
  revision: number;
  stage?: NonNullable<OnboardingCliInstallSnapshot["stage"]>;
} {
  return {
    cli: snapshot.cli,
    status: snapshot.status,
    revision: snapshot.revision,
    ...(snapshot.stage === null ? {} : { stage: snapshot.stage }),
  };
}
