import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const VAULT_VERSION = 1;
const CREDENTIAL_HELPER_TIMEOUT_MS = 5_000;
const CREDENTIAL_HELPER_MAX_OUTPUT_BYTES = 64 * 1024;
const SENSITIVE_ENVIRONMENT_NAME = /(?:api_?key|token|secret|password|authorization|credential|private_?key)/iu;

export interface SafeStoragePort {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(value: string): Promise<Buffer>;
  decryptString(value: Buffer): Promise<string>;
}

export type SafeStorageHelperRequest =
  | { operation: "is-available" }
  | { operation: "encrypt"; value: string }
  | { operation: "decrypt"; value: string };

export type SafeStorageHelperResponse =
  | { ok: true; operation: "is-available"; available: boolean }
  | { ok: true; operation: "encrypt"; ciphertext: string }
  | { ok: true; operation: "decrypt"; value: string }
  | { ok: false; message: string };

export interface SafeStorageHelperRunner {
  (request: SafeStorageHelperRequest): Promise<SafeStorageHelperResponse>;
}

export function createElectronSafeStoragePort(input: {
  helperEntryPath: string;
  appName: string;
  nodePath?: string;
  homeDir?: string;
  timeoutMs?: number;
  runHelper?: SafeStorageHelperRunner;
}): SafeStoragePort {
  const runHelper = input.runHelper ?? ((request) => runCredentialHelper({
    ...input,
    request,
  }));
  return {
    async isEncryptionAvailable() {
      try {
        const response = await runHelper({ operation: "is-available" });
        return response.ok && response.operation === "is-available" && response.available;
      } catch {
        return false;
      }
    },
    async encryptString(value) {
      const response = await runHelper({ operation: "encrypt", value });
      if (!response.ok || response.operation !== "encrypt") {
        throw new Error("credential helper encryption failed");
      }
      return decodeHelperBuffer(response.ciphertext);
    },
    async decryptString(value) {
      const response = await runHelper({
        operation: "decrypt",
        value: value.toString("base64"),
      });
      if (!response.ok || response.operation !== "decrypt") {
        throw new Error("credential helper decryption failed");
      }
      return response.value;
    },
  };
}

interface CredentialVaultDocument {
  version: typeof VAULT_VERSION;
  credentials: Record<string, { ciphertext: string; createdAt: string }>;
}

export interface CredentialVault {
  stage(apiKey: string, now?: string): Promise<string>;
  read(credentialRef: string): Promise<string>;
  remove(credentialRef: string): Promise<void>;
  has(credentialRef: string): Promise<boolean>;
  pruneExcept(retainedCredentialRefs: ReadonlySet<string>): Promise<string[]>;
}

export function createProviderCredentialVault(input: {
  filePath: string;
  safeStorage: SafeStoragePort;
  allocateId?: () => string;
}): CredentialVault {
  const allocateId = input.allocateId ?? randomUUID;

  return {
    async stage(apiKey, now = new Date().toISOString()) {
      const normalizedKey = normalizeApiKey(apiKey);
      await assertEncryptionAvailable(input.safeStorage);
      let encrypted: Buffer;
      try {
        encrypted = await input.safeStorage.encryptString(normalizedKey);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_ENCRYPTION_FAILED", "无法使用系统凭据保护 API Key。");
      }
      const credentialRef = `provider-credential:${allocateId()}`;
      const document = await readDocument(input.filePath);
      document.credentials[credentialRef] = {
        ciphertext: encrypted.toString("base64"),
        createdAt: now,
      };
      try {
        await writeDocument(input.filePath, document);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED", "无法保存系统凭据。");
      }
      return credentialRef;
    },

    async read(credentialRef) {
      assertCredentialRef(credentialRef);
      await assertEncryptionAvailable(input.safeStorage);
      const document = await readDocument(input.filePath);
      const record = document.credentials[credentialRef];
      if (record === undefined) {
        throw new CredentialVaultError("CREDENTIAL_NOT_FOUND", "找不到这个 AI 服务商的凭据。");
      }
      try {
        return normalizeApiKey(await input.safeStorage.decryptString(Buffer.from(record.ciphertext, "base64")));
      } catch {
        throw new CredentialVaultError("CREDENTIAL_DECRYPTION_FAILED", "系统凭据已无法读取，请替换 API Key。");
      }
    },

    async remove(credentialRef) {
      assertCredentialRef(credentialRef);
      const document = await readDocument(input.filePath);
      if (document.credentials[credentialRef] === undefined) {
        return;
      }
      delete document.credentials[credentialRef];
      try {
        await writeDocument(input.filePath, document);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED", "无法删除系统凭据。");
      }
    },

    async has(credentialRef) {
      assertCredentialRef(credentialRef);
      return (await readDocument(input.filePath)).credentials[credentialRef] !== undefined;
    },

    async pruneExcept(retainedCredentialRefs) {
      const document = await readDocument(input.filePath);
      const removed = Object.keys(document.credentials)
        .filter((credentialRef) => !retainedCredentialRefs.has(credentialRef));
      if (removed.length === 0) return [];
      for (const credentialRef of removed) delete document.credentials[credentialRef];
      try {
        await writeDocument(input.filePath, document);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED", "无法清理未完成操作留下的系统凭据。");
      }
      return removed;
    },
  };
}

