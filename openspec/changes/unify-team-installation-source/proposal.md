# 提案：unify-team-installation-source

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | `# Agent 团队`、`### 安装来源与团队生命周期` | 官方与 GitHub 安装采用同一团队逻辑，只保存 `installationSource`，不再自动同步 | 已写入 |
| `docs/product/pages/github-team-preview.md` | `### 安装操作与它意味着什么` | 安装只创建本地团队并保存来源元数据，不登记可执行的更新关系 | 已写入 |
| `docs/product/flows/agent-evolution.md` | `## 主流程`、`## 非目标` | 本功能不再包含团队上游同步、检查或整体撤销 | 已写入 |

## 背景

当前 GitHub 团队安装会写入官方状态与上游同步所需的记录，启动时又会尝试读取打包缓存中的 `official.json`。当团队来源不是内置官方团队时，缓存不存在就会触发 `ENOENT`。产品已经确认官方安装与 GitHub 安装应采用同一套本地团队逻辑，不再提供 check、sync、revert 或对应 UI。

## 提案

1. 增加统一的 `installationSource` 元数据：官方为 `{ provider: "moebius" }`，GitHub 为用户确认的 `provider: "github"`、仓库和默认分支。
2. 新的官方 seed 与 GitHub import 都落入普通用户团队目录，写入普通团队 record、显式执行绑定和安装来源；不写 `official-state-v1.json`。
3. 启动不再执行官方 baseline migration 或 auto-sync；GitHub 安装也不再提供 detach/check/sync/revert。
4. 对已有 `.system` 官方团队、旧团队会话、旧路径和旧记录保留只读兼容读取，不搬目录、不覆盖内容；旧 `official-state-v1.json` 只作为旧运行配置的兼容输入，不再被新流程写入或驱动同步。
5. 团队页、GitHub 预览和 IPC 只保留来源展示、搜索、预览、安装、编辑、运行配置、修复和删除等本地管理能力。

## 影响

- `desktop/src/team-record-store.ts`、`team-model.ts`、`team-seed.ts`：来源元数据、普通 seed record、旧记录兼容。
- `desktop/src/github-team-install-plan.ts`、`github-team-installation.ts`：统一安装落盘，删除同步状态写入。
- `desktop/src/desktop-startup-runtime.ts`、`desktop/src/desktop-team-wiring.ts`、`team-profile-service.ts`、`team-runtime-binding.ts`：移除启动同步，统一新团队运行绑定，保留旧 system 读取。
- `desktop/src/github-team-ipc*`、`team-ipc*`、preload 与 console page：移除 check/sync/revert/detach 及同步状态契约。
- `packages/console-ui/src/console/*`：移除同步、失联、撤销和跟随关系 UI，只展示来源元数据。
- `scripts/acceptance/github-team-electron.ts`、相关单元测试、产品文档与 OpenSpec：改为验证安装后本地可用且不发生更新动作。

明确不在范围内：不迁移用户已有 GitHub 订阅、不自动清理旧状态文件、不 push/merge、不改变 GitHub 搜索与安装前预览的仓库读取协议。
