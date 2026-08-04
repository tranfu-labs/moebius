import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";

import { waitForCondition, waitForValue } from "../../src/testing/wait.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface AssertionEvidence {
  id: string;
  passed: boolean;
  observed: unknown;
}

interface ScenarioContext {
  application: ElectronApplication;
  page: Page;
  apiBase: string;
}

interface SessionSummary {
  sessionId: string;
  title: string;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-cli-path-acceptance-"));
const evidenceRoot = await createAcceptanceOutputDirectory("desktop-cli-path-discovery");
const evidencePath = path.join(evidenceRoot, "evidence.json");
const assertions: AssertionEvidence[] = [];
let activeApplication: ElectronApplication | null = null;
let completed = false;

try {
  await scenarioTerminalPathDiscovery();
  await scenarioTcshPathDiscovery();
  await scenarioMissingInstallFailureAndRecovery();
  await scenarioInheritedPathPriorityAndRuntime();
  await scenarioBlockedProfileFallback();
  completed = true;
} finally {
  await closeActiveApplication();
  const evidence = {
    generatedAt: new Date().toISOString(),
    entry: "real Electron onboarding and main conversation with controlled GUI/login-shell PATH",
    fixtureRoot,
    assertions,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    evidencePath,
    fixtureRoot,
    assertionCount: assertions.length,
    passed: completed && assertions.length > 0 && assertions.every((entry) => entry.passed),
  }));
}

async function scenarioTerminalPathDiscovery(): Promise<void> {
  const root = await scenarioRoot("terminal-path");
  const managerBin = path.join(root, "nvm", "versions", "node", "v22", "bin");
  const profileRoot = path.join(root, "zsh");
  const invocationLog = path.join(root, "codex-invocations.jsonl");
  await Promise.all([fs.mkdir(managerBin, { recursive: true }), fs.mkdir(profileRoot, { recursive: true })]);
  await installFakeNode(managerBin);
  await installFakeCodex(managerBin, {
    version: "codex-cli 0.145.1",
    marker: "INTERACTIVE_PATH_CODEX",
    invocationLog,
  });
  await fs.writeFile(
    path.join(profileRoot, ".zshrc"),
    `export PATH=${shellQuote(`${managerBin}:/usr/bin:/bin`)}\n`,
    "utf8",
  );

  const context = await launchDesktop(root, {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/zsh",
    ZDOTDIR: profileRoot,
  });
  await context.page.getByTestId("onboarding-step-1").waitFor();
  await context.page.getByText("Codex CLI 可用", { exact: true }).waitFor({ timeout: 20_000 });
  await context.page.getByText("codex-cli 0.145.1", { exact: true }).waitFor();
  evidence("gui-path-omits-manager-but-terminal-codex-is-ready", true, {
    inheritedPath: "/usr/bin:/bin",
    interactiveBin: managerBin,
    version: "codex-cli 0.145.1",
    apiBase: context.apiBase,
  });
  await closeActiveApplication();
}

async function scenarioTcshPathDiscovery(): Promise<void> {
  const root = await scenarioRoot("tcsh-terminal-path");
  const managerBin = path.join(root, "npm-global", "bin");
  const invocationLog = path.join(root, "codex-invocations.jsonl");
  await fs.mkdir(managerBin, { recursive: true });
  await installFakeNode(managerBin);
  await installFakeCodex(managerBin, {
    version: "codex-cli 0.145.2",
    marker: "TCSH_PATH_CODEX",
    invocationLog,
  });
  await fs.writeFile(
    path.join(root, ".tcshrc"),
    `setenv PATH ${shellQuote(`${managerBin}:/usr/bin:/bin`)}\n`,
    "utf8",
  );

  const context = await launchDesktop(root, {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/tcsh",
  });
  await context.page.getByTestId("onboarding-step-1").waitFor();
  await context.page.getByText("Codex CLI 可用", { exact: true }).waitFor({ timeout: 20_000 });
  await context.page.getByText("codex-cli 0.145.2", { exact: true }).waitFor();
  evidence("tcsh-login-path-discovers-terminal-codex", true, {
    inheritedPath: "/usr/bin:/bin",
    shell: "/bin/tcsh",
    tcshProfile: path.join(root, ".tcshrc"),
    managerBin,
    version: "codex-cli 0.145.2",
    apiBase: context.apiBase,
  });
  await closeActiveApplication();
}

