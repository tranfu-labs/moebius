import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CredentialVaultError,
  createElectronSafeStoragePort,
  createProviderCredentialVault,
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

  it("delegates directly to the injected safeStorage without spawning a subprocess", async () => {
    // Regression guard: an earlier design spawned a child process to reach
    // Electron's safeStorage, which only worked because unpackaged Electron
    // treats an argv path as an app entry — packaged builds ignore that and
    // relaunch the app's real entry instead, hitting the single-instance
    // lock and never running the helper. Calling safeStorage synchronously,
    // in-process, sidesteps that entirely.
    const isEncryptionAvailable = vi.fn(() => true);
    const encryptString = vi.fn((value: string) => Buffer.from(`protected:${value}`, "utf8"));
    const decryptString = vi.fn((value: Buffer) => value.toString("utf8").slice("protected:".length));
    const port = createElectronSafeStoragePort({ isEncryptionAvailable, encryptString, decryptString });

    expect(await port.isEncryptionAvailable()).toBe(true);
    const ciphertext = await port.encryptString("sk-secret-value");
    await expect(port.decryptString(ciphertext)).resolves.toBe("sk-secret-value");
    expect(isEncryptionAvailable).toHaveBeenCalledOnce();
    expect(encryptString).toHaveBeenCalledWith("sk-secret-value");
    expect(decryptString).toHaveBeenCalledWith(ciphertext);
  });

  it("fails closed instead of throwing when isEncryptionAvailable itself throws", async () => {
    const port = createElectronSafeStoragePort({
      isEncryptionAvailable: () => {
        throw new Error("keychain unavailable");
      },
      encryptString: () => {
        throw new Error("unused");
      },
      decryptString: () => {
        throw new Error("unused");
      },
    });

    expect(await port.isEncryptionAvailable()).toBe(false);
  });

  it("wraps a failing injected safeStorage into CredentialVaultError end to end", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
      safeStorage: createElectronSafeStoragePort({
        isEncryptionAvailable: () => true,
        encryptString: () => {
          throw new Error("native encryption failed");
        },
        decryptString: () => {
          throw new Error("unused");
        },
      }),
    });

    await expect(vault.stage("sk-secret-value")).rejects.toMatchObject({
      code: "CREDENTIAL_ENCRYPTION_FAILED",
    });
  });
});
