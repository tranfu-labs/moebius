# 提案：fix-onboarding-ai-builder-feedback-layout

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | 第 2 步 · AI 建队子流程 | 新增设计器响应式工作区与提案完整占位规则 | 已写入 |
| `docs/product/pages/onboarding.md` | 操作与反馈 / 第 2 步 AI 建队 | 新增用户消息即时气泡与无重复收敛规则 | 已写入 |
| `docs/product/pages/onboarding.md` | 指标与验收 | 增补响应式尺寸、即时消息与提案可见性验收 | 已写入 |

## 背景

当前正式 desktop 引导页的 AI 团队设计器存在三个关联问题：

1. 用户发送文字后，renderer 立即清空输入框，但直到完整 Codex turn 返回才从 IPC 响应取得新消息，因此等待期间看不到右侧用户气泡。
2. `TeamBuilderView` 虽声明 `max-w-[780px]`，却被引导壳的 `max-w-lg` 父容器限制为约 512px；在大窗口中仍显得拥挤。
3. 团队提案卡是可收缩的纵向 flex 子项，同时使用 `overflow-hidden`。长提案会被压缩到只剩标题，成员行虽然存在于 DOM，却被卡片边界裁掉。

这些问题共同破坏了“用户发出目标 → AI 明确接住 → 用户看见整支团队”的核心引导体验。

## 提案

- renderer 在发送 AI 建队消息时立即渲染一个右侧临时用户气泡，并以提交前消息数作为收敛锚点；服务端状态包含本轮消息后隐藏临时气泡，避免重复。
- 保留现有输入锁与「正在输入」指示，让指示出现在即时用户气泡之后。
- 仅在第 2 步 AI 团队设计器打开时，把引导主体从 `max-w-lg` 响应式放宽到最大 780px；设计器高度随 viewport 增长并封顶约 720px。
- 把团队提案卡声明为不可收缩 flex 子项，保持全部成员、slug、主 Agent 与接力关系的内容高度；超高内容继续由既有对话区滚动。
- 以组件测试覆盖即时消息、服务端收敛、完整成员呈现与关键响应式样式契约，并用正式 desktop build + Electron CDP 做 AI 验证。

## 影响

- `packages/console-ui/src/ai-team-builder/`：消息临时投影与提案卡 flex 行为。
- `packages/console-ui/src/onboarding/`：AI 建队打开态的响应式主体宽度。
- `desktop/tests/` 与 `packages/console-ui` 测试：renderer 装配和视觉结构回归。
- `docs/product/pages/onboarding.md`、`openspec/specs/desktop-shell/spec.md`：产品与行为事实源。

不改变 AI 建队 service、IPC DTO、Codex driver、草稿持久化或团队创建语义。
