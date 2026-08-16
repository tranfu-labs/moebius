# 提案：process-step-detail

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-conversation.md` | [#过程步骤](../../../docs/product/pages/agent-conversation.md) | 新增小节：定义步骤行的动作与对象、按类型的可辨认事实、失败态、就地展开的输入与输出、单步输出有界规则 | 已写入 |
| `docs/product/pages/agent-conversation.md` | #最新活动 | 修改：「活动行不展示命令参数与命令输出」收窄为只约束常驻活动行，不约束主动展开的步骤详情；说明活动行的「正在／已完成」措辞为何不沿用到步骤行 | 已写入 |
| `docs/product/pages/agent-conversation.md` | #指标与验收 | 新增验收 44–50；验收 4 收窄为只约束活动行 | 已写入 |
| `docs/product/pages/agent-conversation.md` | #现状参考与产品缺口 | 新增 3 条缺口；#非目标 中「不把全量日志铺进时间线」补明有界展开不是例外 | 已写入 |
| `docs/product/pages/main-conversation.md` | #时间线 | 修改：「完整输出不进时间线」改称「全量输出不进时间线」，补一段说明过程步骤这一中间层与它不冲突 | 已写入 |
| `docs/product/pages/main-conversation.md` | #Agent 头像与当时信息 | 修改：推翻「监督交棒看最新一行活动摘要就够了」，保留其中仍成立的部分并记录推翻理由 | 已写入 |
| `docs/product/pages/main-conversation.md` | #指标与验收 | 新增验收 119 | 已写入 |

产品决策已在 `be6860f` 写入 PRD。本节只留指针。

## 背景

主时间线的「思考与工具调用 · N 步」在实现中已经存在，但此前没有产品定义，投影层因此大量丢弃源数据。

对全部 60 个本地会话、约 18 万条运行活动的普查：

| 步骤类型 | 步数 | 对象为空 |
| --- | --- | --- |
| tool | 10,629 | 70% |
| read | 681 | 100% |
| thinking | 190 | 100% |
| search | 248 | 56% |
| command | 20,375 | 0%，但一律带 `zsh` 包装前缀，真实命令常被挤掉 |

一次真实 run（`local:2026-08-16T06:35:09.059Z-h0m3op`）的过程区渲染出 33 行，内容是「正在思考 / 正在使用工具 Bash / 正在使用工具（空）」的循环。同一批调用在 provider 原生记录里存着每次命令的 `description`（`List seed teams and git status` 等）、被读文件的路径、被调 skill 的名称与参数。**信息在源头存在，是投影时丢的。**

其中 70% 的空 tool 步骤是工具返回事件被当成独立步骤渲染——每次工具调用因此多出一条没有内容的行。

思考文本另有一层原因：三个执行引擎中有两个在当前调用方式下不返回思考明文，需要在调用侧打开对应能力。

## 提案

1. **投影层补齐步骤对象**：命令取原生 `description`、无则取去掉 shell 包装后的命令；skill 取 skill 名；工具取去前缀的工具名；读写文件取文件名；搜索保留原始查询不按路径分隔符拆解；思考取首句。
2. **工具返回不再产出独立步骤**，改为并入对应调用步骤，成为它的输出与终态（含失败）。
3. **步骤行去掉「正在／已完成」前缀**，进行中由行自身的进行态表达。
4. **新增步骤级展开**：先输入后输出，单步输出超过约 12 行截断并说明剩余量，截断时错误信息优先保留。
5. **失败步骤可辨认**：收起态显示错误中第一句有内容的话，跳过纯退出码行。
6. **打开两个引擎的思考文本**：Claude 调用加 `--thinking-display summarized`，Codex 调用加 `-c model_reasoning_summary="detailed"`。两者均已实测有效，证据见 `design.md`。

## 影响

- `local-console` 域：`run-activity.ts`（步骤投影与安全标签）、`terminal-record-plan.ts`（终局步骤冻结）、`process-event-projector.ts`。
- `console-ui` 域：`process-trail.tsx`（步骤行、展开态、失败态）、`operator-console.tsx`（运行时映射）、i18n 文案。
- provider 调用参数：`src/claude.ts` 的 `buildClaudeArgs`、`src/config.ts` 的 `buildCodexExecOptionsForProfile`。
- 对外行为：时间线中每条运行记录的过程区信息量变化；provider 原生记录中新增思考明文，需通过既有秘密边界。
- 不影响：右侧栏过程标签、完整输出入口、运行耗时、活动行本身。