export class CredentialVaultError extends Error {
  constructor(
    readonly code:
      | "CREDENTIAL_ENCRYPTION_UNAVAILABLE"
      | "CREDENTIAL_ENCRYPTION_FAILED"
      | "CREDENTIAL_DECRYPTION_FAILED"
      | "CREDENTIAL_NOT_FOUND"
      | "CREDENTIAL_WRITE_FAILED"
      | "CREDENTIAL_DOCUMENT_INVALID"
      | "CREDENTIAL_INPUT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CredentialVaultError";
  }
}

async function assertEncryptionAvailable(safeStorage: SafeStoragePort): Promise<void> {
  if (!(await safeStorage.isEncryptionAvailable())) {
    throw new CredentialVaultError(
      "CREDENTIAL_ENCRYPTION_UNAVAILABLE",
      "当前系统无法使用安全凭据存储，请稍后重试。",
    );
  }
}

async function runCredentialHelper(input: {
  helperEntryPath: string;
  appName: string;
  request: SafeStorageHelperRequest;
  nodePath?: string;
  homeDir?: string;
  timeoutMs?: number;
}): Promise<SafeStorageHelperResponse> {
  const child = spawn(input.nodePath ?? process.execPath, [input.helperEntryPath], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: createCredentialHelperEnvironment({
      source: process.env,
      homeDir: input.homeDir ?? os.userInfo().homedir,
      appName: input.appName,
    }),
  });
  return await collectCredentialHelperResponse(child, input.request, input.timeoutMs ?? CREDENTIAL_HELPER_TIMEOUT_MS);
}

function createCredentialHelperEnvironment(input: {
  source: NodeJS.ProcessEnv;
  homeDir: string;
  appName: string;
}): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(input.source).filter(([name]) =>
      name !== "ELECTRON_RUN_AS_NODE" && !SENSITIVE_ENVIRONMENT_NAME.test(name)),
  );
  return {
    ...environment,
    HOME: input.homeDir,
    USERPROFILE: input.homeDir,
    MOEBIUS_SAFE_STORAGE_APP_NAME: input.appName,
  };
}

async function collectCredentialHelperResponse(
  child: ChildProcessWithoutNullStreams,
  request: SafeStorageHelperRequest,
  timeoutMs: number,
): Promise<SafeStorageHelperResponse> {
  return await new Promise<SafeStorageHelperResponse>((resolve, reject) => {
    let settled = false;
    let outputBytes = 0;
    const stdout: Buffer[] = [];
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("credential helper timed out")));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > CREDENTIAL_HELPER_MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("credential helper response is too large")));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => finish(() => reject(new Error("credential helper could not start"))));
    child.once("close", (code) => finish(() => {
      if (code !== 0) {
        reject(new Error("credential helper exited unexpectedly"));
        return;
      }
      try {
        const line = Buffer.concat(stdout).toString("utf8").trim();
        const value = JSON.parse(line) as unknown;
        resolve(parseSafeStorageHelperResponse(value));
      } catch {
        reject(new Error("credential helper response is invalid"));
      }
    }));
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function parseSafeStorageHelperResponse(value: unknown): SafeStorageHelperResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("invalid helper response");
  }
  if (!value.ok) {
    if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 256) {
      throw new Error("invalid helper failure");
    }
    return { ok: false, message: value.message };
  }
  if (value.operation === "is-available" && typeof value.available === "boolean") {
    return { ok: true, operation: "is-available", available: value.available };
  }
  if (value.operation === "encrypt" && typeof value.ciphertext === "string") {
    return { ok: true, operation: "encrypt", ciphertext: value.ciphertext };
  }
  if (value.operation === "decrypt" && typeof value.value === "string") {
    return { ok: true, operation: "decrypt", value: value.value };
  }
  throw new Error("invalid helper success");
}

function decodeHelperBuffer(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error("credential helper returned invalid ciphertext");
  }
  return Buffer.from(value, "base64");
}

function normalizeApiKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 16_384 || /[\r\n\0]/u.test(normalized)) {
    throw new CredentialVaultError("CREDENTIAL_INPUT_INVALID", "API Key 格式无效。");
  }
  return normalized;
}

function assertCredentialRef(value: string): void {
  if (!/^provider-credential:[A-Za-z0-9-]+$/u.test(value)) {
    throw new CredentialVaultError("CREDENTIAL_INPUT_INVALID", "凭据引用无效。");
  }
}

async function readDocument(filePath: string): Promise<CredentialVaultDocument> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: VAULT_VERSION, credentials: {} };
    }
    throw new CredentialVaultError("CREDENTIAL_DOCUMENT_INVALID", "无法读取系统凭据文件。");
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value) || value.version !== VAULT_VERSION || !isRecord(value.credentials)) {
      throw new Error("invalid document");
    }
    const credentials: CredentialVaultDocument["credentials"] = {};
    for (const [credentialRef, record] of Object.entries(value.credentials)) {
      assertCredentialRef(credentialRef);
      if (
        !isRecord(record)
        || typeof record.ciphertext !== "string"
        || !/^[A-Za-z0-9+/]*={0,2}$/u.test(record.ciphertext)
        || typeof record.createdAt !== "string"
        || !Number.isFinite(Date.parse(record.createdAt))
      ) {
        throw new Error("invalid credential record");
      }
      credentials[credentialRef] = {
        ciphertext: record.ciphertext,
        createdAt: record.createdAt,
      };
    }
    return { version: VAULT_VERSION, credentials };
  } catch (error) {
    if (error instanceof CredentialVaultError) {
      throw error;
    }
    throw new CredentialVaultError("CREDENTIAL_DOCUMENT_INVALID", "系统凭据文件已损坏。");
  }
}

async function writeDocument(filePath: string, document: CredentialVaultDocument): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(document)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
