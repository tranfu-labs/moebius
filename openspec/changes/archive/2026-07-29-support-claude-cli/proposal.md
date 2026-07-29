# 提案：support-claude-cli

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/prd.md` | 持久 Agent 与外部执行会话连续性 | Claude Code session 与 Codex thread、Kimi session 遵守同一唯一身份和精确 resume 契约 | 已写入 |
| `docs/product/pages/agent-teams.md` | 页面目标 / Agent 运行配置 / 验收 #14–15 | Claude Code 成为第三种静态 CLI profile；切换默认 `sonnet/high` | 已写入 |
| `docs/product/pages/main-conversation.md` | 选择工作空间与团队 / Agent 执行与恢复 / 验收 #47–48、#58 | Claude 硬路由、全局版本门、不干预原生配置、唯一 session、附件、错误、旧会话与禁止跨 CLI 降级 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | 过程标签 / 页面状态 | Claude 与 Kimi 一样没有可恢复的完整过程记录，使用执行引擎中性不可用说明 | 已写入 |
| `docs/product/pages/onboarding.md` | 第 1 步 / AI 建队 / 操作与反馈 / 验收 #3–4、#20、#22、#27–29 | 三 CLI readiness、安装/更新、兼容提示及 `Codex → Kimi → Claude` 建队顺序 | 已写入 |

本 change 只引用上述产品事实源，不复制页面正文。Claude 官方 CLI 参数、认证检查与
安装入口以实施时锁定的官方文档为外部协议依据。

## 背景

Moebius 已把 Agent 的执行配置抽象为 CLI/model/effort，并通过 execution driver
registry 支持 Codex 与 Kimi 的 full/resume/cancel。当前缺口不是再造一套会话模型，
而是把 Claude Code 接到既有边界上：

1. profile 类型与 SQLite CHECK 仍只允许 `codex | kimi`；
2. local-console 没有 Claude headless adapter、session id 核验、取消和附件交付；
3. onboarding 只检查和安装两套 CLI；
4. AI 建队只会在 Codex 与 Kimi 中冻结一套 driver；
5. UI 静态 registry 没有 Claude model/effort。

本机已发现 Claude Code `2.1.220`，其 help 表面具备 `-p`、stream-json、
`--session-id`、`--resume`、`--model`、`--effort`、permission/tool 约束与
`auth status --json`。方案阶段尚未登录，只完成无推理协议核验；实现验收时已在登录
环境中完成真实 full / resume / managed attachments / cancel 硬门。

## 原始目标映射与依据

| 原始目标 | 对应清单项 | 依据 | 是否新增偏好 |
| --- | --- | --- | --- |
| Agent profile 可选择 Claude | 1、4、6.1 | 现有 Kimi 对等面：每名成员静态绑定 CLI/model/effort | 否 |
| Claude model/effort registry | 1、6.1 | 既有静态 registry 契约 + Claude 协议：`fable`/`sonnet`/`opus` 是官方 alias；Fable 支持 `low/medium/high/xhigh/max`，Sonnet/Opus 跨 provider 可精确冻结的共同 effort 为 `low/medium/high/max` | 切换默认 `sonnet/high` 是已确认产品选择 |
| 各模型官方默认 effort | 1、6.1 | Claude 协议：Fable/Sonnet/Opus 当前默认均为 `high`；这只用于说明协议，不等于 Moebius 切换 Claude 时应默认选择哪个 model | 否 |
| 最低 Claude 版本 | 2、3、6.2–6.5 | Claude 协议约束：AI 建队隔离依赖 v2.1.169 的 `--safe-mode`，Fable 要求 v2.1.170，完整范围取两者上界；产品确认采用全局门 | 全局门是已确认产品选择 |
| local full/resume/cancel | 2、6.3–6.5 | 现有 Kimi 对等面：硬路由、唯一 session、精确 resume、有界取消 | 否 |
| 可见 Markdown 增量 | 2、6.3 | 现有 local-console 可见过程契约 + Claude `--include-partial-messages` 协议 | 否 |
| onboarding readiness | 3、4、6.2 | Kimi 已实现面：独立版本/认证状态、任一 ready 放行、无推理检查 | 否 |
| 内置安装 | 3、4、6.2 | Kimi 已实现面：缺失行固定官方动作、受信任 registry、安装后复检 | 否 |
| AI 建队 | 4、6.2、6.5 | Kimi 已实现面：readiness 选择、draft 冻结、只读隔离、唯一 session | `Codex → Kimi → Claude` 是已确认产品选择 |
| 图片和普通附件 | 2、6.4–6.5 | Kimi 已实现面：managed copy、图片能力、普通文件 manifest、失败不跨 CLI | 否 |
| GitHub issue runner | 6.6 范围护栏 | 现有 Kimi 明确未接入；“与 Kimi 对等”要求 Claude 同样不接入 | 否 |
| 普通 Claude 配置边界 | 2、6.3、6.6 | 用户确认 Moebius 不应介入 Claude 自身配置加载；项目只负责 argv/settings IO 边界和内部 Agent/team 禁令 | 不干预是已确认产品选择 |

这里的“对等”按现有 Kimi 已实现表面逐项取交集：onboarding readiness、内置安装、
AI 建队和本地附件已经支持 Kimi，所以 Claude 必须补齐；GitHub issue runner 当前没有
Kimi provider，故 Claude 也保持不接入，runner 继续 Codex-only。onboarding 与安装本身
并非 Codex-only，不能以“控制范围”为由漏做；反过来也不把 Claude 顺手扩张到
GitHub runner、CEO guardrail 或 `config.toml` provider override。

## 已确认产品选择

1. 用户主动把 CLI 切换到 Claude Code 时，compatibility default 固定为
   `sonnet/high`；未配置成员仍保持 `Codex / gpt-5.6-sol / high`。
2. AI 建队按 `Codex → Kimi → Claude Code` 选择第一套 ready CLI，保持已有 Codex/Kimi
   行为不变；draft 一旦创建仍禁止跨 CLI。
3. 普通 Claude Agent 不干预 Claude CLI 配置加载：Moebius 不传 `--safe-mode`、
   `--setting-sources`、`--strict-mcp-config`、`--disable-slash-commands` 或 `--tools`，
   不创建 replacement settings，也不查找、读取、解析、复制或管理用户配置。Claude
   实际加载哪些原生扩展不属于本 change 验收；内部 Agent/team 禁令仍是产品运行边界。
4. Claude Code `<2.1.170` 使用全局版本门：onboarding 显示升级动作；每次 full/resume
   前重新检查实际 executable，旧版不创建 session、不崩溃，并提供受信任更新入口。
   团队静态配置仍可保存，支持跨机器携带。

## 提案

### 切片 A：静态 profile 与存储迁移

- `ExecutionCli` 增加 `claude`，保持默认 profile 仍为
  `Codex / gpt-5.6-sol / high`。
- Claude 首版 registry 提供 `fable`、`sonnet` 与 `opus`：
  - `fable`: `low / medium / high / xhigh / max`；
  - `sonnet`: `low / medium / high / max`；
  - `opus`: `low / medium / high / max`。
- 切换 Claude 的 compatibility default 固定为 `sonnet/high`。
- 首版只对 Fable 提供 `xhigh`；Sonnet/Opus 的 alias 会在部分 provider 静默回落，
  因此不提供其 `xhigh`。首版不提供 `default`、`best`、`opusplan`、完整版本 ID、
  1M alias 或 `haiku`；
  已保存未知值继续作为旧版自定义配置。
- 以事务化 table rebuild 扩大 `session_agent_team_members.execution_cli` CHECK 到
  `codex | claude | kimi`，完整保留旧行、主外键和排序字段；NULL 旧快照仍是 legacy
  Codex。

### 切片 B：Claude local-console driver

- 新增 Claude adapter，复用中性 driver registry、run execution context、canonical
  external session link、managed attachment 与 watchdog 契约。
- executable discovery 先按 host `PATH` 顺序选择第一个现有 `claude`，PATH 无候选时
  才检查官方 native 安装默认位置 `~/.local/bin/claude`；现有但不可执行的权威候选
  明确失败，不偷换版本；绝对路径、`shell: false` 启动。
- 每次 full/resume 在创建或恢复 session 前，对解析到的同一绝对路径执行 `--version`；
  `<2.1.170` 直接返回稳定升级错误与受信任 update action，不执行 `-p`、不写 session
  link、不调用其他 CLI。
- full 使用应用生成的 UUID `--session-id`，resume 只使用保存的 canonical ID；
  读取 JSONL `system/init.session_id` 与 terminal result session id 并精确核验，禁止
  `--continue`、最近会话与文件时间猜测。
- headless 调用固定
  `-p --output-format stream-json --verbose --include-partial-messages --model --effort`，
  使用受控 permission/tool 边界，禁用 Claude 内部 `Agent`、agent teams、
  `AskUserQuestion` 与后台 agent，让角色交接继续只由 Moebius 时间线负责。
- 普通 Agent 不传 safe-mode/setting-sources/strict-MCP/disable-slash/tools，不创建
  replacement settings，也不查找、读取、解析、复制或管理用户 Claude 配置；Claude
  自身实际加载行为不进入 Moebius 测试矩阵。Moebius 只施加冻结 profile、权限与内部
  Agent/team 禁令。
- 输出、协议、超时、取消和错误有界；原始 stdout/stderr 只写 run 诊断目录，不进入
  timeline。取消按 SIGINT → SIGTERM → SIGKILL 有限升级。
- 图片与普通文件都先进入 managed attachment 目录和 manifest；Claude 通过 Read
  工具读取安全路径，不能读取或写入可信根外目标，也不能失败后改用其他 CLI。

### 切片 C：desktop readiness、安装与 AI 建队

- onboarding 增加独立 Claude 行。先检查 `claude --version`，最低版本 `2.1.170`；
  再执行 `claude auth status --json`。旧版本提供受信任 `claude update` 动作，成功后
  只复检 Claude；检查与更新都不发模型请求、不枚举动态模型。
- 缺失态提供固定官方安装动作
  `curl -fsSL https://claude.ai/install.sh | bash`。主进程 registry 只接受 CLI enum，
  curl 与 bash 分进程经 Node stream 连接，禁止 shell command 拼接。