async function scenarioMissingInstallFailureAndRecovery(): Promise<void> {
  const root = await scenarioRoot("install-recovery");
  const globalBin = path.join(root, "npm-global", "bin");
  const profileRoot = path.join(root, "zsh");
  const templatePath = path.join(root, "codex-template");
  const attemptPath = path.join(root, "npm-attempted");
  const invocationLog = path.join(root, "codex-invocations.jsonl");
  await Promise.all([fs.mkdir(globalBin, { recursive: true }), fs.mkdir(profileRoot, { recursive: true })]);
  await installFakeNode(globalBin);
  await fs.writeFile(templatePath, fakeCodexSource({
    version: "codex-cli 0.145.3",
    marker: "NPM_INSTALLED_CODEX",
    invocationLog,
  }), { mode: 0o755 });
  await fs.writeFile(
    path.join(globalBin, "npm"),
    fakeNpmSource({ attemptPath, templatePath, installedPath: path.join(globalBin, "codex") }),
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(profileRoot, ".zshrc"),
    `export PATH=${shellQuote(`${globalBin}:/usr/bin:/bin`)}\n`,
    "utf8",
  );

  const context = await launchDesktop(root, {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/zsh",
    ZDOTDIR: profileRoot,
  });
  await context.page.getByTestId("onboarding-step-1").waitFor();
  await context.page.getByText("Codex CLI 未安装", { exact: true }).waitFor({ timeout: 20_000 });
  const install = context.page.getByRole("button", { name: "安装 Codex CLI" });
  await install.waitFor();
  evidence("truly-missing-codex-shows-install-entry", true, {
    title: "Codex CLI 未安装",
    action: await install.getAttribute("aria-label"),
  });

  await install.click();
  await context.page.getByText("Codex CLI 安装未完成", { exact: true }).waitFor({ timeout: 20_000 });
  const retry = context.page.getByRole("button", { name: "重试安装 Codex CLI" });
  await retry.waitFor();
  const rawFailureVisible = await context.page.getByText(/exit 23|npm-attempted|codex-template/u).count();
  evidence("failed-install-is-safe-and-retryable", rawFailureVisible === 0, {
    title: "Codex CLI 安装未完成",
    retryLabel: await retry.getAttribute("aria-label"),
    rawFailureVisible,
  });

  await retry.click();
  await context.page.getByText("Codex CLI 可用", { exact: true }).waitFor({ timeout: 20_000 });
  await context.page.getByText("codex-cli 0.145.3", { exact: true }).waitFor();
  evidence("successful-install-is-discovered-without-restart-or-manual-recheck", true, {
    version: "codex-cli 0.145.3",
    installedPath: path.join(globalBin, "codex"),
  });
  await closeActiveApplication();
}

async function scenarioInheritedPathPriorityAndRuntime(): Promise<void> {
  const root = await scenarioRoot("inherited-priority");
  const inheritedBin = path.join(root, "inherited-bin");
  const shellBin = path.join(root, "shell-bin");
  const profileRoot = path.join(root, "zsh");
  const invocationLog = path.join(root, "codex-invocations.jsonl");
  const projectFixture = path.join(root, "project");
  await Promise.all([
    fs.mkdir(inheritedBin, { recursive: true }),
    fs.mkdir(shellBin, { recursive: true }),
    fs.mkdir(profileRoot, { recursive: true }),
    fs.mkdir(projectFixture, { recursive: true }),
  ]);
  await Promise.all([installFakeNode(inheritedBin), installFakeNode(shellBin)]);
  await installFakeCodex(inheritedBin, {
    version: "codex-cli 0.145.4",
    marker: "INHERITED_RUNTIME_USED",
    invocationLog,
  });
  await installFakeCodex(shellBin, {
    version: "codex-cli 0.145.5",
    marker: "SHELL_RUNTIME_USED",
    invocationLog,
  });
  await fs.writeFile(
    path.join(profileRoot, ".zshrc"),
    `export PATH=${shellQuote(`${shellBin}:/usr/bin:/bin`)}\n`,
    "utf8",
  );

  const context = await launchDesktop(root, {
    PATH: `${inheritedBin}:/usr/bin:/bin`,
    SHELL: "/bin/zsh",
    ZDOTDIR: profileRoot,
  });
  await context.page.getByTestId("onboarding-step-1").waitFor();
  await context.page.getByText("codex-cli 0.145.4", { exact: true }).waitFor({ timeout: 20_000 });
  evidence("inherited-path-keeps-priority-over-login-shell", true, {
    inheritedVersion: "codex-cli 0.145.4",
    shellVersionVisible: await context.page.getByText("codex-cli 0.145.5", { exact: true }).count(),
  });

  await completeOnboarding(context.page);
  const teamId = await createCodexTeam(context.page);
  const project = await requestJson<{ project: { projectId: string } }>(
    context.apiBase,
    "/api/local-console/projects",
    {
      method: "POST",
      body: JSON.stringify({ folderPath: projectFixture, worktreeMode: false }),
    },
    201,
  );
  const session = await requestJson<{ session: SessionSummary }>(
    context.apiBase,
    "/api/local-console/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.project.projectId,
        title: "PATH runtime acceptance",
        agentTeamOwnership: "user",
        agentTeamId: teamId,
      }),
    },
    201,
  );
  await context.page.reload();
  const sessionRow = context.page.locator(`[data-session-id="${session.session.sessionId}"]`).first();
  await sessionRow.waitFor({ timeout: 20_000 });
  await sessionRow.click();
  const composer = context.page.getByLabel("消息内容");
  await composer.waitFor();
  await composer.fill("验证 repaired PATH 的真实 provider 调用");
  await context.page.getByRole("button", { name: "发送消息" }).click();
  await context.page.getByText("INHERITED_RUNTIME_USED", { exact: true }).waitFor({ timeout: 20_000 });
  const invocations = await readJsonLines<{ marker: string; mode: string }>(invocationLog);
  evidence(
    "onboarding-and-real-provider-run-use-the-same-inherited-codex",
    invocations.some((entry) => entry.marker === "INHERITED_RUNTIME_USED" && entry.mode === "run")
      && !invocations.some((entry) => entry.marker === "SHELL_RUNTIME_USED"),
    { invocations, apiBase: context.apiBase },
  );
  await closeActiveApplication();
}

