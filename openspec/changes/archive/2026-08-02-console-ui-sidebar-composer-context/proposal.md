# 提案：console-ui-sidebar-composer-context

## 背景

`conversation-console` 已在 `openspec/changes/conversation-console/ui-design.md` 与 `wireframes.md` 定义本地对话操作台的视觉和交互事实，但 `packages/console-ui` 目前只有整页 `OperatorConsole` 与验收卡等基础样例，缺少可独立复用、可在 Storybook 单独验收的侧栏、角色 composer、空状态和会话上下文顶栏组件。

本任务来自父 issue 142 的 phase-one task `task-142-sidebar-composer-context`。需求侧已在 issue 144 的公开时间线确认以下范围：

1. 侧栏只按「等你 → 运行中 → 静止 → 已完成」四档排序；目标会话不设特殊档，当前选中态不改变排序，已完成默认折叠。
2. 顶栏只包含当前会话面包屑、任务状态与进展摘要；全局计数、新会话按钮和等你浮层不在本任务内。
3. composer 列出七个合法角色，由控件插入协议句柄；同一消息已有合法角色时不允许再由控件插入第二个。

## 提案

在 `packages/console-ui/src/console/` 新增四组独立源码组件、共置单元测试与 Story：

1. 会话侧栏：从项目路径显示目录名，按四档稳定排序会话，以中性状态图标表达等你、运行中和静止，并将已完成放入默认折叠分组。
2. 角色 composer：受控输入框在合法触发位置输入 `@` 时打开角色补全面板，显示七个角色的中性头像、中文名与职责；支持鼠标和键盘选择，并用合法英文句柄替换触发词。
3. 空状态：使用邀请式文案与角色 composer 构成新会话起点，不放插画或催促式文案。
4. 会话上下文顶栏：渲染当前会话的父会话面包屑、任务状态及紧凑进展摘要，不承接全局导航能力。

Story 直接从各组件源码导入，提供能真实展开已完成分组、选择角色并看到受控值变化的交互样例。实现不修改 `packages/console-ui/src/console/operator-console.tsx`，也不修改 `packages/console-ui/src/index.ts` 等共享出口。

## 影响

- 新增：`packages/console-ui/src/console/conversation-sidebar.tsx` 及其测试、Story。
- 新增：`packages/console-ui/src/console/role-composer.tsx` 及其测试、Story。
- 新增：`packages/console-ui/src/console/conversation-empty-state.tsx` 及其测试、Story。
- 新增：`packages/console-ui/src/console/session-context-header.tsx` 及其测试、Story。
- 新增本 change 的 `console-ui` spec delta；`spec-delta/console-ui/spec.md` 是仓库归档事实，`specs/console-ui/spec.md` 是当前 OpenSpec CLI 严格校验所需的同内容兼容镜像，两者必须保持一致。
- 不修改 operator console、共享出口、runner、desktop renderer、local console API 或状态持久化。
- 不新增全局等你清单、全局运行计数、新会话动作、账本树、消息时间线或右侧产物面板。

## 验收语句

以下三条沿用 issue 原文，不作改写、合并或扩展：

1. 打开侧栏 Story → 项目显示目录名，会话按等你、运行中、静止、已完成排序，已完成分组默认折叠。
2. 在 composer Story 输入 @ 并选择角色 → 出现补全面板且控件生成合法 mention，无需手打完整角色名。
3. 打开空状态与顶栏 Story并对照 conversation-console 设计事实源 → 会话上下文、方角细边、紧凑布局、纯色扁平按钮及仅浮层使用阴影均一致。