- 三套检查与安装各自 revision/状态独立，可以并发；任一 ready 即放行，聚合数量从
  双项泛化为 n 项。
- AI 建队按 `Codex → Kimi → Claude Code` 选择第一套 ready CLI。选定后在 draft
  生命周期冻结。Claude 使用 `--safe-mode`、隔离 cwd、只读工具
  profile、JSON schema、唯一 session id 与精确 resume；不加载项目 `AGENTS.md` /
  `CLAUDE.md`、个人 MCP 或写能力，不跨 CLI fallback。

### 切片 D：用户界面

- Agent Team profile editor 的 CLI enum 与联动 registry 增加 Claude，保持独立草稿、
  保存失败、父级重渲染和历史未知值契约。
- onboarding 由两行改成三行，并同步安装/更新、compatibility、终页和新建对话提示；
  runtime 旧版本失败也提供同一受信任更新入口；不增加新步骤，不改变“任一 CLI ready
  即可继续”。

## 影响

### 业务域

- `desktop-shell`：profile schema、SQLite migration、readiness、安装 registry、
  AI builder driver/spawner 与 IPC DTO。
- `local-console`：Claude executable resolver、headless protocol adapter、session link、
  attachment、cancel/watchdog 与安全错误。
- `console-ui`：Claude profile options、onboarding 三行、安装聚合与 compatibility。

### 主要代码落点

- `src/claude.ts`、通用 executable resolver、`src/local-console/*`。
- `desktop/src/team-execution-profile.ts`、`execution-capabilities.ts`、
  `desktop/src/onboarding/*`、AI team builder driver/spawners。
- `packages/console-ui/src/console/execution-profile-registry.ts`、
  Agent Team detail 与 onboarding shell。
- `tests/claude*.test.ts` 及既有 runtime/store/onboarding/UI 测试。

### 兼容性

- Codex、Kimi 参数、发现顺序、认证探针、resume 和现有测试必须保持不变。
- GitHub issue runner 与 `config.toml` Codex provider override 继续 Codex-only。
- 不自动迁移既有 member profile，不把旧 NULL snapshot 切成 Claude。
- 不因账号、组织策略、额度或临时服务状态修改团队页静态配置。

### 非目标

- GitHub issue runner、CEO guardrail 或远程 issue 流程改用 Claude。
- Claude 账号登录、组织策略、API key 或 provider 管理。
- 动态枚举 Claude 模型、完整版本 ID、1M context 选择或应用级 CLI fallback。
- 把 Claude 内部 Agent/agent teams 纳入 Moebius 编排。
