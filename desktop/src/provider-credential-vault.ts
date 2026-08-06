import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SafeStorage } from "electron";

const VAULT_VERSION = 1;

export interface SafeStoragePort {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(value: string): Promise<Buffer>;
  decryptString(value: Buffer): Promise<string>;
}

// Electron 38's safeStorage API is synchronous and only usable from the main
// process after app.whenReady(). safeStorage.encryptString/decryptString run
// against a handful of bytes (an API key), so the synchronous call is a
// microsecond-scale main-thread cost — not worth spawning a helper process
// for. A prior helper-process design relied on Electron's unpackaged-only
// "argv path becomes the app entry" behavior, which silently launches a
// second full app instance (and hits the single-instance lock) in packaged
// builds instead of running the helper script.
export function createElectronSafeStoragePort(
  safeStorage: Pick<SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString">,
): SafeStoragePort {
  return {
    async isEncryptionAvailable() {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    async encryptString(value) {
      return safeStorage.encryptString(value);
    },
    async decryptString(value) {
      return safeStorage.decryptString(value);
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
