import { describe, expect, it, vi } from "vitest";

import { PROVIDER_PROFILE_IPC_CHANNELS } from "../src/provider-profile-contract.js";
import { registerProviderProfileIpc } from "../src/provider-profile-ipc.js";
import type { ProviderProfileService } from "../src/provider-profile-service.js";

describe("provider profile IPC operations", () => {
  it("cancels an in-flight validation by operation id and releases shutdown tracking", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    let observedSignal: AbortSignal | undefined;
    const service = {
      list: vi.fn(async () => []),
      create: vi.fn(async (request: { signal?: AbortSignal }) => {
        observedSignal = request.signal;
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(Object.assign(
            new Error("operation cancelled"),
            { code: "PROVIDER_OPERATION_CANCELLED" },
          )), { once: true });
        });
        throw new Error("unreachable");
      }),
    } as unknown as ProviderProfileService;
    const runtime = registerProviderProfileIpc({
      ipcMain: {
        handle: (channel: string, handler: (_event: unknown, request: unknown) => unknown) => {
          handlers.set(channel, handler);
        },
      } as never,
      service,
    });

    const creating = handlers.get(PROVIDER_PROFILE_IPC_CHANNELS.create)!(null, {
      operationId: "operation-1",
      displayName: "DeepSeek",
      apiKey: "sk-secret-value",
      defaultModel: "deepseek-v4-pro",
    }) as Promise<unknown>;
    expect(observedSignal).toBeDefined();
    expect(runtime.getRunningTaskCount()).toBe(1);

    expect(handlers.get(PROVIDER_PROFILE_IPC_CHANNELS.cancel)!(null, { operationId: "operation-1" }))
      .toEqual({ ok: true, value: null });
    await expect(creating).resolves.toMatchObject({ ok: false, code: "PROVIDER_OPERATION_CANCELLED" });
    expect(observedSignal?.aborted).toBe(true);
    expect(runtime.getRunningTaskCount()).toBe(0);
  });

  it("validates and forwards canonical reference migration and ending requests", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    const migrateReferences = vi.fn(async () => ({ id: "source-profile" }));
    const endReferences = vi.fn(async () => ({ id: "source-profile" }));
    registerProviderProfileIpc({
      ipcMain: {
        handle: (channel: string, handler: (_event: unknown, request: unknown) => unknown) => {
          handlers.set(channel, handler);
        },
      } as never,
      service: { migrateReferences, endReferences } as unknown as ProviderProfileService,
    });

    await expect(handlers.get(PROVIDER_PROFILE_IPC_CHANNELS.migrateReferences)!(null, {
      operationId: "migrate-1",
      profileId: "source-profile",
      expectedRevision: 2,
      ownerIds: ["session-1:effective:@dev"],
      targetProfileId: "target-profile",
      targetModel: "deepseek-v4-pro",
    })).resolves.toMatchObject({ ok: true });
    expect(migrateReferences).toHaveBeenCalledWith({
      operationId: "migrate-1",
      profileId: "source-profile",
      expectedRevision: 2,
      ownerIds: ["session-1:effective:@dev"],
      targetProfileId: "target-profile",
      targetModel: "deepseek-v4-pro",
    });

    await expect(handlers.get(PROVIDER_PROFILE_IPC_CHANNELS.endReferences)!(null, {
      operationId: "end-1",
      profileId: "source-profile",
      expectedRevision: 2,
      ownerIds: ["draft-1"],
    })).resolves.toMatchObject({ ok: true });
    expect(endReferences).toHaveBeenCalledWith({
      operationId: "end-1",
      profileId: "source-profile",
      expectedRevision: 2,
      ownerIds: ["draft-1"],
    });
  });
});
