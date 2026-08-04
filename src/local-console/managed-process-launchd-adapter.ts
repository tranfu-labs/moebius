import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { MANAGED_PROCESS_STOP_GRACE_MS } from "../config.js";

const MANIFEST_VERSION = 1;
const LABEL_PREFIX = "moebius.managed-process";
const LAUNCHCTL_PATH = "/bin/launchctl";
const FILE_MODE = 0o600;

export interface LaunchdManagedProcessStartInput {
  executable: string;
  args: readonly string[];
  cwd: string;
  ownershipScopeHash: string;
}

export interface LaunchdManagedProcessAdapterOptions {
  dataRoot: string;
  wrapperProgram: string;
  wrapperProgramArgs: readonly string[];
  wrapperEnvironment?: Readonly<Record<string, string>>;
  platform?: NodeJS.Platform;
  uid?: number;
  commandTimeoutMs?: number;
}

export interface LaunchdManagedProcessHandle {
  processId: string;
  label: string;
  serviceTarget: string;
  manifestPath: string;
  statusPath: string;
  stdoutPath: string;
  stderrPath: string;
  logMetadataPath: string;
}

interface OwnershipIdentity {
  installationId: string;
  key: string;
}

interface OwnershipManifestBody {
  version: number;
  installationId: string;
  uid: number;
  domain: string;
  label: string;
  processId: string;
  plistPath: string;
  plistSha256: string;
  createdAt: string;
  ownershipScopeHash: string;
}

interface OwnershipManifest extends OwnershipManifestBody {
  mac: string;
}

interface StartPayload {
  executable: string;
  args: string[];
  cwd: string;
}

export interface LaunchdWrapperStatus {
  wrapperPid: number;
  targetPid?: number;
  startedAt?: string;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
}

export interface LaunchdReconciliationBlockedFact {
  processId: string;
  code: "managed-process-cleanup-blocked" | "managed-process-cleanup-failed";
}

export interface LaunchdReconciliationResult {
  cleanedProcessIds: string[];
  blocked: LaunchdReconciliationBlockedFact[];
}

export class ManagedProcessUnsupportedError extends Error {
  readonly code = "managed-process-unsupported";
}

export class ManagedProcessCleanupBlockedError extends Error {
  readonly code = "managed-process-cleanup-blocked";
}

export class LaunchdManagedProcessAdapter {
  readonly #root: string;
  readonly #manifestsRoot: string;
  readonly #runtimeRoot: string;
  readonly #identityPath: string;
  readonly #wrapperProgram: string;
  readonly #wrapperProgramArgs: readonly string[];
  readonly #wrapperEnvironment: Readonly<Record<string, string>>;
  readonly #platform: NodeJS.Platform;
  readonly #uid: number;
  readonly #domain: string;
  readonly #commandTimeoutMs: number;

  constructor(options: LaunchdManagedProcessAdapterOptions) {
    this.#root = path.join(options.dataRoot, ".state", "managed-processes");
    this.#manifestsRoot = path.join(this.#root, "manifests");
    this.#runtimeRoot = path.join(this.#root, "runtime");
    this.#identityPath = path.join(this.#root, "ownership.json");
    this.#wrapperProgram = options.wrapperProgram;
    this.#wrapperProgramArgs = [...options.wrapperProgramArgs];
    this.#wrapperEnvironment = { ...options.wrapperEnvironment };
    this.#platform = options.platform ?? process.platform;
    this.#uid = options.uid ?? process.getuid?.() ?? -1;
    this.#domain = `gui/${String(this.#uid)}`;
    this.#commandTimeoutMs = options.commandTimeoutMs ?? 5_000;
  }

