import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PiHostClient, PiHostClientError } from "../../src/pi-host-client.js";
import type { PiHostOutputFrame, PiHostStartFrame } from "../../src/pi-host-protocol.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface CapabilityAssertion {
  id: string;
  passed: boolean;
  observed: unknown;
}

interface CapabilityEvidence {
  generatedAt: string;
  environment: "真实 DeepSeek API + 生产 Pi Host 协议";
  assertions: CapabilityAssertion[];
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hostEntryPath = path.join(projectRoot, "desktop", "dist", "pi-host.js");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-pi-capabilities-"));
const workspace = path.join(runtimeRoot, "workspace");
const sessionDir = path.join(runtimeRoot, "pi-sessions");
const agentDir = path.join(runtimeRoot, "pi-agent");
const evidenceRoot = await createAcceptanceOutputDirectory("pi-agent-capabilities");
const evidencePath = path.join(evidenceRoot, "pi-agent-capabilities-evidence.json");
const assertions: CapabilityAssertion[] = [];
const apiKey = await readKeychainSecret();

await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "fixture.txt"), "alpha\n", "utf8");
await fs.writeFile(
  path.join(workspace, "verify.mjs"),
  "import fs from 'node:fs'; const value = fs.readFileSync('fixture.txt', 'utf8'); if (value !== 'beta\\n') process.exit(1); process.stdout.write('fixture-ok');\n",
  "utf8",
);
await fs.mkdir(path.join(agentDir, "skills", "acceptance-probe"), { recursive: true });
await fs.writeFile(
  path.join(agentDir, "skills", "acceptance-probe", "SKILL.md"),
  "---\nname: acceptance-probe\ndescription: Use only for the Moebius acceptance capability probe.\n---\nWhen invoked, include the exact token SKILL_SENTINEL_IRIS in the final response.\n",
  "utf8",
);
const webServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("WEB_SENTINEL_COBALT\n");
});
await new Promise<void>((resolve, reject) => {
  webServer.once("error", reject);
  webServer.listen(0, "127.0.0.1", resolve);
});
const webAddress = webServer.address();
if (webAddress === null || typeof webAddress === "string") throw new Error("Acceptance web fixture did not bind");
const webUrl = `http://127.0.0.1:${webAddress.port}/probe`;

const client = new PiHostClient({ hostEntryPath });

