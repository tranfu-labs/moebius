import {
  PiHostFrameDecoder,
  encodePiHostFrame,
  parsePiHostInputFrame,
  type PiHostStartFrame,
} from "./pi-host-protocol.js";
import { executePiHostInvocation, toPiHostFailure } from "./pi-agent-runtime.js";

const decoder = new PiHostFrameDecoder();
const controller = new AbortController();
let started = false;
let settled = false;
let activeApiKey: string | undefined;

write({ version: 1, type: "ready" });

process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const value of decoder.push(chunk)) {
      const frame = parsePiHostInputFrame(value);
      if (frame.type === "cancel") {
        controller.abort();
      } else if (!started) {
        started = true;
        activeApiKey = frame.credential.apiKey;
        void run(frame);
      } else {
        throw new Error("Pi Host accepts exactly one start frame");
      }
    }
  } catch (error) {
    failAndFinish(error);
  }
});

process.stdin.on("end", () => {
  try {
    decoder.finish();
  } catch (error) {
    failAndFinish(error);
  }
  if (!started) {
    failAndFinish(new Error("Pi Host did not receive a start frame"));
  }
});

process.stdin.on("error", failAndFinish);

async function run(frame: PiHostStartFrame): Promise<void> {
  try {
    await executePiHostInvocation({ frame, signal: controller.signal, emit: write });
    finish(0);
  } catch (error) {
    failAndFinish(error);
  }
}

function failAndFinish(error: unknown): void {
  if (settled) return;
  writeTrustedDiagnostic(error);
  write(toPiHostFailure(error, controller.signal.aborted));
  finish(1);
}

function writeTrustedDiagnostic(error: unknown): void {
  if (process.env.MOEBIUS_TRUSTED_PI_DIAGNOSTICS !== "1") return;
  const messages: string[] = [];
  let current = error;
  for (let index = 0; index < 5 && current instanceof Error; index += 1) {
    messages.push(redactCredential(current.message));
    current = current.cause;
  }
  process.stderr.write(`${JSON.stringify({ type: "pi-host-diagnostic", messages })}\n`);
}

function redactCredential(value: string): string {
  return activeApiKey === undefined ? value : value.split(activeApiKey).join("[redacted]");
}

function write(frame: Parameters<typeof encodePiHostFrame>[0]): void {
  if (!settled) process.stdout.write(encodePiHostFrame(frame));
}

function finish(exitCode: number): void {
  if (settled) return;
  settled = true;
  process.stdin.removeAllListeners();
  process.stdin.pause();
  process.stdout.end(() => process.exit(exitCode));
}
