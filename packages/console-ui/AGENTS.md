# console-ui · 包内操作约定

本包承载 Moebius 的生产 UI 源码与唯一浏览展示入口 Storybook。视觉语言事实源见 `DESIGN.md`，当前行为事实源见 `openspec/specs/console-ui/spec.md`；本文件只规定在本包内如何组织和验证工作。

## Story 分层

- `Component`：可独立复用的控件或聚焦内容单元，不负责完整产品区域。
- `Block`：由多个 Component 组成、职责边界明确的产品区域，例如侧栏、时间线区块或 composer。
- `Page`：由真实生产导出组合出的完整 screen state；成熟页面默认必须提供 Page Story。

每个 `*.stories.tsx` 的 `Meta.title` MUST 以且只能以 `Component/`、`Block/` 或 `Page/` 之一开头。层级之后可以继续按产品域分组。

## Fixture 与集成边界

- Story MUST 直接渲染本包真实生产导出；不得复制一套只供 Storybook 使用的平行页面实现。
- Fixture MUST 是确定、可重复且不依赖本机用户状态的固定数据。
- Page Story MUST 在 meta 中设置 `parameters: { layout: "fullscreen" }`。
- Story MUST NOT 连接真实 IPC、runner、SQLite、Codex、GitHub、文件系统 capability 或用户数据。
- Storybook 负责生产组合和确定状态的浏览验证；真实 IPC、数据流、持久化与 renderer 集成最终在 desktop 中验证。

## 修改与门禁

- 修改成熟页面时默认同步其 Page Story；新增 Story 时选择最小准确层级，不用 Page 掩盖缺失的 Component 或 Block。
- 运行 `pnpm --filter @moebius/console-ui check:storybook` 检查目录分类并构建静态 Storybook。
- Storybook 静态构建是临时产物，不提交 `storybook-static/`，也不维护平行 `*.ui.html`。
- 本包不保留静态设计参考稿（HTML/CSS/图片等）：设计探索材料归档在 `docs/design-explorations/`，未解决的设计问题进 `prototypes/`，浏览展示唯一入口是 Storybook。
