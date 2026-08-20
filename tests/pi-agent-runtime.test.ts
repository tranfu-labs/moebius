import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  buildPiSessionToolNames,
  buildPiSystemPrompt,
  executePiHostInvocation,
} from "../src/pi-agent-runtime.js";
import { createMoebiusPiTools } from "../src/pi-host-tools.js";
import { createPiManagedProcessExtension } from "../src/pi-managed-process-extension.js";
import { MANAGED_PROCESS_TOOL_NAMES } from "../src/local-console/managed-process-tools.js";
import { MANAGED_PROCESS_RUNTIME_CONTRACT } from "../src/local-console/prompt.js";
import { PiProviderValidationError } from "../src/pi-provider-validator.js";

describe("Pi Agent runtime model boundaries", () => {
  it("fails before provider access when a text-only DeepSeek model receives an image", async () => {
    await expect(executePiHostInvocation({
      frame: {
        version: 1,
        type: "start",
        credential: { apiKey: "sk-test-only" },
        invocation: {
          kind: "run",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
          effort: "high",
          cwd: "/tmp/workspace",
          agentDir: "/tmp/agent",
          sessionDir: "/tmp/pi-session-not-created",
          nativeSessionPath: null,
          prompt: "Inspect this image",
          imagePaths: ["/tmp/input.png"],
          managedProcessMcp: null,
        },
      },
      signal: new AbortController().signal,
      emit: vi.fn(),
    })).rejects.toMatchObject({
      code: "model-incompatible",
      message: expect.stringContaining("仅支持文本输入"),
    } satisfies Partial<PiProviderValidationError>);
  });

  it("states managed-process tools are unavailable when no bridge is injected", () => {
    const prompt = buildPiSystemPrompt(null);
    expect(prompt).toContain("Managed long-running process tools are unavailable in this run.");
  });

  it("reuses the single Runtime Contract constant when a bridge is injected", () => {
    const prompt = buildPiSystemPrompt({ command: "/usr/bin/node", args: [], env: {}, cwd: "/tmp" });
    expect(prompt).toContain(MANAGED_PROCESS_RUNTIME_CONTRACT);
    expect(prompt).not.toContain("Managed long-running process tools are unavailable in this run.");
  });

  it("exposes managed-process tools through the real Pi session allowlist only when injected", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "moebius-pi-runtime-tools-"));
    const baseTools = createMoebiusPiTools(workspace);
    const baseToolNames = baseTools.map((tool) => tool.name);

    const inspectSessionTools = async (managedProcessAvailable: boolean) => {
      const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
      const resourceLoader = new DefaultResourceLoader({
        cwd: workspace,
        agentDir: workspace,
        settingsManager,
        extensionFactories: managedProcessAvailable
          ? [createPiManagedProcessExtension({ command: "node", args: [], env: {}, cwd: workspace })]
          : [],
        noExtensions: false,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await resourceLoader.reload();
      const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
      const { session } = await createAgentSession({
        cwd: workspace,
        agentDir: workspace,
        modelRuntime,
        settingsManager,
        resourceLoader,
        sessionManager: SessionManager.inMemory(workspace),
        noTools: "all",
        tools: buildPiSessionToolNames(baseToolNames, managedProcessAvailable),
        customTools: baseTools,
      });
      try {
        return {
          active: session.getActiveToolNames(),
          all: session.getAllTools().map((tool) => tool.name),
        };
      } finally {
        session.dispose();
      }
    };

    const withoutCapability = await inspectSessionTools(false);
    const withCapability = await inspectSessionTools(true);

    expect(withoutCapability.active).toEqual(baseToolNames);
    expect(withoutCapability.all).not.toEqual(expect.arrayContaining([...MANAGED_PROCESS_TOOL_NAMES]));
    expect(withCapability.active).toEqual([...baseToolNames, ...MANAGED_PROCESS_TOOL_NAMES]);
    expect(withCapability.all).toEqual(expect.arrayContaining([...MANAGED_PROCESS_TOOL_NAMES]));
  });
});
