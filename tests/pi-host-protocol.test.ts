import { describe, expect, it } from "vitest";
import {
  PiHostFrameDecoder,
  PiHostProtocolError,
  encodePiHostFrame,
  parsePiHostInputFrame,
  parsePiHostOutputFrame,
} from "../src/pi-host-protocol.js";

const start = {
  version: 1 as const,
  type: "start" as const,
  credential: { apiKey: "sk-secret-value" },
  invocation: {
    kind: "validate" as const,
    providerId: "deepseek" as const,
    model: "deepseek-v4-pro" as const,
    effort: "high" as const,
    cwd: "/tmp/workspace",
    agentDir: "/tmp/agent",
  },
};

describe("Pi Host protocol", () => {
  it("decodes fragmented and coalesced frames", () => {
    const decoder = new PiHostFrameDecoder();
    const bytes = Buffer.concat([
      encodePiHostFrame(start),
      encodePiHostFrame({ version: 1, type: "cancel" }),
    ]);
    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    expect(decoder.push(bytes.subarray(3))).toEqual([start, { version: 1, type: "cancel" }]);
    decoder.finish();
  });

  it("rejects truncation and invalid model ids", () => {
    const decoder = new PiHostFrameDecoder();
    decoder.push(encodePiHostFrame(start).subarray(0, 8));
    expect(() => decoder.finish()).toThrowError(PiHostProtocolError);
    expect(() => parsePiHostInputFrame({
      ...start,
      invocation: { ...start.invocation, model: "arbitrary-model" },
    })).toThrowError(PiHostProtocolError);
    expect(() => parsePiHostInputFrame({
      ...start,
      invocation: { ...start.invocation, effort: "medium" },
    })).toThrowError(PiHostProtocolError);
  });

  it("accepts only bounded image paths and an explicit managed-process MCP invocation", () => {
    const run = {
      ...start,
      invocation: {
        kind: "run" as const,
        providerId: "deepseek" as const,
        model: "deepseek-v4-pro" as const,
        effort: "high" as const,
        cwd: "/tmp/workspace",
        agentDir: "/tmp/agent",
        sessionDir: "/tmp/sessions",
        nativeSessionPath: null,
        prompt: "inspect the image and start the service",
        imagePaths: ["/tmp/input.png"],
        managedProcessMcp: {
          command: "/usr/bin/node",
          args: ["/tmp/managed-bridge.js"],
          env: { MOEBIUS_MANAGED_PROCESS_CAPABILITY: "invocation-secret" },
        },
      },
    };
    expect(parsePiHostInputFrame(run)).toEqual(run);
    expect(() => parsePiHostInputFrame({
      ...run,
      invocation: {
        ...run.invocation,
        managedProcessMcp: { ...run.invocation.managedProcessMcp, env: { INVALID: 42 } },
      },
    })).toThrowError(PiHostProtocolError);
  });

  it("accepts only safe output reasons and fields", () => {
    expect(parsePiHostOutputFrame({
      version: 1,
      type: "failed",
      reason: "auth",
      message: "API Key 无效。",
    })).toEqual(expect.objectContaining({ reason: "auth" }));
    expect(() => parsePiHostOutputFrame({
      version: 1,
      type: "failed",
      reason: "raw-provider-payload",
      message: "bad",
    })).toThrowError(PiHostProtocolError);
  });
});
