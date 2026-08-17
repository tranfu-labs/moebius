# 设计：process-step-detail

## 方案

### 1. 步骤投影：从「事件类型」改为「事件类型 + 载荷」

`projectStructuredRunActivity` 目前只按事件 type 分类，取对象时只看少数几个字段，且 `safeLabel` 会把任何含 `/` 的串压成 basename——这是搜索 URL 被拆成 `https:moebius`、命令被压成 `zsh SKILL.md` 的直接原因。

改动点：

- **命令**：优先取原生调用载荷里的用途说明（Claude Bash 的 `description`，实测 855/855 次都有）。没有时取命令原文，剥掉 `zsh -lc` 一类 shell 包装再截断，不再按空白取前两个 token。
- **skill**：调用名为 skill 时，对象取调用参数里的 skill 名，而不是工具名本身。
- **工具 / MCP**：去掉 `mcp__<server>__` 前缀只留工具名。
- **读写文件**：`file_path` 类字段在 Claude 侧走的是 tool 分支而非 file 分支，导致 681/681 次 read 无对象。按工具名归类修正后取 basename。
- **搜索**：查询词不过 `safeLabel` 的路径压缩，只做长度截断与秘密剥离。
- **思考**：取思考文本首句（截断到一行）。

`safeLabel` 现为全局函数，路径压缩对所有类型生效。改为按类型选择清洗策略，秘密剥离（token/secret/password/authorization/bearer）保持全局。

### 2. 工具返回并入调用步骤

`foldRunActivityStep` 目前按 `kind + object` 折叠，工具返回事件因 object 为空而成为独立步骤（70% 的空行来源）。改为按调用标识关联：返回事件不新建步骤，而是关闭对应调用步骤并携带其输出与成功/失败。

### 3. 步骤输出与展开

`LocalRunActivity` / `ProcessStep` 增加输出与失败字段。输出在投影时即按上限裁剪并记录剩余量，不把完整输出送进 UI 层——避免 65KB 量级的返回进入渲染树与持久化步骤。

裁剪规则：单步输出上限约 12 行；超出时优先保留含错误信息的行，再按原顺序补足，末尾标注剩余行数。

`ProcessStep.status` 的 `failed` 分支在组件里已有红色渲染，但两个产出方（`terminal-record-plan.ts:116`、`operator-console.tsx:3962`）都只产出 `done` / `running`，该分支从未触发。本次接上。

### 4. 打开两个引擎的思考文本

- **Claude**：`buildClaudeArgs` 增加 `--thinking-display summarized`。
- **Codex**：`buildCodexExecOptionsForProfile` 增加 `-c model_reasoning_summary="detailed"`。

两者的实测证据：

| 引擎 | 当前配置 | 加开关后 |
| --- | --- | --- |
| Claude 2.1.222 | 12 个 worktree 共 731 个 thinking block，文本非空 0 个；实时流 `thinking_delta` 文本为空串，只有 `estimated_tokens` 与 signature | opus/effort max 下 12 个 delta、1036 字可读文本 |
| Codex | 8 月 133 份 rollout 共 14,275 条 reasoning，带文本 0.7%，其余只有 `encrypted_content` | 产出 `**Planning complete weighing decision tree**` 一类可读摘要 |

对照实验覆盖了 `--permission-mode` plan/auto、`--effort` high/max、opus/fable 两个模型，均不改变结果——变量确实只有这个开关。

### 5. 过程区层级与展开反馈

`RunBlock` 的可见顺序统一为「角色信息 → 过程步骤 → 流式正文／最新活动 → 运行操作」。过程步骤记录已经发生的结构化工具轨迹；“正在发布”一类流式正文是 Agent 此刻正在形成的输出，因此后者不得把工具轨迹推到正文下方。`main` 与 `embedded` 继续复用同一个 `ProcessTrail`，只保留既有 32px / 28px 承载缩进差异。

过程区总 disclosure 与单步详情都使用 `grid-template-rows` + opacity 的 CSS transition，从元素当前计算进度向新状态继续，允许快速反向点击而不从首帧重启。时长与曲线读取 `--dur` / `--ease`；只展开容器，不缩放、位移或弹跳内容。`prefers-reduced-motion` 下取消 transition 并直接落到终态。关闭内容保留在 DOM 内但标记 `aria-hidden`，其中只有只读文本，不产生隐藏焦点。

