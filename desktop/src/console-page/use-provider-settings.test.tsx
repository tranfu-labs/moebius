// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProviderProfileSummaryDto } from "../provider-profile-contract";
import type { ProviderSettingsPort } from "./provider-settings-port";
import { useProviderSettings } from "./use-provider-settings";

const profile = (id: string): ProviderProfileSummaryDto => ({
  id,
  providerId: "deepseek",
  providerName: "DeepSeek",
  displayName: id,
  keySuffix: "1234",
  defaultModel: "deepseek-v4-pro",
  verifiedModels: ["deepseek-v4-pro"],
  readiness: "ready",
  reason: null,
  revision: 1,
  updatedAt: "2026-08-04T12:00:00.000Z",
  references: [],
  activity: null,
});

const TEST_MESSAGES = {
  bridgeUnavailable: "桌面桥接尚未就绪，无法读取 AI 服务商档案。",
  listFailed: "无法读取 AI 服务商档案。",
  operationFailed: "AI 服务商操作失败，请重试。",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function port(overrides: Partial<ProviderSettingsPort> = {}): ProviderSettingsPort {
  return {
    listProviderProfiles: vi.fn(async () => ({ ok: true as const, value: [] })),
    createProviderProfile: vi.fn(async () => ({ ok: true as const, value: profile("created") })),
    retryCreateProviderProfileSave: vi.fn(async () => ({ ok: true as const, value: profile("created") })),
    discardCreateProviderProfileSave: vi.fn(async () => ({ ok: true as const, value: null })),
    rotateProviderProfileKey: vi.fn(async () => ({ ok: true as const, value: profile("rotated") })),
    addProviderProfileModel: vi.fn(async () => ({ ok: true as const, value: profile("model-added") })),
    setProviderProfileDefaultModel: vi.fn(async () => ({ ok: true as const, value: profile("default-model") })),
    removeProviderProfileModel: vi.fn(async () => ({ ok: true as const, value: profile("model-removed") })),
    replaceProviderProfileDefaultAndRemoveModel: vi.fn(async () => ({ ok: true as const, value: profile("default-replaced") })),
    renameProviderProfile: vi.fn(async () => ({ ok: true as const, value: profile("renamed") })),
    disableProviderProfile: vi.fn(async () => ({ ok: true as const, value: profile("disabled") })),
    enableProviderProfile: vi.fn(async () => ({ ok: true as const, value: profile("enabled") })),
    deleteProviderProfile: vi.fn(async () => ({ ok: true as const, value: null })),
    migrateProviderProfileReferences: vi.fn(async () => ({ ok: true as const, value: profile("migrated") })),
    retryProviderProfileReferenceOperation: vi.fn(async () => ({ ok: true as const, value: profile("retried") })),
    endProviderProfileReferences: vi.fn(async () => ({ ok: true as const, value: profile("ended") })),
    cancelProviderProfileOperation: vi.fn(async () => ({ ok: true as const, value: null })),
    ...overrides,
  };
}

describe("useProviderSettings", () => {
  it("does not refetch when a parent recreates the port callbacks", async () => {
    const first = port({ listProviderProfiles: vi.fn(async () => ({ ok: true as const, value: [profile("first")] })) });
    const { result, rerender } = renderHook(({ api }) => useProviderSettings(api, TEST_MESSAGES), { initialProps: { api: first } });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready", profiles: [{ id: "first" }] }));

    const replacement = port({ listProviderProfiles: vi.fn(async () => ({ ok: true as const, value: [profile("replacement")] })) });
    rerender({ api: replacement });

    expect(first.listProviderProfiles).toHaveBeenCalledOnce();
    expect(replacement.listProviderProfiles).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ status: "ready", profiles: [{ id: "first" }] });
  });

  it("drops a slow stale refresh after a newer refresh has committed", async () => {
    const slow = deferred<Awaited<ReturnType<ProviderSettingsPort["listProviderProfiles"]>>>();
    const api = port({
      listProviderProfiles: vi.fn()
        .mockImplementationOnce(async () => await slow.promise)
        .mockResolvedValueOnce({ ok: true, value: [profile("new")] }),
    });
    const { result } = renderHook(() => useProviderSettings(api, TEST_MESSAGES));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready", profiles: [{ id: "new" }] }));
    await act(async () => slow.resolve({ ok: true, value: [profile("old")] }));

    expect(result.current.state).toMatchObject({ status: "ready", profiles: [{ id: "new" }] });
  });

  it("keeps operation failure visible and supports an explicit retry", async () => {
    const api = port({
      createProviderProfile: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ ok: true, value: profile("created") }),
      listProviderProfiles: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: [] })
        .mockResolvedValueOnce({ ok: true, value: [profile("created")] }),
    });
    const { result } = renderHook(() => useProviderSettings(api, TEST_MESSAGES));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await act(async () => {
      expect(await result.current.create({ displayName: "DeepSeek", apiKey: "secret-key", defaultModel: "deepseek-v4-pro" })).toBe(false);
    });
    expect(result.current.error).toBe("AI 服务商操作失败，请重试。");
    expect(result.current.busyProfileId).toBeNull();

    await act(async () => {
      expect(await result.current.create({ displayName: "DeepSeek", apiKey: "secret-key", defaultModel: "deepseek-v4-pro" })).toBe(true);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.state).toMatchObject({ status: "ready", profiles: [{ id: "created" }] });
  });

  it("retries only local saving after validation has already succeeded", async () => {
    const createProviderProfile = vi.fn(async () => ({
      ok: false as const,
      code: "PROVIDER_LOCAL_SAVE_FAILED",
      message: "两项验证已通过，但本地保存失败。",
    }));
    const retryCreateProviderProfileSave = vi.fn(async () => ({ ok: true as const, value: profile("created") }));
    const api = port({
      createProviderProfile,
      retryCreateProviderProfileSave,
      listProviderProfiles: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: [] })
        .mockResolvedValueOnce({ ok: true, value: [profile("created")] }),
    });
    const { result } = renderHook(() => useProviderSettings(api, TEST_MESSAGES));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await act(async () => {
      expect(await result.current.create({ displayName: "DeepSeek", apiKey: "secret-key", defaultModel: "deepseek-v4-pro" })).toBe(false);
    });
    expect(result.current.canRetryCreateSave).toBe(true);

    await act(async () => {
      expect(await result.current.retryCreateSave()).toBe(true);
    });
    expect(createProviderProfile).toHaveBeenCalledOnce();
    expect(retryCreateProviderProfileSave).toHaveBeenCalledOnce();
    expect(result.current.canRetryCreateSave).toBe(false);
  });

  it("does not commit a late operation result after unmount", async () => {
    const pending = deferred<Awaited<ReturnType<ProviderSettingsPort["createProviderProfile"]>>>();
    const api = port({ createProviderProfile: vi.fn(async () => await pending.promise) });
    const { result, unmount } = renderHook(() => useProviderSettings(api, TEST_MESSAGES));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let operation!: Promise<boolean>;
    act(() => {
      operation = result.current.create({ displayName: "DeepSeek", apiKey: "secret-key", defaultModel: "deepseek-v4-pro" });
    });
    expect(result.current.busyProfileId).toBe("new");
    unmount();
    await act(async () => pending.resolve({ ok: true, value: profile("late") }));
    await expect(operation).resolves.toBe(false);
  });

  it("cancels the current backend operation and ignores its late result", async () => {
    const pending = deferred<Awaited<ReturnType<ProviderSettingsPort["createProviderProfile"]>>>();
    const api = port({ createProviderProfile: vi.fn(async () => await pending.promise) });
    const { result } = renderHook(() => useProviderSettings(api, TEST_MESSAGES));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let operation!: Promise<boolean>;
    act(() => {
      operation = result.current.create({ displayName: "DeepSeek", apiKey: "secret-key", defaultModel: "deepseek-v4-pro" });
    });
    await waitFor(() => expect(result.current.busyProfileId).toBe("new"));
    const operationId = vi.mocked(api.createProviderProfile).mock.calls[0]![0].operationId;
    act(() => result.current.cancel("new"));
    expect(api.cancelProviderProfileOperation).toHaveBeenCalledWith({ operationId });
    expect(result.current.busyProfileId).toBeNull();

    await act(async () => pending.resolve({ ok: true, value: profile("late") }));
    await expect(operation).resolves.toBe(false);
    expect(result.current.error).toBeNull();
  });
});
