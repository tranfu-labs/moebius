import {
  CapabilityProbeError,
  probeExecutionCapabilities,
  runCommandSafely,
  type SafeCommandRunner,
} from "../execution-capabilities.js";
import type { ExecutionCapabilitySnapshot } from "../team-execution-profile.js";
import type { ExecutionProfile } from "../team-execution-profile.js";
import { selectAiTeamBuilderProfileFromSnapshot } from "../ai-team-builder/execution-profile.js";
import {
  createInitialOnboardingCliReadinessState,
  type OnboardingCli,
  type OnboardingCliReadinessSnapshot,
  type OnboardingCliReadinessState,
} from "./cli-readiness-contract.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export type OnboardingCapabilityProbe = (input: {
  cli: OnboardingCli;
  knownCliVersion: string;
  timeoutMs: number;
  runCommand: SafeCommandRunner;
}) => Promise<ExecutionCapabilitySnapshot>;

export interface OnboardingCliReadinessServiceOptions {
  runCommand?: SafeCommandRunner;
  probeCapabilities?: OnboardingCapabilityProbe;
  now?: () => Date;
  timeoutMs?: number;
}

export class OnboardingCliReadinessService {
  private readonly runCommand: SafeCommandRunner;
  private readonly probeCapabilities: OnboardingCapabilityProbe;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly listeners = new Set<(snapshot: OnboardingCliReadinessSnapshot) => void>();
  private state: OnboardingCliReadinessState = createInitialOnboardingCliReadinessState();
  private readonly capabilities: Record<OnboardingCli, ExecutionCapabilitySnapshot | null> = {
    codex: null,
    kimi: null,
  };

  constructor(options: OnboardingCliReadinessServiceOptions = {}) {
    this.runCommand = options.runCommand ?? runCommandSafely;
    this.probeCapabilities = options.probeCapabilities ?? ((input) =>
      probeExecutionCapabilities(input));
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getSnapshot(cli: OnboardingCli): OnboardingCliReadinessSnapshot {
    return { ...this.state[cli] };
  }

  getState(): OnboardingCliReadinessState {
    return {
      codex: this.getSnapshot("codex"),
      kimi: this.getSnapshot("kimi"),
    };
  }

  subscribe(listener: (snapshot: OnboardingCliReadinessSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkAll(): Promise<OnboardingCliReadinessState> {
    await Promise.all([this.check("codex"), this.check("kimi")]);
    return this.getState();
  }

  async check(cli: OnboardingCli): Promise<OnboardingCliReadinessSnapshot> {
    const revision = this.state[cli].revision + 1;
    this.publish({
      cli,
      status: "checking",
      code: "checking",
      revision,
      version: null,
      checkedAt: null,
    });

    const result = await this.performCheck(cli, revision);
    if (this.state[cli].revision === revision) {
      this.capabilities[cli] = result.capability;
      this.publish(result.snapshot);
    }
    return { ...result.snapshot };
  }

  resolveBuilderExecutionProfile(): ExecutionProfile {
    const codex = this.capabilities.codex;
    const kimi = this.capabilities.kimi;
    if (
      (this.state.codex.status === "ready" || this.state.codex.status === "checking")
      && codex !== null
      && codex.status === "available"
    ) {
      return selectAiTeamBuilderProfileFromSnapshot(codex);
    }
    if (
      (this.state.kimi.status === "ready" || this.state.kimi.status === "checking")
      && kimi !== null
      && kimi.status === "available"
    ) {
      return selectAiTeamBuilderProfileFromSnapshot(kimi);
    }
    throw new OnboardingReadinessUnavailableError();
  }

  private async performCheck(
    cli: OnboardingCli,
    revision: number,
  ): Promise<{
    snapshot: OnboardingCliReadinessSnapshot;
    capability: ExecutionCapabilitySnapshot | null;
  }> {
    let version: string;
    try {
      const result = await this.runCommand(cli, ["--version"], this.timeoutMs);
      version = firstNonEmptyLine(result.stdout) ?? "";
      if (version.length === 0) {
        return {
          snapshot: this.terminal(cli, revision, "unavailable", "version-unavailable", null),
          capability: null,
        };
      }
    } catch (error) {
      return {
        snapshot: isMissingCliError(error)
          ? this.terminal(cli, revision, "missing", "cli-missing", null)
          : this.terminal(cli, revision, "unavailable", "version-unavailable", null),
        capability: null,
      };
    }

    let capability: ExecutionCapabilitySnapshot;
    try {
      capability = await this.probeCapabilities({
        cli,
        knownCliVersion: version,
        timeoutMs: this.timeoutMs,
        runCommand: this.runCommand,
      });
    } catch {
      return {
        snapshot: this.terminal(
          cli,
          revision,
          "unavailable",
          "capability-unavailable",
          version,
        ),
        capability: null,
      };
    }

    if (capability.status === "available" && capability.models.length > 0) {
      return {
        snapshot: this.terminal(cli, revision, "ready", "ready", version),
        capability,
      };
    }
    if (capability.status === "missing") {
      return {
        snapshot: this.terminal(cli, revision, "missing", "cli-missing", null),
        capability,
      };
    }
    if (capability.failureCode === "CLI_VERSION_UNSUPPORTED") {
      return {
        snapshot: this.terminal(
          cli,
          revision,
          "unavailable",
          "version-unsupported",
          version,
        ),
        capability,
      };
    }
    if (capability.failureCode === "AUTHENTICATION_REQUIRED") {
      return {
        snapshot: this.terminal(
          cli,
          revision,
          "needs-login",
          "authentication-required",
          version,
        ),
        capability,
      };
    }
    return {
      snapshot: this.terminal(
        cli,
        revision,
        "unavailable",
        "capability-unavailable",
        version,
      ),
      capability,
    };
  }

  private terminal(
    cli: OnboardingCli,
    revision: number,
    status: Exclude<OnboardingCliReadinessSnapshot["status"], "checking">,
    code: Exclude<OnboardingCliReadinessSnapshot["code"], "checking">,
    version: string | null,
  ): OnboardingCliReadinessSnapshot {
    return {
      cli,
      status,
      code,
      revision,
      version,
      checkedAt: this.now().toISOString(),
    };
  }

  private publish(snapshot: OnboardingCliReadinessSnapshot): void {
    this.state = { ...this.state, [snapshot.cli]: { ...snapshot } };
    for (const listener of this.listeners) {
      listener({ ...snapshot });
    }
  }
}

export class OnboardingReadinessUnavailableError extends Error {
  readonly code = "ONBOARDING_READINESS_UNAVAILABLE";

  constructor() {
    super("Both CLI readiness snapshots must be checked before AI team building.");
    this.name = "OnboardingReadinessUnavailableError";
  }
}

function firstNonEmptyLine(value: string): string | null {
  return value
    .split(/\r?\n/u)
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? null;
}

function isMissingCliError(error: unknown): boolean {
  if (error instanceof CapabilityProbeError) {
    return error.code === "CLI_MISSING";
  }
  return isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