async function scenarioBlockedProfileFallback(): Promise<void> {
  const root = await scenarioRoot("blocked-profile");
  const inheritedBin = path.join(root, "inherited-bin");
  const profileRoot = path.join(root, "zsh");
  const parentPidPath = path.join(root, "profile-parent.pid");
  const childPidPath = path.join(root, "profile-child.pid");
  const invocationLog = path.join(root, "codex-invocations.jsonl");
  await Promise.all([fs.mkdir(inheritedBin, { recursive: true }), fs.mkdir(profileRoot, { recursive: true })]);
  await installFakeNode(inheritedBin);
  await installFakeCodex(inheritedBin, {
    version: "codex-cli 0.145.6",
    marker: "FALLBACK_CODEX",
    invocationLog,
  });
  const stubbornChildSource = [
    'const fs = require("node:fs");',
    `fs.writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));`,
    'process.on("SIGTERM", () => {});',
    "setInterval(() => {}, 1_000);",
  ].join("");
  await fs.writeFile(path.join(profileRoot, ".zshrc"), [
    `echo $$ > ${shellQuote(parentPidPath)}`,
    `${shellQuote(process.execPath)} -e ${shellQuote(stubbornChildSource)} &`,
    "child=$!",
    `while [ ! -s ${shellQuote(childPidPath)} ]; do :; done`,
    "wait $child",
    "",
  ].join("\n"), "utf8");

  const startedAt = Date.now();
  const context = await launchDesktop(root, {
    PATH: `${inheritedBin}:/usr/bin:/bin`,
    SHELL: "/bin/zsh",
    ZDOTDIR: profileRoot,
  }, 30_000);
  await context.page.getByText("codex-cli 0.145.6", { exact: true }).waitFor({ timeout: 20_000 });
  const parentPid = Number((await fs.readFile(parentPidPath, "utf8")).trim());
  const childPid = Number((await fs.readFile(childPidPath, "utf8")).trim());
  await waitForCondition(
    () => !pidExists(parentPid) && !pidExists(childPid),
    {
      kind: "io",
      timeoutMs: 3_000,
      describe: "blocked PATH profile parent and descendant to be gone after fallback",
      snapshot: () => ({ parentPid, childPid, parentAlive: pidExists(parentPid), childAlive: pidExists(childPid) }),
    },
  );
  const state = await requestJson<{ projects: unknown[] }>(
    context.apiBase,
    "/api/local-console/state",
  );
  evidence("blocked-profile-falls-back-without-orphans-and-local-console-continues", true, {
    elapsedMs: Date.now() - startedAt,
    parentPid,
    childPid,
    parentAlive: pidExists(parentPid),
    childAlive: pidExists(childPid),
    childIgnoredSigterm: true,
    onboardingVisible: await context.page.getByTestId("onboarding-step-1").isVisible(),
    localConsoleApiBase: context.apiBase,
    localConsoleProjectCount: state.projects.length,
  });
  await closeActiveApplication();
}