  async init(): Promise<void> {
    if (this.#platform !== "darwin") return;
    this.#assertSupported();
    await mkdir(this.#manifestsRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.#runtimeRoot, { recursive: true, mode: 0o700 });
    await this.#loadOrCreateIdentity();
    const domainProbe = await this.#runLaunchctl(["print", this.#domain], true);
    if (domainProbe.exitCode !== 0) {
      throw new ManagedProcessUnsupportedError(`launchd domain ${this.#domain} is unavailable`);
    }
  }

  async start(input: LaunchdManagedProcessStartInput): Promise<LaunchdManagedProcessHandle> {
    this.#assertSupported();
    if (!path.isAbsolute(input.executable) || !path.isAbsolute(input.cwd)) {
      throw new Error("managed process executable and cwd must be absolute after admission");
    }
    if (!/^[0-9a-f]{64}$/u.test(input.ownershipScopeHash)) {
      throw new Error("managed process ownership scope hash is invalid");
    }
    if (input.args.some((value) => typeof value !== "string" || value.includes("\0"))) {
      throw new Error("managed process args must be NUL-free strings");
    }

    const identity = await this.#loadOrCreateIdentity();
    const processId = randomUUID();
    const label = `${LABEL_PREFIX}.${identity.installationId}.${processId}`;
    const itemRoot = path.join(this.#runtimeRoot, processId);
    await mkdir(itemRoot, { recursive: false, mode: 0o700 });
    const payloadPath = path.join(itemRoot, "start.json");
    const plistPath = path.join(itemRoot, "job.plist");
    const statusPath = path.join(itemRoot, "status.json");
    const stdoutPath = path.join(itemRoot, "stdout.log");
    const stderrPath = path.join(itemRoot, "stderr.log");
    const logMetadataPath = path.join(itemRoot, "logs.json");
    const manifestPath = path.join(this.#manifestsRoot, `${processId}.json`);
    const payload: StartPayload = {
      executable: input.executable,
      args: [...input.args],
      cwd: input.cwd,
    };
    await atomicWrite(payloadPath, JSON.stringify(payload), FILE_MODE);
    const plist = buildLaunchdPlist({
      label,
      program: this.#wrapperProgram,
      programArgs: [
        this.#wrapperProgram,
        ...this.#wrapperProgramArgs,
        "--payload",
        payloadPath,
        "--status",
        statusPath,
        "--stdout",
        stdoutPath,
        "--stderr",
        stderrPath,
        "--log-metadata",
        logMetadataPath,
      ],
      cwd: input.cwd,
      stdoutPath,
      stderrPath,
      environment: this.#wrapperEnvironment,
    });
    await atomicWrite(plistPath, plist, FILE_MODE);
    const body: OwnershipManifestBody = {
      version: MANIFEST_VERSION,
      installationId: identity.installationId,
      uid: this.#uid,
      domain: this.#domain,
      label,
      processId,
      plistPath,
      plistSha256: sha256(plist),
      createdAt: new Date().toISOString(),
      ownershipScopeHash: input.ownershipScopeHash,
    };
    const manifest: OwnershipManifest = { ...body, mac: signManifest(body, identity.key) };
    await atomicWrite(manifestPath, JSON.stringify(manifest), FILE_MODE);

    const bootstrap = await this.#runLaunchctl(["bootstrap", this.#domain, plistPath]);
    if (bootstrap.exitCode !== 0) {
      await this.#bestEffortBootout(`${this.#domain}/${label}`);
      await cleanupFiles([manifestPath, payloadPath, plistPath, statusPath]);
      throw new ManagedProcessUnsupportedError(`launchd bootstrap failed: ${bootstrap.stderr}`);
    }
    return {
      processId,
      label,
      serviceTarget: `${this.#domain}/${label}`,
      manifestPath,
      statusPath,
      stdoutPath,
      stderrPath,
      logMetadataPath,
    };
  }

  async isRegistered(handle: Pick<LaunchdManagedProcessHandle, "serviceTarget">): Promise<boolean> {
    const result = await this.#runLaunchctl(["print", handle.serviceTarget], true);
    return result.exitCode === 0;
  }

  async readStatus(handle: Pick<LaunchdManagedProcessHandle, "statusPath">): Promise<LaunchdWrapperStatus | null> {
    try {
      const value = JSON.parse(await readFile(handle.statusPath, "utf8")) as Partial<LaunchdWrapperStatus>;
      const isRunningStatus = Number.isInteger(value.targetPid) && typeof value.startedAt === "string";
      if (!Number.isInteger(value.wrapperPid) || (typeof value.error !== "string" && !isRunningStatus)) {
        return null;
      }
      return value as LaunchdWrapperStatus;
    } catch {
      return null;
    }
  }

  async stop(handle: Pick<LaunchdManagedProcessHandle, "processId">): Promise<void> {
    const manifest = await this.#loadVerifiedManifest(handle.processId);
    await this.#stopService(`${manifest.domain}/${manifest.label}`);
    await cleanupFiles([manifest.plistPath, this.#manifestPath(handle.processId)]);
  }

  async release(handle: Pick<LaunchdManagedProcessHandle, "processId">): Promise<void> {
    const manifest = await this.#loadVerifiedManifest(handle.processId);
    const serviceTarget = `${manifest.domain}/${manifest.label}`;
    const bootout = await this.#runLaunchctl(["bootout", serviceTarget]);
    if (bootout.exitCode !== 0 && await this.isRegistered({ serviceTarget })) {
      throw new ManagedProcessCleanupBlockedError(`launchd bootout failed: ${bootout.stderr}`);
    }
    await cleanupFiles([manifest.plistPath, this.#manifestPath(handle.processId)]);
  }

  async reconcile(): Promise<LaunchdReconciliationResult> {
    if (this.#platform !== "darwin") return { cleanedProcessIds: [], blocked: [] };
    this.#assertSupported();
    const names = await readdir(this.#manifestsRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const result: LaunchdReconciliationResult = { cleanedProcessIds: [], blocked: [] };
    for (const name of names.sort()) {
      if (!name.endsWith(".json")) continue;
      const processId = name.slice(0, -5);
      try {
        const manifest = await this.#loadVerifiedManifest(processId);
        await this.#stopService(`${manifest.domain}/${manifest.label}`);
        await cleanupFiles([manifest.plistPath, this.#manifestPath(processId)]);
        result.cleanedProcessIds.push(processId);
      } catch (error) {
        result.blocked.push({
          processId,
          code: error instanceof ManagedProcessCleanupBlockedError
            ? "managed-process-cleanup-blocked"
            : "managed-process-cleanup-failed",
        });
      }
    }
    return result;
  }

  async #stopService(serviceTarget: string): Promise<void> {
    if (!(await this.isRegistered({ serviceTarget }))) return;
    await this.#runLaunchctl(["kill", "SIGTERM", serviceTarget]);
    const exited = await waitForStatusExit(path.join(this.#runtimeRoot, serviceTarget.slice(serviceTarget.lastIndexOf(".") + 1), "status.json"), MANAGED_PROCESS_STOP_GRACE_MS);
    if (!exited) await this.#runLaunchctl(["kill", "SIGKILL", serviceTarget]);
    const bootout = await this.#runLaunchctl(["bootout", serviceTarget]);
    if (bootout.exitCode !== 0 && await this.isRegistered({ serviceTarget })) {
      throw new ManagedProcessCleanupBlockedError(`launchd bootout failed: ${bootout.stderr}`);
    }
  }

  async #bestEffortBootout(serviceTarget: string): Promise<void> {
    await this.#runLaunchctl(["bootout", serviceTarget]).catch(() => undefined);
  }

  async #loadVerifiedManifest(processId: string): Promise<OwnershipManifestBody> {
    if (!/^[0-9a-f-]{36}$/.test(processId)) {
      throw new ManagedProcessCleanupBlockedError("invalid managed process id");
    }
    const identity = await this.#loadOrCreateIdentity();
    let parsed: OwnershipManifest;
    try {
      parsed = JSON.parse(await readFile(this.#manifestPath(processId), "utf8")) as OwnershipManifest;
    } catch {
      throw new ManagedProcessCleanupBlockedError(`ownership manifest ${processId} is unreadable`);
    }
    const { mac, ...body } = parsed;
    const expectedLabel = `${LABEL_PREFIX}.${identity.installationId}.${processId}`;
    const expectedMac = signManifest(body, identity.key);
    if (
      body.version !== MANIFEST_VERSION ||
      body.installationId !== identity.installationId ||
      body.uid !== this.#uid ||
      body.domain !== this.#domain ||
      body.processId !== processId ||
      body.label !== expectedLabel ||
      !/^[0-9a-f]{64}$/u.test(body.ownershipScopeHash) ||
      typeof mac !== "string" ||
      !safeEqual(mac, expectedMac)
    ) {
      throw new ManagedProcessCleanupBlockedError(`ownership manifest ${processId} failed identity verification`);
    }
    let plist: string;
    try {
      plist = await readFile(body.plistPath, "utf8");
    } catch {
      throw new ManagedProcessCleanupBlockedError(`ownership plist ${processId} is unreadable`);
    }
    if (sha256(plist) !== body.plistSha256) {
      throw new ManagedProcessCleanupBlockedError(`ownership plist ${processId} failed digest verification`);
    }
    return body;
  }

  #manifestPath(processId: string): string {
    return path.join(this.#manifestsRoot, `${processId}.json`);
  }

  async #loadOrCreateIdentity(): Promise<OwnershipIdentity> {
    try {
      return parseIdentity(await readFile(this.#identityPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const identity: OwnershipIdentity = {
      installationId: randomBytes(12).toString("hex"),
      key: randomBytes(32).toString("base64url"),
    };
    try {
      const file = await open(this.#identityPath, "wx", FILE_MODE);
      try {
        await file.writeFile(JSON.stringify(identity), "utf8");
      } finally {
        await file.close();
      }
      return identity;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return parseIdentity(await readFile(this.#identityPath, "utf8"));
    }
  }

  async #runLaunchctl(args: readonly string[], ignoreOutput = false): Promise<{ exitCode: number; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const child = spawn(LAUNCHCTL_PATH, [...args], {
        shell: false,
        stdio: ["ignore", ignoreOutput ? "ignore" : "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < 4_096) stderr += chunk.slice(0, 4_096 - stderr.length);
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), this.#commandTimeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stderr: stderr.trim() });
      });
    });
  }

  #assertSupported(): void {
    if (this.#platform !== "darwin" || this.#uid < 0 || !path.isAbsolute(this.#wrapperProgram)) {
      throw new ManagedProcessUnsupportedError("managed processes require a Darwin launchd user domain");
    }
  }
}

function parseIdentity(raw: string): OwnershipIdentity {
  const parsed = JSON.parse(raw) as Partial<OwnershipIdentity>;
  if (!/^[0-9a-f]{24}$/.test(parsed.installationId ?? "") || typeof parsed.key !== "string" || parsed.key.length < 32) {
    throw new ManagedProcessCleanupBlockedError("managed process ownership identity is invalid");
  }
  return parsed as OwnershipIdentity;
}

function signManifest(body: OwnershipManifestBody, key: string): string {
  return createHmac("sha256", key).update(JSON.stringify(body)).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(filePath: string, contents: string, mode: number): Promise<void> {
  const temporary = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  const file = await open(temporary, "wx", mode);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, filePath);
  const directory = await open(path.dirname(filePath), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

async function waitForStatusExit(statusPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusPath, "utf8")) as { exitedAt?: unknown; error?: unknown };
      if (typeof status.exitedAt === "string" || typeof status.error === "string") return true;
    } catch {
      // The wrapper may not have written its first status yet.
    }
    await delay(50);
  }
  return false;
}

async function cleanupFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map(async (filePath) => {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildLaunchdPlist(input: {
  label: string;
  program: string;
  programArgs: readonly string[];
  cwd: string;
  stdoutPath: string;
  stderrPath: string;
  environment: Readonly<Record<string, string>>;
}): string {
  const environment = Object.entries(input.environment).map(([key, value]) =>
    `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`,
  ).join("\n");
  const environmentBlock = environment.length === 0
    ? ""
    : `\n    <key>EnvironmentVariables</key>\n    <dict>\n${environment}\n    </dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(input.label)}</string>
    <key>Program</key>
    <string>${xml(input.program)}</string>
    <key>ProgramArguments</key>
    <array>
${input.programArgs.map((value) => `      <string>${xml(value)}</string>`).join("\n")}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(input.cwd)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>AbandonProcessGroup</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${xml(input.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(input.stderrPath)}</string>${environmentBlock}
  </dict>
</plist>
`;
}
