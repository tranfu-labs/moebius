# 本项目适用方案：completion-handoff

## 模块划分与数据流

本 change 只增加和分发 `completion-handoff` Skill，复用运行环境已经存在的表单 MCP 能力；不创建新的 MCP server，也不改已有 MCP 的工具、schema、bridge、preflight 或生命周期。

| 单元 | 责任 | 依赖 | 独立验证 |
| --- | --- | --- | --- |
| M1 Skill 源与分发 | 维护 `.agents/skills/completion-handoff/SKILL.md`；启动时将 Moebius Skill 注册到数据根，并在 Claude Code/Codex 的标准用户 Skill 根建立受控软链接；Kimi/Pi 保持 TODO | 仓库现有 Skill 目录、启动入口、Claude/Codex 标准 Skill 目录 | Skill 注册表单测、软链接冲突/恢复测试、类型与边界检查 |
| M2 完成交接编排 | Skill 规定完成判定、证据收集、分支/worktree 事实核查、四类选项内容和无副作用边界；Agent 在当前运行环境发现并调用已有表单能力 | M1；已有 provider MCP 能力 | Claude/Codex 实际 Skill 加载与交接演练；仓库只验证 Skill 分发，不复制外部表单协议 |
| M3 用户选择回流 | 复用已有表单能力返回用户选择，由 Agent 按选择继续修改或提供外发/清理指引；不在 local-console 增加 closeout 状态、SQLite 表或自定义 UI | M2；已有会话消息和表单返回路径 | 现有表单能力的运行时验证；不可在本仓库内伪造协议测试 |

依赖顺序为 `M1 → M2 → M3`。M3 不新增代码模块，表示对既有 MCP 表单能力的使用边界。

## 关键选型与结构决策

| 本项目约束 → 采纳结论 | 选型理由 |
| --- | --- |
| 用户明确要求“不修改 MCP”，且已有表单能力可用 → 不新增 `moebius_closeout` server，不新增 `closeout_inspect` / `closeout_submit`，不修改任何既有 MCP 文件 | 直接遵守用户输入；避免重复实现已有能力和引入新的协议契约 |
| 用户要求 Agent 完成后引导下一步 → 将完成时机、事实核查、证据纪律和选项语义写入 `completion-handoff` Skill | Skill 是跨 provider 的行为编排层，符合用户对“工作手册”的定义 |
| 用户确认本轮只做 Claude/Codex，Kimi/Pi 为 TODO → 仅建立 Claude/Codex 原生 Skill 投影，Kimi/Pi 不新增接入 | 直接遵守用户确认的范围，不扩大 provider 改动面 |
| Claude Code/Codex 使用各自标准 Skill 根并支持按需读取完整说明 → 将源 Skill 复制到 Moebius 数据根的 `skills/moebius/<skill>`，再在 `~/.claude/skills` 与 `$CODEX_HOME/skills`（默认 `~/.codex/skills`）建立 `moebius-<skill>` 软链接 | 本地已观察到两个 provider 都从标准用户 Skill 根的直接子目录发现 `SKILL.md`；官方 Claude Code 文档与 Skill creator 约定也指向直接 Skill 目录，因此保留 provider 可发现性并避免假设未核实的嵌套 provider 协议 |
| 表单能力已由运行环境提供，但当前仓库与本次 provider session 未暴露其精确工具名 → Skill 要求 Agent 使用当前 `tools/list` 实际可见的既有表单能力，不硬编码工具名或 schema | 不猜测外部 API；工具不可见或调用失败时按真实失败处理，不伪造 JSON 或改用普通聊天问题 |
| 四类结束选项来自用户输入 → 表单选项固定覆盖 Git 分支、文件/worktree、实测链接/证据、继续修改；分支目标先核查 `dev`，存在时提示合入 `dev`，否则提示合入远程 `main` | 保持用户可见行为语义；目标分支由实际仓库状态决定，不写死当前分支 |
| 用户选择不等于动作已执行，外发动作待终验收 → Skill 只提交下一步意图和可核查指引，不执行 merge、push、worktree 解除、Trash 或发布 | 遵守外发与破坏性动作边界，保留用户控制权 |
| 会话 JSONL 是事实源，SQLite 只存可变状态 → 本 change 不新增 closeout 持久化状态；用户回答沿用既有表单/会话回流 | 不重复建立第二套交接状态，降低恢复与一致性风险 |
| `packages/console-ui` 只负责既有表单呈现 → 本 change 不复制或改造表单卡片，不在 renderer 增加 closeout 专属 UI | 复用已存在的表单能力，避免把外部表单协议重新实现到应用层 |

## Skill 行为边界

Skill 的内容按以下顺序指导 Agent：