async function launchDesktop(
  runtimeRoot: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs = 20_000,
): Promise<ScenarioContext> {
  await closeActiveApplication();
  activeApplication = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      ...environment,
      HOME: runtimeRoot,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      MOEBIUS_DISABLE_UPDATE_CHECK: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await activeApplication.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const apiBase = await waitForValue(
    async () => await page.evaluate(async () => await window.moebius?.getLocalConsoleUrl?.() ?? undefined),
    {
      kind: "io",
      timeoutMs,
      describe: "Electron preload to expose the local console URL after PATH resolution",
    },
  );
  return { application: activeApplication, page, apiBase };
}

async function closeActiveApplication(): Promise<void> {
  if (activeApplication === null) return;
  const application = activeApplication;
  activeApplication = null;
  await application.close().catch(() => undefined);
}

async function completeOnboarding(page: Page): Promise<void> {
  for (let step = 1; step <= 3; step += 1) {
    const button = page.getByRole("button", { name: "继续", exact: true });
    await button.waitFor({ timeout: 20_000 });
    await waitForCondition(
      async () => await button.isEnabled(),
      { kind: "io", describe: `onboarding step ${String(step)} Continue button to enable` },
    );
    await button.click();
  }
  const finish = page.getByRole("button", { name: "开始使用", exact: true });
  await finish.waitFor({ timeout: 20_000 });
  await finish.click();
  await page.locator('[data-testid="operator-sidebar"]').waitFor({ timeout: 20_000 });
}

async function createCodexTeam(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    if (window.moebius === undefined) throw new Error("desktop preload is unavailable");
    const team = await window.moebius.createAgentTeam({
      name: "CLI PATH acceptance",
      description: "Controlled PATH runtime fixture",
    });
    const added = await window.moebius.addAgentTeamMember({
      teamId: team.id,
      ownership: "user",
    });
    await window.moebius.saveAgentTeamExecutionProfile({
      teamId: team.id,
      ownership: "user",
      memberSlug: added.member.slug,
      profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
    });
    return team.id;
  });
}

async function scenarioRoot(name: string): Promise<string> {
  const root = path.join(fixtureRoot, name);
  await fs.mkdir(root, { recursive: true });
  return root;
}

async function installFakeNode(bin: string): Promise<void> {
  await fs.symlink(process.execPath, path.join(bin, "node"));
}

async function installFakeCodex(
  bin: string,
  input: { version: string; marker: string; invocationLog: string },
): Promise<void> {
  await fs.writeFile(path.join(bin, "codex"), fakeCodexSource(input), { mode: 0o755 });
}

function fakeCodexSource(input: {
  version: string;
  marker: string;
  invocationLog: string;
}): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const marker = ${JSON.stringify(input.marker)};
const logPath = ${JSON.stringify(input.invocationLog)};
const record = (mode) => fs.appendFileSync(logPath, JSON.stringify({ marker, mode, args }) + "\\n");
if (args.includes("--version")) {
  record("version");
  process.stdout.write(${JSON.stringify(`${input.version}\n`)});
  process.exit(0);
}
if (args[0] === "app-server") {
  record("capability");
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
    } else if (request.method === "account/read") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { account: { type: "chatgpt" }, requiresOpenaiAuth: false } }) + "\\n");
    } else if (request.method === "model/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { data: [{ id: "gpt-5.6-sol", displayName: "GPT 5.6", defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }] } }) + "\\n");
    }
  });
  return;
}
record("run");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
emit({ type: "thread.started", thread_id: "thread-path-" + String(process.pid) });
emit({ type: "item.completed", item: { type: "agent_message", text: marker } });
`;
}

function fakeNpmSource(input: {
  attemptPath: string;
  templatePath: string;
  installedPath: string;
}): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const attemptPath = ${JSON.stringify(input.attemptPath)};
if (!fs.existsSync(attemptPath)) {
  fs.writeFileSync(attemptPath, "failed-once\\n");
  process.exit(23);
}
fs.copyFileSync(${JSON.stringify(input.templatePath)}, ${JSON.stringify(input.installedPath)});
fs.chmodSync(${JSON.stringify(input.installedPath)}, 0o755);
`;
}

async function requestJson<T>(
  apiBase: string,
  pathname: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${pathname} failed: ${String(response.status)} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const content = await fs.readFile(filePath, "utf8");
  return content.split(/\r?\n/u).filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as T);
}

function evidence(id: string, passed: boolean, observed: unknown): void {
  assertions.push({ id, passed, observed });
  if (!passed) throw new Error(`Acceptance assertion failed: ${id}: ${JSON.stringify(observed)}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
