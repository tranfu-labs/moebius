import { app, safeStorage } from "electron";
import type {
  SafeStorageHelperRequest,
  SafeStorageHelperResponse,
} from "./provider-credential-vault.js";

const MAX_INPUT_BYTES = 32 * 1024;

app.setName(process.env.MOEBIUS_SAFE_STORAGE_APP_NAME?.trim() || app.getName());

void run();

async function run(): Promise<void> {
  try {
    const request = parseRequest(await readRequest());
    await app.whenReady();
    const response = execute(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
    app.quit();
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, message: "系统凭据操作失败。" } satisfies SafeStorageHelperResponse)}\n`);
    app.exit(1);
  }
}

function execute(request: SafeStorageHelperRequest): SafeStorageHelperResponse {
  try {
    if (request.operation === "is-available") {
      return { ok: true, operation: request.operation, available: safeStorage.isEncryptionAvailable() };
    }
    if (request.operation === "encrypt") {
      return {
        ok: true,
        operation: request.operation,
        ciphertext: safeStorage.encryptString(request.value).toString("base64"),
      };
    }
    return {
      ok: true,
      operation: request.operation,
      value: safeStorage.decryptString(Buffer.from(request.value, "base64")),
    };
  } catch {
    return { ok: false, message: "系统凭据操作失败。" };
  }
}

async function readRequest(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_INPUT_BYTES) throw new Error("request too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function parseRequest(value: string): SafeStorageHelperRequest {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || typeof parsed.operation !== "string") throw new Error("invalid request");
  if (parsed.operation === "is-available") return { operation: "is-available" };
  if ((parsed.operation === "encrypt" || parsed.operation === "decrypt")
    && typeof parsed.value === "string"
    && parsed.value.length >= 1
    && parsed.value.length <= 16_384
    && !/[\0\r\n]/u.test(parsed.value)) {
    return { operation: parsed.operation, value: parsed.value };
  }
  throw new Error("invalid request");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
