# desktop-shell 规格增量

## MODIFIED Requirements

### Requirement: Agent execution profile is saved per team member

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The desktop MUST save a complete CLI/model/effort profile for each stable team id and member slug.
CLI MUST be `codex | claude | kimi`. Team list, detail, save and recommendation-restore operations
MUST resolve only persisted bindings, current applied recommendations and static profile rules.
They MUST NOT spawn, probe, authenticate or enumerate any CLI. Official members MUST distinguish
recommendation from user override; user teams and user-added members MUST use explicit profiles.

The product-bundled Claude registry MUST offer `fable` with
`low | medium | high | xhigh | max`, plus `sonnet` and `opus` with
`low | medium | high | max`. Each model's fallback effort MUST be `high`; switching the CLI to Claude
MUST choose `sonnet/high`. The registry MUST NOT offer dynamic `default`, `best`, `opusplan`, full
version ids, 1M aliases or `haiku`. Previously saved values absent from the current registry MUST
remain an unsupported legacy custom value until the user explicitly selects and saves a supported
combination. A missing binding MUST continue resolving to `Codex / gpt-5.6-sol / high`.

The local-console schema migration MUST widen the persisted execution CLI constraint to
`codex | claude | kimi` without changing existing rows, NULL legacy profiles, member order, primary
keys or foreign keys. Migration MUST be transactional, idempotent and pass foreign-key validation.

#### Scenario: Claude model exposes only its own efforts

- **GIVEN** a member profile editor selects Claude Code
- **THEN** its compatibility default is `sonnet/high`
- **WHEN** the user selects `fable`
- **THEN** effort offers low, medium, high, xhigh and max
- **WHEN** the user selects `sonnet`
- **THEN** effort offers low, medium, high and max but not xhigh
- **WHEN** the user selects `opus`
- **THEN** effort also offers low, medium, high and max but not xhigh
- **AND** neither action starts Claude Code.

#### Scenario: Existing database widens without changing facts

- **GIVEN** a pre-change database contains Codex, Kimi and NULL legacy member profiles
- **WHEN** desktop applies the Claude schema migration twice
- **THEN** each original row and relationship remains unchanged
- **AND** a new Claude profile can be persisted
- **AND** foreign-key validation succeeds.

### Requirement: AI 建队使用并冻结当前可用 CLI

Source: docs/product/pages/onboarding.md#第-2-步-ai-建队子流程
Acceptance: onboarding#20

AI 建队创建 draft 时 MUST 按 `Codex → Kimi → Claude Code` 选择第一套 ready CLI，
保持已有 Codex/Kimi 顺序不变。三者都不 ready 时 MUST 拒绝启动。选定 CLI、
execution profile、隔离 cwd 与 provider session MUST 在 draft 生命周期内冻结。
draft 第一次执行 MAY 创建 Codex
thread、Claude Code session 或 Kimi session；取得 external ID 后，submit、adjust、
retry、恢复与唯一一次结构 repair MUST 只 resume 该 ID。失败 MUST NOT 跨 CLI。

#### Scenario: Claude-only AI 建队

- **GIVEN** 只有 Claude Code ready
- **WHEN** 用户打开 AI 建队
- **THEN** draft 冻结 Claude profile 与独立 session identity
- **AND** 后续轮次只 resume 同一 Claude session。

#### Scenario: Codex 保持第一优先

- **GIVEN** 三套 CLI 都 ready
- **WHEN** 用户创建 draft
- **THEN** draft 选择 Codex

#### Scenario: Kimi 保持在 Claude 之前

- **GIVEN** Codex 不 ready 且 Kimi、Claude Code 都 ready
- **WHEN** 用户创建 draft
- **THEN** draft 选择 Kimi。

### Requirement: AI 建队执行环境保持隔离只读

Source: docs/product/pages/onboarding.md#AI-建队技术约束
Acceptance: onboarding#20