1. 只有在当前任务确实完成、并且实际验证结果已经收束时，才准备交接。
2. 读取当前分支、远程目标、worktree 映射、改动文件和实际命令输出；每条证据保留命令、摘要、链接（如有）及通过、失败、跳过或未验证状态。
3. 核查是否存在 `dev` 分支：存在时将 Git 选项写成合入 `dev`；不存在时写成合入远程 `main`。不能从猜测推导仓库状态。
4. 通过当前运行环境已经公开的表单能力提交四类下一步选择。表单调用使用运行时实际发现的工具面，不把用户选择描述成已经执行的动作。
5. 用户选择后只继续提供对应指引或继续修改；涉及 push、merge、发布、worktree 解除或 Trash 的动作仍等待用户最终验收授权。

## 测试策略

| 单元 | 测试层级 | 验证内容 |
| --- | --- | --- |
| M1 | 纯逻辑/启动集成测试 | Skill frontmatter、中心注册表、Claude/Codex 软链接、冲突保护、并发恢复；复用已有 registry、启动、provider prompt 测试基础设施 |
| M2 | Skill 加载演练 + 既有 provider 适配测试 | 验证 Claude/Codex 走 native Skill loading，Kimi/Pi 维持 TODO/fallback；不写读取 Skill 原文的镜像测试 |
| M3 | 既有 MCP 表单能力的运行时演练 | 只观察既有工具发现、表单展示和用户选择回流；当前仓库不拥有该协议，因此不新增 MCP 单测或 bridge 测试 |

现有自建 closeout MCP 的测试、runtime 状态和专属 UI 测试不属于本方案，应在实现阶段随错误接入一起移除；不把删除测试当作“修绿”，交付说明列出删除原因。

## 方向性风险判定

### 维度一：Claude/Codex Skill 的发现与加载路径

处理路径：最小 spike 自验证，风险关闭。

- 探针命令：`find .agents/skills -maxdepth 3 -type f -print | sort`、读取本机 `/Users/wing/.claude/skills` 与 `/Users/wing/.codex/skills` 的 Skill 布局、Skill 注册表定向测试（实际执行：`pnpm test tests/moebius-skill-registry.test.ts`）。
- 可观察输出：仓库命令列出 `release-moebius` 与 `completion-handoff` Skill；本机两个 provider 都显示直接子目录下的 `SKILL.md`；Codex 目录修正后的 `pnpm test tests/moebius-skill-registry.test.ts` 输出为 `1 file passed`、`6 tests passed`、退出码 0；现有仓库启动入口明确从 `.agents/skills` 读取源素材，并将投影隔离在标准 Skill 根。
- 结论：保留中心注册表加 Claude/Codex 标准目录软链接；该条目升级为经测试验证的强基准，不需要用户确认。

### 维度二：既有表单 MCP 的协议是否应在本 change 内重新实现

处理路径：最小 spike 自验证，关闭“重新实现/猜测协议”的方向；外部部署事实保留待核实。

- 探针命令：`git grep -n -i 'mcp' origin/claude/agent-form-ui -- packages/console-ui/src/console/agent-form-card.tsx packages/console-ui/src/console/agent-form-model.ts packages/console-ui/src/console/agent-form-card.test.tsx openspec/changes/agent-question-form-card docs/product/pages/agent-form.md`、当前可调用工具名过滤 `/form|question|closeout|handoff/i`。
- 可观察输出：前一命令无输出；后一命令输出 `[]`。`.mcp.json` 只配置 `electron`，当前仓库已确认的 MCP 是 `moebius_managed`。
- 结论：本 change 不新增 server/tool/schema/bridge/preflight，不猜工具名；Skill 只使用目标运行环境实际公开的既有表单能力。该方向已由“用户要求不修改 MCP + 探针未发现本地协议”关闭。既有表单在目标 Moebius 运行环境中的可见性仍是来源事实，记为**待核实**；若未来实现必须直接绑定其 API 且运行时无法发现，则命中“依赖用户环境、无法由本仓库验证”的升级条件，再单独提交 2–3 个候选方案。

### 维度三：Kimi/Pi 是否本轮建立原生 Skill 投影

处理路径：用户已确认范围，关闭方向风险。

- 用户输入：#46 明确 Claude/Codex 本轮实现，Kimi/Pi 为 TODO。
- 结论：不为 Kimi/Pi 选择原生投影方案，也不修改其适配器；该维度不进入本轮实现。

本方案没有“无本项目依据，仅为惯例”的已采纳方向选择；未采用的旧 closeout 工具名不构成方案基准。

## 有意偏离清单

1. 【实现层】provider 标准 Skill 根使用单层 `moebius-completion-handoff` 入口，中心注册表保留 `skills/moebius/completion-handoff`；偏离用户曾提出的“外层 `moebius`、内层 `completion-handoff`”目录设想。理由是本地与官方 provider 约定均以标准用户根的直接 Skill 子目录发现 `SKILL.md`，嵌套目录协议在当前输入中待核实，单层入口更容易回退且不修改 provider 配置。

## 基准状态

本方案经评审交接后自主定稿，按纪律第 3 条分级作为基准；Claude/Codex 范围为用户已确认基准，Skill 分发模式沿用已验证的仓库实现。当前外部表单 MCP 的精确调用面仍记录为**待核实**，不得在实现中擅自补造。
