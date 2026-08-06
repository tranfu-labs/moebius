import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT_VERSION = 2;
const LEGACY_VAULT_FILE_NAME = "provider-credentials-v1.json";

interface CredentialVaultDocument {
  version: typeof VAULT_VERSION;
  credentials: Record<string, { apiKey: string; createdAt: string }>;
}

export interface CredentialVault {
  stage(apiKey: string, now?: string): Promise<string>;
  read(credentialRef: string): Promise<string>;
  remove(credentialRef: string): Promise<void>;
  has(credentialRef: string): Promise<boolean>;
  pruneExcept(retainedCredentialRefs: ReadonlySet<string>): Promise<string[]>;
}

// API Keys are stored as plaintext in a 0600 file under the data root — the
// same model as aider / Claude Code on Linux / OpenClaw. An earlier design
// encrypted records with Electron safeStorage; the Keychain master key lives
// on the same machine, so encryption added an environment dependency
// (packaged builds, CI, isolated acceptance environments) without meaningful
// protection for a user's own key on their own machine. Legacy v1 ciphertext
// files are not migrated: they are removed on first access and affected
// profiles fall into the existing "needs attention → replace key" repair
// path via CREDENTIAL_NOT_FOUND.
export function createProviderCredentialVault(input: {
  filePath: string;
  legacyFilePath?: string;
  allocateId?: () => string;
}): CredentialVault {
  const allocateId = input.allocateId ?? randomUUID;
  const legacyFilePath = input.legacyFilePath
    ?? path.join(path.dirname(input.filePath), LEGACY_VAULT_FILE_NAME);
  let legacyCleanup: Promise<void> | null = null;
  const ensureLegacyCleanup = (): Promise<void> => {
    legacyCleanup ??= fs.rm(legacyFilePath, { force: true }).then(
      () => undefined,
      () => undefined,
    );
    return legacyCleanup;
  };

  return {
    async stage(apiKey, now = new Date().toISOString()) {
      const normalizedKey = normalizeApiKey(apiKey);
      await ensureLegacyCleanup();
      const credentialRef = `provider-credential:${allocateId()}`;
      const document = await readDocument(input.filePath);
      document.credentials[credentialRef] = {
        apiKey: normalizedKey,
        createdAt: now,
      };
      try {
        await writeDocument(input.filePath, document);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED", "无法保存本机凭据。");
      }
      return credentialRef;
    },

    async read(credentialRef) {
      assertCredentialRef(credentialRef);
      await ensureLegacyCleanup();
      const document = await readDocument(input.filePath);
      const record = document.credentials[credentialRef];
      if (record === undefined) {
        throw new CredentialVaultError("CREDENTIAL_NOT_FOUND", "找不到这个 AI 服务商的凭据。");
      }
      return normalizeApiKey(record.apiKey);
    },

    async remove(credentialRef) {
      assertCredentialRef(credentialRef);
      await ensureLegacyCleanup();
      const document = await readDocument(input.filePath);
      if (document.credentials[credentialRef] === undefined) {
        return;
      }
      delete document.credentials[credentialRef];
      try {
        await writeDocument(input.filePath, document);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED", "无法删除本机凭据。");
      }
    },

    async has(credentialRef) {
      assertCredentialRef(credentialRef);
      await ensureLegacyCleanup();
      return (await readDocument(input.filePath)).credentials[credentialRef] !== undefined;
    },

    async pruneExcept(retainedCredentialRefs) {
      await ensureLegacyCleanup();
      const document = await readDocument(input.filePath);
      const removed = Object.keys(document.credentials)
        .filter((credentialRef) => !retainedCredentialRefs.has(credentialRef));
      if (removed.length === 0) return [];
      for (const credentialRef of removed) delete document.credentials[credentialRef];
      try {
        await writeDocument(input.filePath, document);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED", "无法清理未完成操作留下的本机凭据。");
      }
      return removed;
    },
  };
}

export class CredentialVaultError extends Error {
  constructor(
    readonly code:
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
    throw new CredentialVaultError("CREDENTIAL_DOCUMENT_INVALID", "无法读取本机凭据文件。");
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
        || typeof record.apiKey !== "string"
        || typeof record.createdAt !== "string"
        || !Number.isFinite(Date.parse(record.createdAt))
      ) {
        throw new Error("invalid credential record");
      }
      credentials[credentialRef] = {
        apiKey: record.apiKey,
        createdAt: record.createdAt,
      };
    }
    return { version: VAULT_VERSION, credentials };
  } catch (error) {
    if (error instanceof CredentialVaultError) {
      throw error;
    }
    throw new CredentialVaultError("CREDENTIAL_DOCUMENT_INVALID", "本机凭据文件已损坏。");
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
