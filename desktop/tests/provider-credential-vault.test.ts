import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialVaultError,
  createElectronSafeStoragePort,
  createProviderCredentialVault,
  type SafeStorageHelperRequest,
  type SafeStoragePort,
} from "../src/provider-credential-vault.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

function fakeSafeStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: async () => true,
    encryptString: async (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: async (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("protected:")) {
        throw new Error("bad ciphertext");
      }
      return text.slice("protected:".length);
    },
  };
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-provider-vault-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "credentials.json");
  return { directory, filePath };
}

describe("provider credential vault", () => {
  it("stores only protected data with owner-only permissions", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
      safeStorage: fakeSafeStorage(),
      allocateId: () => "credential-1",
    });
    const credentialRef = await vault.stage("sk-secret-value", "2026-08-04T12:00:00.000Z");

    expect(credentialRef).toBe("provider-credential:credential-1");
    expect(await vault.read(credentialRef)).toBe("sk-secret-value");
    const text = await fs.readFile(filePath, "utf8");
    expect(text).not.toContain("sk-secret-value");
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("fails closed when encryption is unavailable", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
      safeStorage: { ...fakeSafeStorage(), isEncryptionAvailable: async () => false },
    });
    await expect(vault.stage("sk-secret-value")).rejects.toMatchObject({
      code: "CREDENTIAL_ENCRYPTION_UNAVAILABLE",
    });
    await expect(fs.readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not return empty or fallback data for damaged ciphertext", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
      safeStorage: fakeSafeStorage(),
      allocateId: () => "credential-1",
    });
    const credentialRef = await vault.stage("sk-secret-value");
    const document = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      credentials: Record<string, { ciphertext: string }>;
    };
    document.credentials[credentialRef]!.ciphertext = Buffer.from("damaged", "utf8").toString("base64");
    await fs.writeFile(filePath, JSON.stringify(document), { mode: 0o600 });

    await expect(vault.read(credentialRef)).rejects.toBeInstanceOf(CredentialVaultError);
    await expect(vault.read(credentialRef)).rejects.toMatchObject({ code: "CREDENTIAL_DECRYPTION_FAILED" });
  });

  it("removes a staged revision idempotently", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
      safeStorage: fakeSafeStorage(),
      allocateId: () => "credential-1",
    });
    const credentialRef = await vault.stage("sk-secret-value");
    await vault.remove(credentialRef);
    await vault.remove(credentialRef);
    expect(await vault.has(credentialRef)).toBe(false);
  });

  it("prunes only credential revisions no profile retains", async () => {
    const { filePath } = await fixture();
    let next = 0;
    const vault = createProviderCredentialVault({
      filePath,
      safeStorage: fakeSafeStorage(),
      allocateId: () => `credential-${String(++next)}`,
    });
    const retained = await vault.stage("sk-retained-secret");
    const orphaned = await vault.stage("sk-orphaned-secret");

    await expect(vault.pruneExcept(new Set([retained]))).resolves.toEqual([orphaned]);
    await expect(vault.read(retained)).resolves.toBe("sk-retained-secret");
    await expect(vault.has(orphaned)).resolves.toBe(false);
  });

  it("uses an asynchronous helper transport instead of invoking safeStorage in the caller", async () => {
    const calls: SafeStorageHelperRequest[] = [];
    const safeStorage = createElectronSafeStoragePort({
      helperEntryPath: "/tmp/provider-credential-helper.js",
      appName: "Moebius",
      runHelper: async (request) => {
        calls.push(request);
        if (request.operation === "is-available") {
          return { ok: true, operation: request.operation, available: true };
        }
        if (request.operation === "encrypt") {
          return {
            ok: true,
            operation: request.operation,
            ciphertext: Buffer.from(`protected:${request.value}`, "utf8").toString("base64"),
          };
        }
        return {
          ok: true,
          operation: request.operation,
          value: Buffer.from(request.value, "base64").toString("utf8").slice("protected:".length),
        };
      },
    });

    expect(await safeStorage.isEncryptionAvailable()).toBe(true);
    const ciphertext = await safeStorage.encryptString("sk-secret-value");
    await expect(safeStorage.decryptString(ciphertext)).resolves.toBe("sk-secret-value");
    expect(calls.map((call) => call.operation)).toEqual(["is-available", "encrypt", "decrypt"]);
  });
});