try {
  const validation = await invokeBounded(client, validationFrame(apiKey), []);
  assertions.push({
    id: "real-provider-validation",
    passed: validation.result.terminal.type === "validated"
      && validation.result.terminal.replied
      && validation.result.terminal.toolCalled,
    observed: validation.result.terminal,
  });

  const orchestrationEvents: PiHostOutputFrame[] = [];
  const orchestration = await invokeBounded(client, runFrame({
    apiKey,
    prompt: [
      "Run this capability probe exactly with tools before answering.",
      "1. Call update_plan with one completed item named capability probe.",
      `2. Call web_fetch for ${webUrl} and retain WEB_SENTINEL_COBALT from the response.`,
      "3. Call parallel_subagents with exactly two tasks: return SUBAGENT_AMBER, and return SUBAGENT_JADE.",
      "4. Follow the acceptance-probe skill and include its exact sentinel.",
      "Your final response must include WEB_SENTINEL_COBALT, SUBAGENT_AMBER, SUBAGENT_JADE, and SKILL_SENTINEL_IRIS.",
    ].join("\n"),
    nativeSessionPath: null,
  }), orchestrationEvents);
  const orchestrationTools = orchestrationEvents.flatMap((event) =>
    event.type === "tool-started" ? [event.toolName] : []);
  const orchestrationBody = orchestration.result.terminal.type === "completed"
    ? orchestration.result.terminal.body
    : "";
  assertions.push({
    id: "real-plan-web-skill-subagents",
    passed: orchestration.result.terminal.type === "completed"
      && orchestrationTools.includes("update_plan")
      && orchestrationTools.includes("web_fetch")
      && orchestrationTools.includes("parallel_subagents")
      && ["WEB_SENTINEL_COBALT", "SUBAGENT_AMBER", "SUBAGENT_JADE", "SKILL_SENTINEL_IRIS"]
        .every((sentinel) => orchestrationBody.includes(sentinel)),
    observed: {
      terminalType: orchestration.result.terminal.type,
      toolNames: orchestrationTools,
      sentinelsObserved: ["WEB_SENTINEL_COBALT", "SUBAGENT_AMBER", "SUBAGENT_JADE", "SKILL_SENTINEL_IRIS"]
        .filter((sentinel) => orchestrationBody.includes(sentinel)),
    },
  });

  const stop = await invokeAndCancelForegroundCommand(client, runFrame({
    apiKey,
    prompt: "Call exec_command now with command node and args [\"-e\", \"setTimeout(() => {}, 30000)\"]. Do not use another tool and do not answer before it completes.",
    nativeSessionPath: null,
  }));
  assertions.push({
    id: "real-stop-cancels-foreground-tool",
    passed: stop.cancelled && stop.toolStarted && stop.elapsedMs < 15_000,
    observed: stop,
  });

  await fs.writeFile(path.join(workspace, "unsupported-image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  let imageFailure: string | null = null;
  try {
    await invokeBounded(client, {
      ...runFrame({ apiKey, prompt: "Describe the attached image.", nativeSessionPath: null }),
      invocation: {
        ...runFrame({ apiKey, prompt: "Describe the attached image.", nativeSessionPath: null }).invocation,
        imagePaths: [path.join(workspace, "unsupported-image.png")],
      },
    } as PiHostStartFrame, []);
  } catch (error) {
    imageFailure = error instanceof PiHostClientError ? error.code : null;
  }
  assertions.push({
    id: "image-input-limit-is-explicit",
    passed: imageFailure === "model-incompatible",
    observed: { safeFailure: imageFailure },
  });

  await fs.writeFile(path.join(workspace, "fixture.txt"), "alpha\n", "utf8");
  const firstEvents: PiHostOutputFrame[] = [];
  const first = await invokeBounded(client, runFrame({
    apiKey,
    prompt: [
      "Complete this deterministic coding task using tools, not a prose-only answer.",
      "Read fixture.txt, replace its only line alpha with beta, then run `node verify.mjs` with exec_command.",
      "Only report success after the command exits with code 0.",
    ].join("\n"),
    nativeSessionPath: null,
  }), firstEvents);
  const firstTools = firstEvents.flatMap((event) =>
    event.type === "tool-started" ? [event.toolName] : []);
  const fixtureAfterRun = await fs.readFile(path.join(workspace, "fixture.txt"), "utf8");
  assertions.push({
    id: "real-coding-tool-loop",
    passed: first.result.terminal.type === "completed"
      && fixtureAfterRun === "beta\n"
      && firstTools.includes("read_file")
      && (firstTools.includes("edit_file") || firstTools.includes("apply_patch") || firstTools.includes("write_file"))
      && firstTools.includes("exec_command")
      && first.result.session?.sessionPath !== null
      && first.result.session !== null,
    observed: {
      terminalType: first.result.terminal.type,
      toolNames: firstTools,
      fixtureMatchesExpectedContent: fixtureAfterRun === "beta\n",
      sessionObserved: first.result.session !== null && first.result.session.sessionPath !== null,
    },
  });

  const nativeSessionPath = first.result.session?.sessionPath ?? null;
  if (nativeSessionPath === null) throw new Error("Pi did not return a resumable native session");
  const resumeEvents: PiHostOutputFrame[] = [];
  const resumed = await invokeBounded(client, runFrame({
    apiKey,
    prompt: "Continue this exact session. Read fixture.txt and reply with its exact one-word content. Do not modify files.",
    nativeSessionPath,
  }), resumeEvents);
  assertions.push({
    id: "real-native-resume",
    passed: resumed.result.terminal.type === "completed"
      && resumed.result.terminal.body.toLowerCase().includes("beta")
      && resumed.result.session?.sessionPath === nativeSessionPath,
    observed: {
      terminalType: resumed.result.terminal.type,
      mentionsExpectedContent: resumed.result.terminal.type === "completed"
        && resumed.result.terminal.body.toLowerCase().includes("beta"),
      sameNativeSession: resumed.result.session?.sessionPath === nativeSessionPath,
      toolNames: resumeEvents.flatMap((event) => event.type === "tool-started" ? [event.toolName] : []),
    },
  });

  const secretPersisted = await directoryContains(runtimeRoot, apiKey);
  assertions.push({
    id: "real-key-not-persisted",
    passed: !secretPersisted,
    observed: { secretPersisted },
  });
} finally {
  await new Promise<void>((resolve) => webServer.close(() => resolve()));
  const evidence: CapabilityEvidence = {
    generatedAt: new Date().toISOString(),
    environment: "真实 DeepSeek API + 生产 Pi Host 协议",
    assertions,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ok: assertions.length === 7 && assertions.every((item) => item.passed), evidence: evidencePath })}\n`);
}

if (assertions.length !== 7 || assertions.some((assertion) => !assertion.passed)) process.exitCode = 1;

function validationFrame(secret: string): PiHostStartFrame {
  return {
    version: 1,
    type: "start",
    credential: { apiKey: secret },
    invocation: {
      kind: "validate",
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      effort: "high",
      cwd: workspace,
      agentDir,
    },
  };
}

function runFrame(input: {
  apiKey: string;
  prompt: string;
  nativeSessionPath: string | null;
}): PiHostStartFrame {
  return {
    version: 1,
    type: "start",
    credential: { apiKey: input.apiKey },
    invocation: {
      kind: "run",
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      effort: "high",
      cwd: workspace,
      agentDir,
      sessionDir,
      nativeSessionPath: input.nativeSessionPath,
      prompt: input.prompt,
      imagePaths: [],
      managedProcessMcp: null,
    },
  };
}

async function invokeBounded(
  client: PiHostClient,
  frame: PiHostStartFrame,
  events: PiHostOutputFrame[],
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    return {
      result: await client.invoke({
        frame,
        signal: controller.signal,
        onEvent: (event) => events.push(event),
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeAndCancelForegroundCommand(
  client: PiHostClient,
  frame: PiHostStartFrame,
): Promise<{ cancelled: boolean; toolStarted: boolean; elapsedMs: number }> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let toolStarted = false;
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    await client.invoke({
      frame,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool-started" && event.toolName === "exec_command") {
          toolStarted = true;
          setTimeout(() => controller.abort(), 100);
        }
      },
    });
    return { cancelled: false, toolStarted, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return {
      cancelled: error instanceof PiHostClientError && error.code === "cancelled",
      toolStarted,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readKeychainSecret(): Promise<string> {
  const account = process.env.USER?.trim();
  if (account === undefined || account.length === 0) throw new Error("Keychain account is unavailable");
  const child = spawn("security", [
    "find-generic-password",
    "-w",
    "-a",
    account,
    "-s",
    "moebius-byok-acceptance",
  ], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.resume();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const secret = Buffer.concat(stdout).toString("utf8").trim();
  if (exitCode !== 0 || secret.length < 8 || secret.length > 16_384 || /[\r\n\0]/u.test(secret)) {
    throw new Error("The acceptance Keychain item is unavailable or invalid");
  }
  return secret;
}

async function directoryContains(root: string, value: string): Promise<boolean> {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContains(target, value)) return true;
    } else if (entry.isFile()) {
      const contents = await fs.readFile(target).catch(() => null);
      if (contents?.includes(Buffer.from(value)) === true) return true;
    }
  }
  return false;
}
