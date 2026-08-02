# 提案：console-message-run-humanization

## 背景

本地对话操作台已有数据正确级的 `operator-console.tsx`，但 `packages/console-ui` 还缺少可复用的消息与运行态复合组件。当前 agent 长回复、Codex 运行输出以及 `exit:42`、`idle-timeout:10ms`、`dead-letter` 等机器状态会直接占据用户可见区，不符合 `openspec/changes/conversation-console/` 已确认的渐进披露和人话化设计。

需求侧已在 issue 时间线正式确认以下展示契约：

- agent 摘要默认从原始 Markdown 的 `## 结论`、stage marker、交棒行自动提取，调用方显式字段可覆盖自动结果；
- 运行块使用独立最小展示模型：步骤标题、状态、人话概括、原始输出，暂不绑定 local-console runtime 类型；
- failed、stuck、interrupted、dead-letter 使用已确认的固定中文主文案，原始机器原因保留但只在折叠详情展示。

第一轮 QA 评审发现无步骤运行块在 `steps`、摘要和耗时同时缺失时没有确定性分支。需求侧接受该缺陷结论，并正式接受 QA 增补 A–C；因此本 change 的正式验收清单由原三条增至六条，范围守卫不变。

旧 HTML 原型仅作为实现期视觉参照，可从提交 `d50f119^` 的 `component-library/sections/agent-fold.html` 与 `component-library/sections/run-block.html` 读取，不回迁为第二套事实源。`packages/console-ui/src/console/accept-card.tsx` 是组件组合、语义令牌和扁平视觉语言的活参考。

## 提案

在 `packages/console-ui/src/console/` 新增三个彼此独立的展示切片及 Story：

1. **agent 折叠消息**：默认呈现中文角色名、人话 stage、结论和人话化交棒行；展开后呈现未经删减的原始 Markdown。组件支持显式摘要字段覆盖自动解析结果。
2. **运行块**：始终呈现中文角色名、耗时和中断按钮；有步骤时逐条呈现已完成、进行中、未开始状态并允许查看每步原始输出；无步骤时降级为单行人话概括，原始输出仍可展开。当摘要或耗时为空、纯空白或缺失时，组件分别使用「正在运行，等待进展」和「耗时未知」兜底，不能渲染空白卡。
3. **运行结局人话化**：failed、stuck、interrupted、dead-letter 的用户可见区只呈现已确认的中文概括；`exit`、`idle-timeout` 等机器原因只出现在折叠详情。
4. **Story 与测试**：用独立 Story 覆盖 agent 默认折叠/展开、运行块有步骤/无步骤和四种异常结局；用组件测试固定解析覆盖、降级和原始内容可追溯行为。

## 影响

受影响范围：

- `packages/console-ui/src/console/`：新增 agent 消息、运行块、运行结局组件及其测试和 Story。
- Storybook：新增上述独立组件的可视化场景。
- `openspec/changes/console-message-run-humanization/`：记录本切片的方案、任务和 console-ui 行为增量。

明确不在范围内：

- 不修改 `packages/console-ui/src/console/operator-console.tsx` 及其 Story / 测试。
- 不修改 `packages/console-ui/src/index.ts`，不做共享出口整合。
- 不绑定 local-console、desktop IPC、runner、Codex 或 SQLite 类型与状态管理。
- 不回迁旧 HTML 原型，不新增第二套 token 或样式事实源。
- 不调整既有验收语句、运行时行为或错误分类逻辑。

## 验收语句

验收语句 1–3 原样沿用 issue 初始清单；验收语句 4–6 原样采用需求侧正式接受的 QA 增补 A–C：

1. 打开 agent 消息 Story → 默认显示角色中文名、阶段、结论和交棒行，展开后可见完整原文。
2. 打开有步骤与无步骤的运行块 Story → 均显示角色中文名、耗时和中断按钮；步骤逐条显示状态，无步骤时降级为单行人话概括，原始输出折叠可查。
3. 打开 failed、stuck、interrupted、dead-letter Story → 用户可见区均为中文人话概括，exit、idle-timeout 等原始机器串只在折叠详情出现。
4. 用键盘依次操作 agent 消息、步骤输出和运行结局的披露控件 → 一次 Enter 或 Space 激活即可切换展开状态；折叠时机器原文不可见，展开后完整可查。
5. 分别用鼠标和键盘激活运行块中断按钮并注入计数 spy → 单次激活仅调用一次 `onInterrupt`，且组件不崩溃。
6. 向原始输出注入换行、尖括号、与号及 `exit:42` 等机器串 → 首次折叠渲染不暴露这些内容，展开后文本内容保持原值。
