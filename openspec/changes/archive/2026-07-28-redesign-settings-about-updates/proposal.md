# 提案：redesign-settings-about-updates

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/settings.md` | 页面结构、关于、打开与关闭、检查更新、复制版本与公开链接、响应式与窗口行为 | 设置弹窗改为紧凑双分类，并定义版本、更新、复制、外链和异步关闭后的完整旅程 | 已写入 |
| `docs/product/pages/main-left-sidebar.md` | 设置、页面状态、指标与验收 | 设置作为不依赖项目数据的应用级模态入口，并可恢复进行中配置操作 | 已写入 |

PRD 变更于 2026-07-28 经用户确认；Page Story 已完成八种确定状态的 UI 人工闸门，并保留 `Apple Silicon Mac` 右对齐裁决。

## 背景

当前生产设置弹窗只接通“常规 / 语言”。桌面端已有 GitHub Releases 版本比较与 `action:check-updates`，但新版会在检查完成时直接打开浏览器，renderer 不能原地展示检查中、最新版、有新版或失败，也没有版本复制、预填反馈、关闭后通知和会话内恢复。

## 提案

- 以已确认的生产 `SettingsDialog` Page Story 为 UI 基线，接通“常规 / 关于”。
- 通过窄 settings IPC 提供应用版本、15 秒内收敛的手动更新检查和固定格式版本复制。
- 更新检查只返回结构化结果；只有用户点击“下载新版本”才经既有安全外链边界打开 Release。
- renderer 在当前应用会话内持有更新、复制和外链结果，防止同一检查重复发起；弹窗关闭不取消操作，终态通过不抢焦点通知返回对应分类。
- 发布记录、预填版本信息的 GitHub 新建 Issue、仓库首页和下载页均通过系统浏览器打开。
- 不加入自动检查、自动下载、应用内安装、重启安装、预发布渠道或跨应用重启恢复检查结果。

## 影响

- `packages/console-ui/src/console/settings-dialog.tsx`、`operator-console.tsx`、i18n、Page Story 与测试。
- `desktop/src/settings-*.ts`、`updater.ts`、`main.ts`、`preload.ts`、`console-page/app.tsx` 及对应测试。
- `openspec/specs/console-ui/spec.md` 与 `openspec/specs/desktop-shell/spec.md` 在归档时由本 change 的 delta 回流。
- 依赖方向保持 `desktop-shell → console-ui`；不新增数据库、文件持久化、网络域或架构图。
