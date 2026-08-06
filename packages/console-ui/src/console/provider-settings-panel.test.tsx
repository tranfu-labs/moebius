import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import {
  ProviderSettingsPanel,
  type ProviderSettingsController,
  type ProviderSettingsProfile,
} from "./provider-settings-panel";

function profile(references: ProviderSettingsProfile["references"] = []): ProviderSettingsProfile {
  return {
    id: "profile-1",
    providerId: "deepseek",
    providerName: "DeepSeek",
    displayName: "生产账号",
    keySuffix: "1234",
    defaultModel: "deepseek-v4-pro",
    verifiedModels: ["deepseek-v4-pro"],
    readiness: "ready",
    reason: null,
    revision: 1,
    updatedAt: "2026-08-04T12:00:00.000Z",
    references,
    activity: null,
  };
}

function controller(value: ProviderSettingsProfile, profiles: ProviderSettingsProfile[] = [value]): ProviderSettingsController {
  return {
    state: { status: "ready", profiles },
    busyProfileId: null,
    error: null,
    canRetryCreateSave: false,
    refresh: vi.fn(),
    create: vi.fn(async () => true),
    retryCreateSave: vi.fn(async () => true),
    discardCreateSave: vi.fn(),
    rotateKey: vi.fn(async () => true),
    addModel: vi.fn(async () => true),
    setDefaultModel: vi.fn(async () => true),
    removeModel: vi.fn(async () => true),
    replaceDefaultAndRemoveModel: vi.fn(async () => true),
    rename: vi.fn(async () => true),
    disable: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    migrateReferences: vi.fn(async () => true),
    retryReferenceOperation: vi.fn(async () => true),
    endReference: vi.fn(async () => true),
    delete: vi.fn(async () => undefined),
    cancel: vi.fn(),
  };
}

function renderPanel(value: ProviderSettingsProfile, profiles: ProviderSettingsProfile[] = [value]): ProviderSettingsController {
  const valueController = controller(value, profiles);
  render(
    <I18nProvider locale="zh-CN">
      <ProviderSettingsPanel controller={valueController} />
    </I18nProvider>,
  );
  return valueController;
}

describe("ProviderSettingsPanel", () => {
  it("shows canonical references and disables deletion while one remains", () => {
    renderPanel(profile([{
      kind: "team-member",
      ownerId: "team-1/dev",
      label: "开发 Agent",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]));

    expect(screen.getByText("开发 Agent")).toBeVisible();
    expect(screen.getByText(/团队成员/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });

  it("requires the exact profile name before deleting an unreferenced profile", async () => {
    const valueController = renderPanel(profile());
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const confirm = screen.getByRole("button", { name: "永久删除档案" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("输入“生产账号”以确认"), { target: { value: "生产" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("输入“生产账号”以确认"), { target: { value: "生产账号" } });
    expect(confirm).toBeEnabled();
    await act(async () => fireEvent.click(confirm));
    expect(valueController.delete).toHaveBeenCalledWith(expect.objectContaining({ id: "profile-1" }));
  });

  it("previews canonical references before migrating them", async () => {
    const value = profile([{
      kind: "team-member",
      ownerId: "user:team-1:dev",
      label: "开发 Agent",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]);
    value.verifiedModels = ["deepseek-v4-pro", "deepseek-v4-flash"];
    const valueController = renderPanel(value);

    fireEvent.click(screen.getByRole("button", { name: "迁移运行引用" }));
    expect(screen.getByText(/团队成员按团队原子提交/u)).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "迁移 1 项" })));

    expect(valueController.migrateReferences).toHaveBeenCalledWith(
      value,
      ["user:team-1:dev"],
      "profile-1",
      "deepseek-v4-flash",
    );
  });

  it("requires confirmation before ending a resumable reference", async () => {
    const value = profile([{
      kind: "resumable-session",
      ownerId: "session-1:effective:@dev",
      label: "会话 · @dev",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]);
    const valueController = renderPanel(value);

    fireEvent.click(screen.getByRole("button", { name: "结束并保留历史" }));
    expect(screen.getByRole("dialog", { name: "结束继续能力？" })).toBeVisible();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "结束并保留历史" }).at(-1)!));

    expect(valueController.endReference).toHaveBeenCalledWith(value, "session-1:effective:@dev");
  });

  it("shows interrupted migration progress and retries only the unfinished references", async () => {
    const value = profile([{
      kind: "team-member",
      ownerId: "pending-owner",
      label: "待迁移 Agent",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]);
    value.activity = {
      id: "migration-1",
      kind: "migrate",
      status: "failed",
      completedTargets: ["completed-owner"],
      targetModels: ["deepseek-v4-pro"],
      targetProfileId: "profile-2",
      targetOwnerIds: ["completed-owner", "pending-owner"],
    };
    const target = {
      ...profile([{
        kind: "team-member" as const,
        ownerId: "completed-owner",
        label: "已提交 Agent",
        profileId: "profile-2",
        model: "deepseek-v4-pro" as const,
      }]),
      id: "profile-2",
      displayName: "迁移目标",
    };
    const valueController = renderPanel(value, [value, target]);

    const recovery = screen.getByTestId("provider-migration-recovery");
    expect(recovery).toHaveTextContent("上次迁移未完成");
    expect(recovery).toHaveTextContent("已完成 1 项");
    expect(recovery).toHaveTextContent("未完成 1 项");
    expect(recovery).toHaveTextContent("已提交 Agent");
    expect(recovery).toHaveTextContent("待迁移 Agent");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "只重试未完成项" })));

    expect(valueController.retryReferenceOperation).toHaveBeenCalledWith(value, "migration-1");
  });

  it("confirms reference impact before disabling a profile", async () => {
    const value = profile([{
      kind: "team-member",
      ownerId: "user:team-1:dev",
      label: "开发 Agent",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]);
    const valueController = renderPanel(value);

    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(screen.getByRole("dialog", { name: "停用“生产账号”？" })).toHaveTextContent("现有 1 项运行引用会保留");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认停用" })));

    expect(valueController.disable).toHaveBeenCalledWith(value);
  });

  it("replaces the default and removes the old model with one intent", async () => {
    const value = profile();
    value.verifiedModels = ["deepseek-v4-pro", "deepseek-v4-flash"];
    const valueController = renderPanel(value);

    fireEvent.click(screen.getAllByRole("button", { name: "移除" })[0]!);
    expect(screen.getByRole("dialog", { name: "先更换默认模型" })).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存默认值并移除" })));

    expect(valueController.replaceDefaultAndRemoveModel).toHaveBeenCalledWith(
      value,
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    );
  });
});