系统 MUST 为每个草稿使用固定 developer instructions、output schema、只读文件系统
边界、隔离 cwd、2 分钟 idle timeout 与 10 分钟 max-duration timeout。Codex MUST
声明只读 sandbox；Kimi ACP MUST 不宣告写能力；Claude MUST 使用 `--safe-mode`、
结构化 schema、`dontAsk`、`--tools Read,Glob,Grep`、`--strict-mcp-config` 与
`--disable-slash-commands`，并应用普通 Claude 运行相同的内部 Agent/team deny 与环境
清理。Claude builder MUST NOT 读取 `CLAUDE.md`、settings、hooks、MCP、skills、
plugins、custom commands、custom agents 或项目 `AGENTS.md`。三套驱动 MUST NOT 使用
普通 Agent 的放权参数。

#### Scenario: Claude 建队不能写入

- **GIVEN** AI 建队 draft 已冻结 Claude
- **WHEN** Claude 输出生成方案并尝试调用写工具或内部 Agent
- **THEN** 工具策略拒绝该调用
- **AND** 应用状态与团队目录保持不变
- **AND** 失败不改用 Codex 或 Kimi。

### Requirement: 引导环境检查验证 Codex、Claude Code 与 Kimi 真实就绪

Source: docs/product/pages/onboarding.md#第-1-步-环境就绪至少一个-cli-可用
Acceptance ID: `onboarding#3`, `onboarding#4`

桌面引导 MUST 分别检查 Codex、Claude Code 与 Kimi 的真实版本和各自只读 readiness。
Codex/Kimi MUST 沿用登录/provider 与真实模型能力检查；Claude MUST 在版本检查后执行
`claude auth status --json`，MUST NOT 发送推理请求或动态枚举模型。只有版本和对应
能力检查都成功的 CLI 才为 ready；任一 CLI ready 时 MUST 放行，三者都不 ready 时
MUST 阻断。

Codex 最低版本 MUST 继续为 `0.145.0`；Claude Code 最低版本 MUST 为 `2.1.170`。低于
最低版本或无法解析版本时 MUST NOT 启动后续能力探针，并 MUST 返回真实版本与稳定升级
原因。每套 CLI MUST 独立维护 revision；较旧 revision 不得覆盖较新结果。DTO MUST
NOT 包含 stderr、异常文本、本地路径、PID、provider 密钥、token 或 session id。
Claude 低版本结果 MUST 同时提供结构化、受信任的 `update-claude` action。

Kimi readiness MUST 与 local runtime 共用同一个 PATH-first/default-location executable
resolver。PATH 的首个现有 candidate MUST 为权威候选；PATH 完全没有 candidate 时才可
检查 host home 下的 `~/.kimi-code/bin/kimi`。权威候选不可执行时 MUST unavailable 且
不得 fallback。`--version` 与后续 `provider list --json` MUST 都 spawn 同一解析出的
absolute path，capability probe MUST NOT 退回命令名 `kimi` 或重新选择 executable。

#### Scenario: GUI PATH 缺少 Kimi 但默认位置存在

- **GIVEN** Electron GUI PATH 不含 `kimi`
- **AND** host `~/.kimi-code/bin/kimi` 是可执行普通文件
- **WHEN** onboarding 检查 Kimi
- **THEN** version 与 provider list 都调用该 absolute path
- **AND** 成功结果可使 Kimi 行 ready、团队兼容提示消失并参与 AI 建队选择。

#### Scenario: PATH 权威候选不可执行

- **GIVEN** PATH 首个现有 Kimi candidate 不可执行
- **AND** 默认位置另有可执行 Kimi
- **WHEN** onboarding 检查 Kimi
- **THEN** Kimi 行 unavailable
- **AND** 默认位置、版本探针与 provider probe 均不启动。

#### Scenario: Claude 已安装但未登录

- **GIVEN** `claude --version` 返回受支持版本
- **AND** `claude auth status --json` 表示未登录并退出 1
- **WHEN** readiness 收敛
- **THEN** Claude 行是 needs-login 且保留真实版本
- **AND** 不创建 Claude session 或发送推理。

#### Scenario: Claude 版本过旧

- **GIVEN** Claude Code 版本低于 `2.1.170`
- **WHEN** readiness 检查运行
- **THEN** Claude 行显示最低版本升级原因
- **AND** 提供受信任的更新动作
- **AND** auth probe 调用次数为零。

