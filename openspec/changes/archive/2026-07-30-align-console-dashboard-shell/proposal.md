# 提案：align-console-dashboard-shell

## 需求基线

本次是高保真视觉目标变更，不改变页面职责、信息架构或业务规则。用户已指定
`packages/console-ui/design-refs/dashboard.html`（视觉参数由同目录 `app.css` 提供）
作为对齐目标，并把范围限定为其中的左侧边栏与主会话区域。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-left-sidebar.md` | `#页面结构`、`#区域与信息`、`#响应式与窗口行为` | 既有结构、操作与可调整宽度规则继续有效；本次只改变高保真实现 | 无需修改 |
| `docs/product/pages/main-conversation.md` | `#页面结构`、`#区域与信息`、`#响应式与窗口行为` | 既有标题、时间线、消息、目录轨与 composer 规则继续有效；本次只改变高保真实现 | 无需修改 |

现状：生产 `OperatorConsole` 已包含参考稿中的两块区域及其主要内容，但默认侧栏为
248px、应用导航行为 40px、主会话正文列为 760px，项目 / 会话行、消息缩进、用户气泡和
composer 的视觉节奏也未完整对齐参考稿。

期望：不增删业务能力的前提下，生产左侧栏与主会话区采用参考稿的尺寸、内容轴、排版层级、
圆角和间距，使新对话、已有会话、活动 run、长消息与 composer 共用稳定的视觉骨架。

落点：产品职责仍由上述两个页面 PRD 承担；可判定视觉行为暂存在本 change 的
`spec-delta/console-ui/spec.md`，实现完成并验证后归档到 `openspec/specs/console-ui/spec.md`。
包内长期视觉规则在实现阶段同步更新 `packages/console-ui/DESIGN.md`。

## 背景

分档：**完整 change**。页面业务意图没有变化，但用户明确替换了生产 UI 的高保真视觉目标，
存在 760px / 840px 内容轴、共享组件作用域和参考稿与生产能力冲突等方案权衡；不能把未实现的
判据提前内联进现行 spec，也不能在没有方案核验的情况下直接改代码。

`dashboard.html` 已把左侧栏与主会话区表达为一套完整桌面工作台：46px 窗口控制行、
独立品牌行、紧凑项目树、840px 居中会话列、24px 成员头像、右侧用户气泡，以及与正文列
共轴的底部 composer。生产 UI 的行为已比参考稿更完整，但部分旧度量仍来自此前实现，
导致同一页面在参考稿与真实应用之间出现可见偏差。

本次对齐不能直接复制原型。参考稿包含静态假数据、右侧栏、开发工具条和演示脚本，也缺少
生产侧栏固定的“重新查看引导”等能力；这些都不能借视觉对齐进入或退出产品。

## 提案

只调整生产 `@moebius/console-ui` 中的两块区域：

1. 左侧边栏：默认宽度、窗口控制行、品牌行、应用级导航、项目标题、项目 / 会话行、选中态、
   状态点和固定底部操作的视觉节奏对齐参考稿。
2. 主会话区域：顶部窗口行、sticky 会话标题、840px 正文列、消息身份行、正文缩进、用户气泡、
   活动 run、待发射区与底部 composer 对齐参考稿。
3. 新对话和已有会话继续复用同一个主会话内容轴；目录轨继续固定在主会话内，不迁入侧栏。
4. 复用现有语义 token、组件与数据契约；仅在共享组件会影响右侧子任务时增加显式的
   `main` / `embedded` 视觉变体，避免把本次样式泄漏到排除区域。
5. 增加真实 Electron 验收夹具，以临时数据根和临时 `codex` 可执行文件稳定生成成功未读、
   失败、运行中、待发射与附件状态；夹具只驱动既有生产协议，不新增产品状态或测试后门。

## 纳入范围

- `OperatorConsole` 的左侧栏外壳、主会话外壳及二者之间的边界。
- `ConversationSidebar` 的项目 / 会话导航密度和选中态。
- `NewConversationPage`、已有会话标题 / 时间线、`TimelineEntry`、主会话 `RunBlock`、
  主会话 `RoleComposer` 及待发射区的共享内容轴。
- `Page/Console/OperatorConsole` 与相关 Block Story 的确定性视觉验收状态。
- 与上述度量直接绑定的组件测试、Storybook 门禁和桌面真实运行验收。

## 排除范围

- 右侧栏、右侧子任务会话、过程 / 改动 / 项目文件标签及其宽度和内部布局。
- Agent 团队页、搜索、设置、onboarding、弹窗和其他独立页面。
- 修改 `dashboard.html` / `app.css`，或复制其中的静态消息、假项目、右侧栏、开发工具条、
  localStorage 状态和演示脚本；参考文件全程只读。
- 新增、删除或改写侧栏入口；生产已有“重新查看引导”必须保留。
- 会话排序、状态点来源、草稿、发送、中断、附件、团队切换、目录轨模型和响应式业务规则。
- 修改 local-console API、desktop IPC、SQLite、runner 或任何运行时数据契约。

## 影响

- 主要修改：
  - `packages/console-ui/src/console/operator-console.tsx`
  - `packages/console-ui/src/console/conversation-sidebar.tsx`
  - `packages/console-ui/src/console/conversation-layout.ts`
  - `packages/console-ui/src/console/role-composer.tsx`
  - `packages/console-ui/src/console/run-block.tsx`
  - `packages/console-ui/src/console/new-conversation-page.tsx`
- 同步修改相关测试、Page / Block Story 与 `packages/console-ui/DESIGN.md`。
- 新增 `scripts/acceptance/console-dashboard-ui.ts` 真实 Electron 验收脚本；按仓库命令闸门同步
  更新根 `AGENTS.md` 的验收命令和 `docs/architecture/module-map.md` 的验证边界。
- desktop renderer 继续消费同一 `OperatorConsole` props，不新增 IPC 或状态。
- 不修改 `dashboard.html` / `app.css`；它们是本次输入参考，不成为生产依赖。
