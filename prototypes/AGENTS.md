# 高保真原型沙盒规范

## 定位

本目录只承载用于回答明确、未解决设计或交互问题的可交互高保真探索。只有 production Component / Block / Page Story 无法回答该问题时才进入本目录；成熟页面的默认浏览展示与确定状态评审属于 `packages/console-ui` Storybook。本目录不是正式产品实现、组件库样例、成熟页面默认预览或运行时依赖。

每份原型的最终评审交付物是一个可离线直接打开的自包含 HTML；React、Motion、Vite 等只属于 authoring 与构建过程。

## 双向隔离

- `prototypes/` 内代码 MUST NOT import `src/`、`desktop/`、`packages/`、`sites/` 或其他正式产品实现。
- 正式产品代码 MUST NOT import、复制粘贴或在运行时读取 `prototypes/` 源码及构建产物。
- 原型不得接入真实 IPC、SQLite、runner、Codex、GitHub、文件系统 capability 或用户数据；需要状态时使用本地 fixture。
- 原型和正式实现只通过产品事实源建立关系：原型读取 `docs/product/` 的要求，正式实现也读取同一份 PRD；两者不以彼此源码为事实源。
- 可以为了视觉对齐在原型内冻结一份颜色、排版和间距快照，但不得 import 正式设计令牌。原型视觉获批后，由正式实现重新投影到生产设计系统。

## 产品事实与文件落点

- 页面原型必须指向一份 `docs/product/pages/<page>.md`，流程原型必须指向一份 `docs/product/flows/<flow>.md`。
- PRD 是唯一产品事实源。原型不得添加 PRD 未确认的入口、业务规则、错误恢复或跨页去向。
- 产品决策先改 PRD，再改原型；冲突时以 PRD 为准。
- 最终 HTML 发布到对应 PRD 同目录，命名为 `<page>.prototype.html` 或 `<flow>.prototype.html`。
- 生成 HTML MUST 在可见或源码注释中声明“设计原型、非正式实现”以及对应 PRD。

## 单 HTML 交付

- HTML、CSS、JavaScript、SVG、图标和必需字体 MUST 全部内联；禁止依赖 CDN、开发服务器或 `node_modules` 静态路径。
- 构建 MUST 先写 `prototypes/dist/` 下的精确临时输出，再经发布脚本验证后原子替换目标 HTML。NEVER 把 Vite `outDir` 直接设为 `docs/product/` 或其子目录。
- 发布门禁 MUST 拒绝外部 `script src`、stylesheet、图片、字体和其他必需资源 URL。
- 最终 HTML MUST 能通过 `file://` 打开并完成核心交互，不得只支持 HTTP server。
- 生成物允许较大且难以人工 review；可维护源码仍在 `prototypes/src/`，生成物只服务打开即看和截图比对。

## beUI / 第三方动效源码

- [starc007/ui-components（beUI）](https://github.com/starc007/ui-components) 按其 copy-source 模式使用，只复制当前原型确实需要的最小组件或动效原语。
- 复制或改写的文件 MUST 保留来源 URL、上游许可证和“已为本原型适配”的说明。
- 禁止整库镜像、复制未使用组件或把原型适配代码误称为正式产品组件。
- 第三方源码只存在于原型依赖图中；正式实现若也决定采用，必须在正式代码域单独评估和引入，不能从本目录建立跨域依赖。

## 动效与可访问性

- 动效必须解释状态变化、控制权交接或操作反馈；禁止只为热闹加入持续漂浮、弹跳或无意义循环。
- 所有持续或大幅位移动效 MUST 支持 `prefers-reduced-motion`，减少动态效果时保留等价的信息顺序和当前状态。
- 核心旅程必须支持键盘；按钮、场景控制和可选项必须有可读名称、焦点态与正确 disabled 语义。
- 动画不得成为继续操作的硬门，除非 PRD 明确要求等待。

## 构建与验证

- 安装：`pnpm install`
- 单元测试：`pnpm --filter @moebius/prototypes test`
- 构建并发布 onboarding：`pnpm --filter @moebius/prototypes build:onboarding`
- 最终 HTML 验证：`pnpm --filter @moebius/prototypes verify:onboarding`
- 构建并发布 settings：`pnpm --filter @moebius/prototypes build:settings`
- 最终 HTML 验证 settings：`pnpm --filter @moebius/prototypes verify:settings`
- 完整门禁：`pnpm --filter @moebius/prototypes check`

每份原型至少验证：

1. 状态模型的主路径、硬门、重试和重播。
2. 最终单 HTML 从 `file://` 打开。
3. 核心旅程鼠标与键盘可完成。
4. 无 HTTP(S) 资源请求。
5. 宽屏、窄屏、亮色、暗色和减少动态效果下仍可读。
6. 截图与结构化验证证据来自本轮新构建的产物。

## 禁止事项

- NEVER 为了复用方便把原型源码放进 `packages/console-ui` 或正式 renderer。
- NEVER 用隔离原型替代成熟页面的 production Page Story；探索问题解决后必须回到正式 UI 与 desktop 集成链路。
- NEVER 让正式实现直接消费生成 HTML。
- NEVER 在未更新 PRD 时用原型偷偷决定产品行为。
- NEVER 提交 `prototypes/dist/` 临时目录。
