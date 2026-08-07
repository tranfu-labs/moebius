import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialVaultError,
  createProviderCredentialVault,
} from "../src/provider-credential-vault.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-provider-vault-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "provider-credentials-v2.json");
  return { directory, filePath };
}

describe("provider credential vault", () => {
  it("stores the API key as plaintext with owner-only permissions", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
      allocateId: () => "credential-1",
    });
    const credentialRef = await vault.stage("sk-secret-value", "2026-08-04T12:00:00.000Z");

    expect(credentialRef).toBe("provider-credential:credential-1");
    expect(await vault.read(credentialRef)).toBe("sk-secret-value");
    const document = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      version: number;
      credentials: Record<string, { apiKey: string; createdAt: string }>;
    };
    expect(document.version).toBe(2);
    expect(document.credentials[credentialRef]).toEqual({
      apiKey: "sk-secret-value",
      createdAt: "2026-08-04T12:00:00.000Z",
    });
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("reports a missing record as CREDENTIAL_NOT_FOUND", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({ filePath });

    await expect(vault.read("provider-credential:absent")).rejects.toBeInstanceOf(CredentialVaultError);
    await expect(vault.read("provider-credential:absent")).rejects.toMatchObject({
      code: "CREDENTIAL_NOT_FOUND",
    });
  });

  it("rejects a damaged document instead of returning fallback data", async () => {
    const { filePath } = await fixture();
    await fs.writeFile(filePath, "{ not json", { mode: 0o600 });
    const vault = createProviderCredentialVault({ filePath });

    await expect(vault.read("provider-credential:any")).rejects.toMatchObject({
      code: "CREDENTIAL_DOCUMENT_INVALID",
    });
  });

  it("rejects a legacy v1 ciphertext document as damaged", async () => {
    const { filePath } = await fixture();
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      credentials: {
        "provider-credential:legacy": { ciphertext: "c2VjcmV0", createdAt: "2026-08-04T12:00:00.000Z" },
      },
    }), { mode: 0o600 });
    const vault = createProviderCredentialVault({ filePath });

    await expect(vault.read("provider-credential:legacy")).rejects.toMatchObject({
      code: "CREDENTIAL_DOCUMENT_INVALID",
    });
  });

  it("removes the legacy v1 ciphertext file on first access", async () => {
    const { directory, filePath } = await fixture();
    const legacyFilePath = path.join(directory, "provider-credentials-v1.json");
    await fs.writeFile(legacyFilePath, JSON.stringify({ version: 1, credentials: {} }), { mode: 0o600 });
    const vault = createProviderCredentialVault({ filePath });

    await vault.has("provider-credential:any");

    await expect(fs.stat(legacyFilePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await vault.has("provider-credential:any")).toBe(false);
  });

  it("removes a staged revision idempotently", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({
      filePath,
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
      allocateId: () => `credential-${String(++next)}`,
    });
    const retained = await vault.stage("sk-retained-secret");
    const orphaned = await vault.stage("sk-orphaned-secret");

    await expect(vault.pruneExcept(new Set([retained]))).resolves.toEqual([orphaned]);
    await expect(vault.read(retained)).resolves.toBe("sk-retained-secret");
    await expect(vault.has(orphaned)).resolves.toBe(false);
  });

  it("rejects invalid API key input without writing", async () => {
    const { filePath } = await fixture();
    const vault = createProviderCredentialVault({ filePath });

    await expect(vault.stage("short")).rejects.toMatchObject({ code: "CREDENTIAL_INPUT_INVALID" });
    await expect(fs.readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
