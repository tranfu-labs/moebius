import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CapabilityProbeError } from "../src/execution-capabilities.js";
import { KimiExecutableError } from "../../src/kimi-executable.js";
import { capabilitySnapshotId, type ExecutionCapabilitySnapshot } from "../src/team-execution-profile.js";
import { OnboardingCliReadinessService } from "../src/onboarding/cli-readiness.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("onboarding CLI readiness service", () => {
  it("checks version before capability and exposes only the current real version", async () => {
    const calls: string[] = [];
    const service = new OnboardingCliReadinessService({
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      resolveClaudeExecutable: async () => "/trusted/claude",
      resolveKimiExecutable: async () => "/trusted/kimi",
      runCommand: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        const name = command.endsWith("/claude")
          ? "claude"
          : command.endsWith("/kimi")
            ? "kimi"
            : command;
        return {
          stdout: name === "claude"
            ? "2.1.220 (Claude Code)\n"
            : `${name}-cli ${name === "codex" ? "0.145.0" : "1.2.3"}\n`,
        };
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
      claude: {
        status: "ready",
        version: "2.1.220 (Claude Code)",
        revision: 1,
      },
    });
    expect(calls.indexOf("codex --version")).toBeLessThan(
      calls.indexOf("codex capabilities codex-cli 0.145.0"),
    );
    expect(calls.indexOf("/trusted/kimi --version")).toBeLessThan(
      calls.indexOf("kimi capabilities kimi-cli 1.2.3"),
    );
    expect(calls.indexOf("/trusted/claude --version")).toBeLessThan(
      calls.indexOf("claude capabilities 2.1.220 (Claude Code)"),
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
      resolveClaudeExecutable: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
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
      resolveKimiExecutable: async () => {
        throw new KimiExecutableError(
          "kimi-cli-not-found",
          "secret path /Users/example/bin/kimi",
        );
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
      resolveKimiExecutable: async () => "/trusted/kimi",
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
      resolveClaudeExecutable: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      resolveKimiExecutable: async () => "/trusted/kimi",
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

  it("uses the default Kimi executable for both version and provider probes when GUI PATH has none", async () => {
    const fixture = await kimiExecutableFixture();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const service = new OnboardingCliReadinessService({
      pathValue: fixture.emptyBin,
      cwd: fixture.root,
      homeDir: fixture.homeDir,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return {
          stdout: args[0] === "--version"
            ? "0.29.2\n"
            : kimiProviderListJson(),
        };
      },
    });

    await expect(service.check("kimi")).resolves.toMatchObject({
      status: "ready",
      version: "0.29.2",
    });
    expect(calls).toEqual([
      { command: fixture.defaultExecutable, args: ["--version"] },
      {
        command: fixture.defaultExecutable,
        args: ["provider", "list", "--json"],
      },
    ]);
  });

  it("uses the shell-enriched live PATH when no readiness PATH override was injected", async () => {
    const fixture = await kimiExecutableFixture({ withPathExecutable: true });
    const originalPath = process.env.PATH;
    process.env.PATH = fixture.emptyBin;
    const calls: string[] = [];
    const service = new OnboardingCliReadinessService({
      cwd: fixture.root,
      homeDir: fixture.homeDir,
      runCommand: async (command, args) => {
        calls.push(command);
        return {
          stdout: args[0] === "--version"
            ? "0.29.2\n"
            : kimiProviderListJson(),
        };
      },
    });

    try {
      process.env.PATH = fixture.pathBin;
      await expect(service.check("kimi")).resolves.toMatchObject({ status: "ready" });
      expect(calls).toEqual([fixture.pathExecutable, fixture.pathExecutable]);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("uses the first PATH Kimi candidate for both probes instead of the default executable", async () => {
    const fixture = await kimiExecutableFixture({ withPathExecutable: true });
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const service = new OnboardingCliReadinessService({
      pathValue: fixture.pathBin,
      cwd: fixture.root,
      homeDir: fixture.homeDir,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return {
          stdout: args[0] === "--version"
            ? "0.29.2\n"
            : kimiProviderListJson(),
        };
      },
    });

    await expect(service.check("kimi")).resolves.toMatchObject({ status: "ready" });
    expect(calls.map((call) => call.command)).toEqual([
      fixture.pathExecutable,
      fixture.pathExecutable,
    ]);
    expect(calls.some((call) => call.command === fixture.defaultExecutable)).toBe(false);
  });

  it("fails closed on a non-executable authoritative PATH Kimi without probing or fallback", async () => {
    const fixture = await kimiExecutableFixture({
      withPathExecutable: true,
      pathExecutableMode: 0o644,
    });
    const runCommand = vi.fn();
    const probeCapabilities = vi.fn();
    const service = new OnboardingCliReadinessService({
      pathValue: fixture.pathBin,
      cwd: fixture.root,
      homeDir: fixture.homeDir,
      runCommand,
      probeCapabilities,
    });

    await expect(service.check("kimi")).resolves.toMatchObject({
      status: "unavailable",
      code: "version-unavailable",
      version: null,
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(probeCapabilities).not.toHaveBeenCalled();
  });

  it("reports Kimi missing only when PATH and the default location both have no candidate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-readiness-missing-"));
    temporaryRoots.push(root);
    const emptyBin = path.join(root, "empty-bin");
    const homeDir = path.join(root, "home");
    await Promise.all([
      fs.mkdir(emptyBin, { recursive: true }),
      fs.mkdir(homeDir, { recursive: true }),
    ]);
    const runCommand = vi.fn();
    const service = new OnboardingCliReadinessService({
      pathValue: emptyBin,
      cwd: root,
      homeDir,
      runCommand,
    });

    await expect(service.check("kimi")).resolves.toMatchObject({
      status: "missing",
      code: "cli-missing",
      version: null,
    });
    expect(runCommand).not.toHaveBeenCalled();
  });
});

function capability(
  cli: "codex" | "claude" | "kimi",
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

function kimiProviderListJson(): string {
  return JSON.stringify({
    providers: [{
      models: [{
        alias: "kimi-code/kimi-for-coding",
        support_efforts: ["on"],
        default_effort: "on",
      }],
    }],
  });
}

async function kimiExecutableFixture(input: {
  withPathExecutable?: boolean;
  pathExecutableMode?: number;
} = {}): Promise<{
  root: string;
  emptyBin: string;
  pathBin: string;
  homeDir: string;
  pathExecutable: string;
  defaultExecutable: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-readiness-"));
  temporaryRoots.push(root);
  const emptyBin = path.join(root, "empty-bin");
  const pathBin = path.join(root, "path-bin");
  const homeDir = path.join(root, "home");
  const pathExecutable = path.join(pathBin, "kimi");
  const defaultExecutable = path.join(homeDir, ".kimi-code", "bin", "kimi");
  await Promise.all([
    fs.mkdir(emptyBin, { recursive: true }),
    fs.mkdir(pathBin, { recursive: true }),
    fs.mkdir(path.dirname(defaultExecutable), { recursive: true }),
  ]);
  await fs.writeFile(defaultExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  if (input.withPathExecutable === true) {
    await fs.writeFile(pathExecutable, "#!/bin/sh\nexit 0\n", {
      mode: input.pathExecutableMode ?? 0o755,
    });
  }
  return {
    root,
    emptyBin,
    pathBin,
    homeDir,
    pathExecutable,
    defaultExecutable,
  };
}