### 6. 状态矩阵

本次变更涉及主会话时间线与右侧栏 embedded 运行块；两处都复用 `ProcessTrail`，状态设计不派生第二套组件。Storybook 中 `Block/Console/ConversationView · 过程步骤生命周期` 验证主会话承载，`Block/Console/RunBlock · 右侧栏 · 过程步骤` 验证次要承载。

| 页面 | 空态 | 加载中 | 报错 | 无权限 | 超长文本 |
| --- | --- | --- | --- | --- | --- |
| 主会话时间线 | 无步骤时不渲染过程区，复用 `RunBlock · 页面同款 · 无步骤运行` | 复用 `ProcessTrail · 加载中 · 等待步骤输出` | 复用 `ProcessTrail · 报错 · 单步失败` | 复用 `ProcessTrail · 无权限 · 文件步骤失败` | 复用 `ProcessTrail · 超长文本 · 换行与裁剪` |
| 右侧栏 embedded 运行块 | 无步骤时不渲染过程区，保留既有活动摘要 | 复用主会话的步骤内等待输出处理 | 复用主会话的失败步骤与错误摘要处理 | 复用主会话的无权限失败处理 | 复用主会话的自动换行与有界输出处理 |

一致性复核：两处同类操作均为整行 disclosure；展开／收起的可访问文案统一；图标全部来自 Lucide 线性图标并统一 `strokeWidth=1.5`；间距、色值、字号、圆角与动效时长均引用现有 Tailwind／CSS token；过程区没有主次操作竞争。两处唯一承载差异是已建立基准的 32px／28px 缩进，不构成新增偏离。

## 权衡

**输出进时间线 vs 只留在右侧栏。** 已冻结的「全量输出不进时间线」保护的是"翻历史不被机器输出淹没"。本次让用户能就地看单步输出，靠三条约束守住原意图：单步上限约 12 行、终局默认收起整个过程区、全量仍只在右侧栏。放弃的是"时间线绝对不含任何输出"这条更简单的规则；换来的是用户不必为了确认某一步是否做对而跳去右侧栏翻整轮流水。实测支持这个取舍：941 条工具返回中位 690 字符、80% 不足 2000 字符，多数本来就落在上限内。

**投影时裁剪 vs 渲染时裁剪。** 选前者。工具返回最大 65KB，若完整进入步骤结构，会同时压到内存快照、终局持久化和渲染树。代价是右侧栏之外无法再拿到完整输出——可接受，因为完整输出本来就是右侧栏的职责。

**Claude 的 flag 不在 `--help` 里。** `--thinking-display` 在 2.1.222 上可用但未文档化，属于已知风险（见下）。仍然选它，因为替代方案是改用 API 直连，那是换执行引擎级别的改动。

**思考首句 vs 思考全文进步骤行。** 行内只放首句，全文进展开态。首句用于判断方向对不对，这是运行中真正需要的；全文放行内会让每步占十几行，过程区失去可扫读性。

## 风险

- **Claude 的 `--thinking-display summarized` 未出现在 `--help`**，存在随版本静默消失的可能——[claude-code#20127](https://github.com/anthropics/claude-code/issues/20127) 就是一次同类静默回归（v2.1.8 起 stream-json 不再输出 thinking）。缓解：把"三引擎都能显示思考首句"写成验收项，并在 CLI 版本校验处覆盖；开关失效时步骤行退化为无首句的思考行，不影响其他步骤类型。
- **思考明文与命令输出会进入过程记录与持久化步骤**，比现在多暴露一层内容。必须走既有秘密边界：完整 API Key、凭据、授权头不得出现。命令输出比思考更可能带本机路径与环境信息，需要确认现有清洗覆盖到它。
- **Codex 开启 reasoning summary 后 rollout 体积增加**。计费不变（思考 token 本来就计费），但落盘内容变多。
- **步骤结构变化影响已持久化的历史消息**。旧会话的步骤没有输出字段，展开时必须显示"当前引擎没有记录"而不是空白，且不得回填。
- 回滚：四项投影改动与两个引擎开关彼此独立，可单独回退；UI 展开能力回退后步骤行仍保留补齐后的对象。
