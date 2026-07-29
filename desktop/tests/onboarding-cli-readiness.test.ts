import { describe, expect, it, vi } from "vitest";

import { CapabilityProbeError } from "../src/execution-capabilities.js";
import { capabilitySnapshotId, type ExecutionCapabilitySnapshot } from "../src/team-execution-profile.js";
import { OnboardingCliReadinessService } from "../src/onboarding/cli-readiness.js";

describe("onboarding CLI readiness service", () => {
  it("checks version before capability and exposes only the current real version", async () => {
    const calls: string[] = [];
    const service = new OnboardingCliReadinessService({
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      runCommand: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        return { stdout: `${command}-cli ${command === "codex" ? "0.145.0" : "1.2.3"}\n` };
      },
      probeCapabilities: async (input) => {
        calls.push(`${input.cli} capabilities ${input.knownCliVersion}`);
        return capability(input.cli, "available", input.knownCliVersion);
      },
    });

    await expect(service.checkAll()).resolves.toMatchObject({
      codex: {
        status: "ready",
        version: "codex-cli 0.145.0",
        revision: 1,
        checkedAt: "2026-07-26T00:00:00.000Z",
      },
      kimi: {
        status: "ready",
        version: "kimi-cli 1.2.3",
        revision: 1,
      },
    });
    expect(calls.indexOf("codex --version")).toBeLessThan(
      calls.indexOf("codex capabilities codex-cli 0.145.0"),
    );
    expect(calls.indexOf("kimi --version")).toBeLessThan(
      calls.indexOf("kimi capabilities kimi-cli 1.2.3"),
    );
  });

  it("rejects an old Codex version before probing capabilities", async () => {
    const probeCapabilities = vi.fn(async ({ cli, knownCliVersion }) => capability(
      cli,
      "unavailable",
      knownCliVersion,
      "CLI_VERSION_UNSUPPORTED",
    ));
    const service = new OnboardingCliReadinessService({
      runCommand: async () => ({ stdout: "codex-cli 0.144.1\n" }),
      probeCapabilities,
    });

    await expect(service.check("codex")).resolves.toMatchObject({
      status: "unavailable",
      code: "version-unsupported",
      version: "codex-cli 0.144.1",
    });
    expect(probeCapabilities).toHaveBeenCalledOnce();
  });

  it("classifies missing, empty version, login-required and capability failures safely", async () => {
    const missing = new OnboardingCliReadinessService({
      runCommand: async () => {
        throw Object.assign(new Error("secret path /Users/example/bin/kimi"), { code: "ENOTDIR" });
      },
    });
    await expect(missing.check("kimi")).resolves.toMatchObject({
      status: "missing",
      code: "cli-missing",
      version: null,
    });

    const emptyVersion = new OnboardingCliReadinessService({
      runCommand: async () => ({ stdout: " \n" }),
    });
    await expect(emptyVersion.check("codex")).resolves.toMatchObject({
      status: "unavailable",
      code: "version-unavailable",
      version: null,
    });

    const needsLogin = new OnboardingCliReadinessService({
      runCommand: async () => ({ stdout: "kimi 1.0\n" }),
      probeCapabilities: async () => capability(
        "kimi",
        "unavailable",
        "kimi 1.0",
        "AUTHENTICATION_REQUIRED",
      ),
    });
    await expect(needsLogin.check("kimi")).resolves.toMatchObject({
      status: "needs-login",
      code: "authentication-required",
      version: "kimi 1.0",
    });

    const unavailable = new OnboardingCliReadinessService({
      runCommand: async () => ({ stdout: "codex 1.0\n" }),
      probeCapabilities: async () => capability(
        "codex",
        "unavailable",
        "codex 1.0",
        "CAPABILITY_TIMEOUT",
      ),
    });
    const result = await unavailable.check("codex");
    expect(result).toMatchObject({
      status: "unavailable",
      code: "capability-unavailable",
      version: "codex 1.0",
    });
    expect(JSON.stringify({ missing: missing.getState(), result })).not.toContain("/Users/example");
  });

  it("maps the shared probe missing error without leaking its internal message", async () => {
    const service = new OnboardingCliReadinessService({
      runCommand: async () => {
        throw new CapabilityProbeError("CLI_MISSING", "secret raw stderr");
      },
    });
    const result = await service.check("codex");
    expect(result.status).toBe("missing");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps the last-started revision when an older check finishes later", async () => {
    const first = deferred<ExecutionCapabilitySnapshot>();
    const second = deferred<ExecutionCapabilitySnapshot>();
    const probe = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const service = new OnboardingCliReadinessService({
      runCommand: async () => ({ stdout: "codex 1.0\n" }),
      probeCapabilities: probe,
    });
    const events: Array<{ revision: number; status: string }> = [];
    service.subscribe((snapshot) => events.push({
      revision: snapshot.revision,
      status: snapshot.status,
    }));

    const oldCheck = service.check("codex");
    const newCheck = service.check("codex");
    second.resolve(capability("codex", "available", "codex 1.0"));
    await expect(newCheck).resolves.toMatchObject({ revision: 2, status: "ready" });
    first.resolve(capability(
      "codex",
      "unavailable",
      "codex 1.0",
      "CAPABILITY_TIMEOUT",
    ));
    await expect(oldCheck).resolves.toMatchObject({ revision: 1, status: "unavailable" });

    expect(service.getSnapshot("codex")).toMatchObject({ revision: 2, status: "ready" });
    expect(events).toEqual([
      { revision: 1, status: "checking" },
      { revision: 2, status: "checking" },
      { revision: 2, status: "ready" },
    ]);
  });

  it("selects the builder engine from its shared latest snapshots without a second probe", async () => {
    const independentProbe = vi.fn();
    const service = new OnboardingCliReadinessService({
      runCommand: async (command) => {
        if (command === "codex") {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return { stdout: `${command} 1.0\n` };
      },
      probeCapabilities: async ({ cli, knownCliVersion }) => cli === "codex"
        ? capability("codex", "missing", knownCliVersion, "CLI_MISSING")
        : capability("kimi", "available", knownCliVersion),
    });
    await service.checkAll();

    expect(service.resolveBuilderExecutionProfile()).toEqual({
      cli: "kimi",
      model: "model",
      effort: "high",
    });
    expect(independentProbe).not.toHaveBeenCalled();
  });
});

function capability(
  cli: "codex" | "kimi",
  status: ExecutionCapabilitySnapshot["status"],
  cliVersion: string,
  failureCode?: ExecutionCapabilitySnapshot["failureCode"],
): ExecutionCapabilitySnapshot {
  const models = status === "available"
    ? [{ id: "model", displayName: "Model", efforts: ["high"], defaultEffort: "high" }]
    : [];
  const input = {
    cli,
    cliVersion,
    status,
    models,
    ...(failureCode === undefined ? {} : { failureCode }),
  };
  return {
    ...input,
    snapshotId: capabilitySnapshotId(input),
    checkedAt: "2026-07-26T00:00:00.000Z",
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