#### Scenario: Claude-only 放行

- **GIVEN** Codex 与 Kimi 都不 ready 且 Claude 版本和认证检查成功
- **WHEN** 三 CLI 检查收敛
- **THEN** 第 1 步允许继续
- **AND** Codex 与 Kimi 保留各自独立修复状态。

### Requirement: 引导安装仅执行内置受信任动作

Source: docs/product/pages/onboarding.md#第-1-步-cli-缺失与安装中

主进程 MUST 以随应用发布的 registry 执行 Codex、Claude Code 或 Kimi 安装。renderer
MUST 只能提交 `codex | claude | kimi`，MUST NOT 提交或影响 command、URL、args 或脚本。
Codex MUST 参数化 spawn npm；Claude 和 Kimi MUST 各以独立 curl 与 bash 进程通过
Node stream 连接。所有进程 MUST 使用 `shell:false`，MUST NOT 使用 `exec`、
`execSync`、`bash -c` 或拼接外部输入。

同一 CLI MUST 去重，三套 CLI MUST 可并发。成功 MUST 只复检对应 CLI；失败、取消、
超时 MUST 保留独立重试，且所有状态和错误保持脱敏。

#### Scenario: Claude 安装管道

- **GIVEN** 用户启动 Claude Code 安装
- **WHEN** 主进程创建安装任务
- **THEN** curl 只请求固定 `https://claude.ai/install.sh`
- **AND** curl 与 bash 分别以参数数组和 `shell:false` 启动
- **AND** 下载内容只通过 Node stream 输入 bash stdin。

#### Scenario: 三套安装并发

- **GIVEN** 三套 CLI 都 missing
- **WHEN** 用户依次启动三套安装
- **THEN** 主进程存在三个独立任务
- **AND** 再次启动任一运行中的 CLI 不会创建重复进程。

### Requirement: Claude 更新仅执行权威 executable 的受信任动作

Source: docs/product/pages/onboarding.md#第-1-步-cli-已安装但未就绪
Acceptance ID: `onboarding#4`

Claude Code 版本低于 `2.1.170` 时，renderer MUST 只能请求结构化 `update-claude`
action，MUST NOT 提交或影响 executable path、command 或 args。主进程 MUST 使用本次
readiness 或 runtime gate 已解析并仅在 backend 保存的权威 Claude 绝对路径，以
`spawn(absoluteClaude, ["update"], {shell:false})` 执行更新。完成后 MUST 只重新检查
Claude；失败、取消或超时 MUST 保留旧版本、脱敏原因和独立重试入口。

#### Scenario: Claude 旧版本安全更新

- **GIVEN** readiness 从权威绝对路径解析出 Claude Code `2.1.169`
- **WHEN** 用户触发「更新 Claude Code」
- **THEN** 主进程只对该路径执行参数数组 `["update"]`
- **AND** renderer 提交的数据不能改变 path 或 args
- **AND** 成功后只复检 Claude。

### Requirement: 引导后台安装受退出协调

Source: docs/product/pages/onboarding.md#操作与反馈

安装 MUST 在用户离开第 1 步后继续，并通过安全 snapshot subscription 提供 1–3 项聚合
状态。应用关闭且仍有任务运行时 MUST 阻止本次退出，逐项列出任务并允许留在应用或取消
全部后退出。取消退出 MUST 等待所有已启动子进程实际 close；无法确认回收时 MUST 保持
应用打开并显示脱敏原因。

#### Scenario: 取消三套安装并退出

- **GIVEN** Codex、Claude Code 与 Kimi 安装都在运行
- **WHEN** 用户选择取消全部并退出
- **THEN** 主进程等待三项任务和所有管道子进程实际关闭
- **AND** 确认回收后才退出
- **AND** 不遗留孤儿进程。

## RENAMED Requirements

- FROM: `### Requirement: 引导环境检查验证 Codex 与 Kimi 真实就绪`
  TO: `### Requirement: 引导环境检查验证 Codex、Claude Code 与 Kimi 真实就绪`
