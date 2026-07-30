# 任务：align-console-dashboard-shell

- [x] 读取根目录、产品文档与 `packages/console-ui` 的 AGENTS 规则，确认实现授权为 granted、方案需先交主理人核验。
- [x] 对照 `main-left-sidebar.md`、`main-conversation.md`、现行 console-ui spec、`DESIGN.md`、模块地图、`dashboard.html` / `app.css` 与生产组件，完成现状 / 期望 / 落点分档。
- [x] 明确纳入左侧边栏和主会话区域，排除右侧栏、原型脚本 / 假数据及业务行为变化。
- [x] 落盘 proposal、design、wireframes、tasks 与 console-ui spec delta，并完成方案自审。
- [x] 运行格式、Source 锚点与目录人工校验；当前仓库未安装 `openspec` 命令，严格 CLI 校验不可用。
- [x] 主理人核验方案、范围和下方真实运行验收清单并放行实现。
- [x] 更新 `packages/console-ui/DESIGN.md`：主会话 840px 内容轴、侧栏默认密度、主 / embedded 视觉变体边界。
- [x] 对齐 `OperatorConsole` 左侧栏外壳：252px 默认宽度、46px 控制行、34px 品牌 / 导航节奏、固定底部操作；保留拖动调宽、自动收起和全部现有入口。
- [x] 对齐 `ConversationSidebar`：32px 项目 / 会话行、28px 会话缩进、`»` 选中标记、状态点和 hover / focus 动作；保留排序、折叠、修复、菜单和拖动规则。
- [x] 对齐左右两区表面层级：共享 `bg-canvas`，使用 `bg-sel` / `bg-hover` / `bg-card` 与 1px `border-line`，落实 display / body 字体层级，不新增裸色、阴影或渐变。
- [x] 把 `conversation-layout.ts` 收敛为 840px + 32px gutter 的主会话单一内容轴，并让新对话、标题、时间线、通知、待发射区与 composer 复用。
- [x] 锁定滚动与底部关系：侧栏只有项目列表滚动，主区只有时间线滚动；标题与 composer 保持可达，最后一条消息不被 composer 遮挡。
- [x] 对齐主会话消息和活动记录：24px 身份头像、32px 正文缩进、68ch Agent 正文、75% 用户气泡；通过显式 main 变体隔离右侧子任务。
- [x] 对齐主会话 / 新对话 `RoleComposer`：14px 容器、28px 上下文项、单行起步 / 120px 上限和 32px 操作按钮；embedded composer 保持原布局。
- [x] 更新 `Page/Console/OperatorConsole` 与相关 Block Story，覆盖侧栏、长消息、活动 run、新对话、左右栏组合和窄宽状态。
- [x] 补充或修订定向测试，覆盖关键几何、共享内容轴、main / embedded 隔离及现有发送 / 停止 / 附件 / 输入法行为回归。
- [x] 新增 `scripts/acceptance/console-dashboard-ui.ts`：用临时数据根、临时附件和临时 fake codex 启动真实 Electron，稳定生成失败、成功未读、运行中、活动 run、待发射、附件及发送 / 停止状态；覆盖自动断言、清理和 `--hold` 人工复核。
- [x] 按新增命令闸门同步更新根 `AGENTS.md` 的验收命令、`docs/architecture/module-map.md` 的验证边界及相关 OpenSpec 验收说明，不改运行时模块依赖。
- [x] 合并运行 `pnpm --filter @moebius/console-ui test`、`pnpm --filter @moebius/console-ui typecheck`、`pnpm --filter @moebius/console-ui check:storybook`、`pnpm --filter @moebius/desktop test`、`pnpm --filter @moebius/desktop typecheck` 与根级 `pnpm typecheck`，日志写系统临时目录并只报告关键结果。
- [x] 先运行 `pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts` 获取真实 Electron 自动证据，再以 `--hold` 按 `design.md#真实运行验收` 五条逐项复核；Storybook 只作确定性补充，截图 / evidence 只写系统临时目录。
- [x] 对照 proposal、spec delta 与排除范围做符合度反思，确认右侧栏与运行时契约没有清单外改动后再声明 `code-verified`。

## QA 回归修正
- [x] 依据真实 Composer 底部组合区高度动态设置时间线留白、回到底部按钮和 Relay Rail 底部边界，覆盖最大文本、附件与待发射同时存在。
- [x] 移除主操作台与 Electron 480px 最小窗口冲突的固定 560px 最小高度，验证短窗只滚动项目列表 / 时间线且侧栏底部操作始终可达。
- [x] 为 main Composer 增加专属验收锚点，修正验收脚本误命中 `RunBlock` 的假阳性，并新增遮挡与短窗几何断言。
- [x] 修复 `--hold` 经 `pnpm ... --hold` 收到 Ctrl+C 时的 Electron / fake Codex 退出和临时数据根清理，并独立复核该路径。
- [x] 重跑 Console UI 测试 / typecheck、Storybook、Desktop build、真实 Electron 自动验收与 `--hold` 清理；完成二次符合度反思后重新归档。
