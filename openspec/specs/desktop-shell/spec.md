# desktop-shell 规格

## 域定位
`desktop-shell` 负责把 local console 装配成一个纯本地桌面应用（Electron 壳）：启动应用即启动当前全部功能，并按冻结的执行配置调用本机 Codex、Claude Code 或 Kimi CLI。壳层只做装配、环境自检与更新提示，不承载任何业务规则；本地操作台呈现事实源在 `local-console`。终端形态（`pnpm start`）继续有效且行为不变。

## 业务规则

### Team record location independent of team id

- MUST record a user team's on-disk location as a value distinguishable between a managed directory under `<dataRoot>/teams/` and an arbitrary absolute path outside it.
- MUST keep the team id stable across relocation, and MUST NOT derive a user team's directory from its id.
- MUST resolve every user-team path — member reads and writes, file-manager reveal, and external-change detection — through the recorded location.
- MUST continue resolving built-in teams by id under `.system/`, since built-in teams cannot be relocated.
- MUST read records written by the previous document version as managed directories, without user intervention.
- MUST NOT cache member display names or descriptions in the team record, including for the needs-repair state.
- MUST retain the team name and one-line description in the record so a team whose directory is unavailable remains identifiable.

#### Scenario: Relocated team stays reachable

- **GIVEN** a user team has been relocated to a directory outside `<dataRoot>/teams/`
- **WHEN** the user reveals that team in the file manager, and the app checks one of its members for external modification
- **THEN** both operations resolve to the relocated directory
- **AND** neither falls back to a path derived from the team id.

#### Scenario: Records from the previous version keep working

- **GIVEN** a team record was written before this change and stores only a directory name
- **WHEN** the app loads team records
- **THEN** the record resolves to that directory under `<dataRoot>/teams/`
- **AND** the team's id, name, and description are unchanged.

#### Scenario: Unavailable team is identifiable without a cached roster

- **GIVEN** a recorded user team whose directory is unreadable
- **WHEN** the team list renders that team
- **THEN** its name and description come from the record
- **AND** no member name or member count is shown.

### Session-scoped agent roster injection

- MUST inject, when starting the local console server, a roster resolver that answers with the agent set applicable to a given session.
- MUST resolve that set from the members of the team bound to the session, using the recorded team location.
- MUST fall back to the shared `<dataRoot>/agents/` directory when the session has no bound team.
- MUST fail with an explicit error, rather than an empty roster, when the bound team needs repair.
- MUST NOT move knowledge of the `teams/` layout into the local console server itself.

#### Scenario: Bound session sees only its team

- **GIVEN** a session is bound to a team with three members
- **WHEN** the runtime resolves the agents available to that session
- **THEN** the result is exactly those three members
- **AND** agents present only in the shared `agents/` directory are absent.

#### Scenario: Broken team is reported, not silently empty

- **GIVEN** a session is bound to a team that needs repair
- **WHEN** the runtime resolves the agents available to that session
- **THEN** an explicit error identifies the team as needing repair
- **AND** the failure is not presented as the session having no agents.

### 启动与退出
- MUST 启动应用即依次完成：数据根解析 → 按规范化有效数据根准备实例作用域并取得单实例锁 → 打开操作台主窗口 → PATH 修复 → 首启种子拷贝 → 环境自检 → 启动 main 进程拥有的 local console server。
- MUST 按规范化有效数据根持有单实例锁：相同数据根的第二个应用实例启动时激活已有窗口后退出，不同数据根的实例可以并存；NEVER 让相同数据根的两个实例同时启动 local console server 或并发写 `.state/`。
- MUST 在种子拷贝失败时不启动 local console server，并把失败原因呈现在状态页；NEVER 让服务在缺失 `config.toml` 的数据根上静默启动失败。
- MUST 在关闭主窗口时有界关闭 local console server 及仍在运行的 local provider / SQLite worker 资源，然后退出应用；NEVER 留下孤儿子进程。

#### Scenario: 安装态与默认开发态并存
- **GIVEN** 默认数据根为 `~/.moebius` 的安装态实例正在运行
- **WHEN** 用户在仓库中以默认开发态启动桌面应用
- **THEN** 开发态使用仓库根对应的独立实例作用域并打开自己的主窗口
- **AND** 安装态实例继续运行。

#### Scenario: 同一数据根的重复实例退出
- **GIVEN** 一个实例已经持有规范化数据根 A 的实例作用域
- **WHEN** 第二个实例以可规范化为同一数据根 A 的路径启动
- **THEN** 第二个实例激活已有窗口后退出
- **AND** 不启动第二套 local console server 或 `.state` 写者。

#### Scenario: 跨运行形态显式共享数据根
- **GIVEN** 安装态与开发态都通过 `MOEBIUS_DATA_ROOT` 显式指向同一规范化数据根
- **WHEN** 两者先后启动
- **THEN** 两者竞争同一实例作用域
- **AND** 只有先取得锁的实例继续启动。

### 数据根
- MUST 打包态数据根默认为 `~/.moebius`，开发态默认为仓库根；`MOEBIUS_DATA_ROOT` 环境变量为最高优先级覆盖。
- MUST 让打包态默认数据根继续使用既有 Electron `userData`，避免迁移已有 Chromium 配置与缓存；其他规范化数据根 MUST 稳定派生各自独立的 Electron `userData` 实例作用域。
- MUST 把 local console server 的工作目录设为数据根，使 `.state/` 等相对路径状态文件落在数据根下。
- MUST 让 `WORKDIR_ROOT` 默认派生自数据根（`<数据根>/workdir`），NEVER 以应用包或源码目录为基准。防止 workdir 落在应用包 / 源码附近 MUST 由该默认值本身保证，NEVER 依赖各入口逐个注入环境变量；`MOEBIUS_WORKDIR_ROOT` 仅作显式覆盖（如放到独立磁盘）。
- MUST 首启把 `agents/`（含 `ceo-scripts/`）与示例 `config.toml` 种子拷贝到数据根；已存在的文件 NEVER 覆盖。
- MUST 保持 `src/config.ts` 在未设置数据根环境变量时行为与终端形态完全一致，且此时 `WORKDIR_ROOT` 落在（作为数据根的）仓库根下。

### 操作台主窗口
- MUST load the desktop operator console as the default BrowserWindow content after application boot.
- MUST use an integrated hidden-inset titlebar for the macOS main window so traffic-light controls visually belong to the console rail.
- MUST provide a safe renderer drag region for the integrated main window while keeping interactive controls usable.
- MUST NOT make the operator console's generic error surface promise or provide a status-diagnostics/log action.
- MUST expose the local console server URL or equivalent local API capability to the renderer through preload, not through global Node integration.
- MUST explicitly keep the Chromium sandbox and context isolation enabled and node integration disabled for renderer windows.
- MUST keep the status page available as an auxiliary diagnostic window.
- MUST expose a narrow preload IPC that opens the native directory picker and returns only the selected folder path or null to the renderer.
- MUST NOT write project rows, edit configuration, or start Codex inside the folder picker IPC.
- MUST let the renderer persist the selected folder as a project through the loopback local console API rather than direct filesystem or SQLite access.

### Sandboxed preload dependency boundary

- MUST keep runtime IPC channels and renderer-visible DTOs in side-effect-free contract modules that do not import Node-only services at runtime.
- MUST let preload and renderer code depend on those contracts, while Electron main-process IPC adapters remain the only layer that imports filesystem, process-spawning, configuration, or Codex services.
- MUST build the preload against a browser-compatible module boundary and keep `electron` as its only runtime external module.
- MUST fail the desktop build when the generated preload contains any static `require()` target other than `electron`.

#### Scenario: Main-process implementation cannot leak into preload

- **GIVEN** an IPC adapter imports `node:path`, `node:fs`, `node:crypto`, or a Codex service
- **WHEN** preload needs the adapter's channel name or DTO
- **THEN** preload imports the corresponding pure contract instead of the adapter
- **AND** the generated preload contains no adapter, filesystem, configuration, or Codex implementation.

#### Scenario: Unsupported preload module fails before startup

- **GIVEN** a source change introduces a Node-only runtime import into the preload dependency graph
- **WHEN** the desktop build bundles and validates the preload
- **THEN** the build fails before Electron startup
- **AND** the invalid preload artifact is not accepted as sandbox-compatible.

### local console server ownership
- MUST ensure desktop mode starts exactly one local console server for the operator console.
- SHOULD let the Electron main process own the local console server lifecycle so renderer reloads do not destroy active local runs.
- MUST close the local console server during desktop shutdown together with any live local provider and SQLite worker resources.

### 环境自检与 PATH
- MUST 在 macOS 桌面主进程内按“继承 PATH 在前、登录 shell PATH 只补充缺失项”的稳定顺序修复 PATH，过滤空项并按首次出现去重，使终端启动时当前环境选择的可执行文件优先；继承 PATH 为 `undefined` 或空字符串时 MUST 使用登录 shell PATH，登录 shell 返回空 PATH、非零退出或探测抛错时 MUST 保底沿用原继承 PATH。

#### Scenario: 终端启动保留当前 Codex 选择
- **GIVEN** 启动桌面开发态的终端继承 PATH 与登录 shell PATH 分别优先解析到不同的 Codex 可执行文件
- **WHEN** 桌面主进程完成 PATH 修复
- **THEN** 最终 PATH 仍优先解析到终端继承 PATH 选择的 Codex
- **AND** 登录 shell 中未出现于继承 PATH 的目录按原顺序追加。

#### Scenario: Finder 类环境补充登录 PATH
- **GIVEN** 桌面主进程没有继承 PATH 或继承 PATH 为空
- **WHEN** 登录 shell 成功返回非空 PATH
- **THEN** 最终 PATH 使用过滤空项并按首次出现去重后的登录 shell PATH。

#### Scenario: 登录 shell 探测失败
- **GIVEN** 桌面主进程已有继承 PATH
- **WHEN** 登录 shell 返回空 PATH、非零退出或探测抛错
- **THEN** 最终 PATH 保留原继承 PATH
- **AND** 不引入登录 shell 返回的任何目录。

### 更新
- MUST 让正式 macOS 应用通过 GitHub Releases 检查版本，在设置弹窗原地显示结果，并只在用户显式点击后打开 Apple Silicon Release 下载页。
- MUST 把版本比较、15 秒超时、结果分类与下载页决策保持为纯逻辑模块。

### 架构约束
- MUST 把壳层业务逻辑（数据根解析、种子拷贝计划、自检解析、更新分支）拆为不依赖 Electron 运行时的纯模块并配单元测试；装配层 NEVER 承载业务规则。
- MUST 限定 preload IPC 为窄口：状态快照推送、local console URL、打开诊断状态页、打开数据目录，以及设置专用的应用信息读取、检查更新与固定版本复制；NEVER 暴露配置写接口。
- MUST NOT 把 local console 的行为规则复制进本域；本域只引用它的编程入口（`start()`）。

## 退役 GitHub runner 后的装配约束

### Requirement: Desktop 只装配本地运行形态
Source: docs/product/prd.md#产品运行形态

Desktop MUST 由 main process 持有 exactly one local console server，MUST NOT 派生 GitHub runner child、
启动 observer server 或监管这些已退役进程。关闭应用 MUST 有界关闭 local server 与仍在运行的 local
provider/SQLite worker 资源，且 MUST NOT 留下孤儿进程。

#### Scenario: Desktop 启动

- **GIVEN** 用户启动 Desktop
- **WHEN** 主窗口完成初始化
- **THEN** local console 可用且主页面能读取 local 状态
- **AND** 进程树没有 `runner-child.js` 或 observer server

### Requirement: 辅助状态面只呈现仍存在的能力
Source: docs/product/prd.md#产品运行形态

Desktop status snapshot、preload 与辅助状态页 MUST 继续呈现 local console、环境、数据根、seed、版本
和更新事实，MUST NOT 暴露 runner/observer 状态字段、打开 observer 动作或对应占位 UI。

#### Scenario: 壳层调用辅助状态页能力

- **GIVEN** Desktop 的 local console 正常运行
- **WHEN** Desktop 壳层调用辅助状态页窗口能力
- **THEN** 页面显示 local 与环境诊断
- **AND** 页面不存在 GitHub runner、observer 或“打开观察页”动作

### Requirement: 退役运行形态不得破坏历史数据
Source: docs/product/prd.md#产品运行形态

Desktop 与终端 local 入口 MUST NOT 为退役 GitHub runner 执行 destructive migration 或自动删除历史
GitHub state。启动与退出过程中，未被 local runtime 使用的旧 GitHub state 文件/表 MUST 保持原内容。

#### Scenario: 带历史状态启动

- **GIVEN** 临时数据根包含代表性旧 GitHub state 文件或表
- **WHEN** Desktop 启动并退出
- **THEN** local console 可用
- **AND** 旧 GitHub state 的内容哈希或表行数保持不变

## 场景

### 场景 DS.T4.1：主窗口默认是操作台
Given the desktop app has finished booting
When the main BrowserWindow finishes loading
Then it displays the local operator console
And the status diagnostics capability remains available as a separate auxiliary window; the main operator console does not expose a generic error-to-diagnostics action.

### 场景 DS.T4.2：桌面形态只有一个 local console server
Given desktop main process starts a local console server
When the operator console renderer loads
Then no second local console server is started
And the renderer uses the main process provided local console URL.

### 场景 DS.T4.3：renderer 安全边界保持
Given the operator console renderer is loaded
When it needs to submit messages, interrupt runs, or read state
Then it uses preload-exposed APIs or loopback HTTP endpoints
And it does not enable Node integration.

### 场景 DS.T4.4：macOS 主窗口集成标题栏
Given the desktop application runs on macOS
When the main BrowserWindow is created
Then it uses the hidden inset titlebar treatment with traffic-light controls positioned over the console rail
And the renderer provides a safe draggable region without covering interactive controls.

### 场景 DS.T4.6：打开文件夹入口只返回路径
Given the desktop operator console is loaded
When the user chooses the open-project action
Then the Electron main process opens a native directory picker
And preload returns the selected folder path to the renderer
And the IPC does not write SQLite or configuration state by itself.

### 场景 DS.T4.7：renderer 仍走安全边界
Given the renderer has received a selected folder path
When it creates or updates a local project
Then it calls the loopback local console API
And it does not use Node integration or direct filesystem access.

## Agent 团队存储

本节规则从 `console-ui` 迁入：磁盘布局、内置团队播种与结构有效性判定属于壳层数据责任，`console-ui` 只消费这里给出的状态与可用性。

### Requirement: Team storage layout and write ownership

Source: docs/product/pages/agent-teams.md#官方来源团队详情

- MUST store teams under `<dataRoot>/teams/`, with official-source teams under the reserved
  `.system/` subtree and user teams as recorded siblings or relocated directories.
- MUST give official-source and user teams the same editable content shape: `team.json` plus
  `members/<slug>/AGENT.md` and allowed related member files.
- MUST store only team core in `team.json`; member identity remains owned by `AGENT.md`.
- MUST allow team core, primary agent, members and member files under `.system/` to be edited
  through the same validated store operations used for user teams.
- MUST keep the official source id stable and MUST reject deleting, trashing or converting an
  official-source team.
- MUST store execution bindings, official baseline metadata and Agent Markdown revisions outside
  the team content directory.
- MUST NOT convert an official-source team into a user team because its content changed.

#### Scenario: Official content is editable but source identity is protected

- **GIVEN** an official-source team exists under `.system/development`
- **WHEN** the user changes its description, primary agent and one member `AGENT.md`
- **THEN** all three validated writes succeed
- **AND** the team remains official source `development`
- **AND** a request to trash that team is rejected below the UI.

#### Scenario: Revision history stays out of the Finder-visible team folder

- **GIVEN** a member's `AGENT.md` has three saved revisions
- **WHEN** the user opens the team folder in Finder
- **THEN** only the current `AGENT.md` content is visible
- **AND** no revision history file or directory appears inside the team folder.

### Requirement: Team core and onboarding orchestration are independent

- MUST store only the team name, one-line description, primary agent slug, and member order in `team.json`.
- MUST store the optional first-run relay example in a versioned `onboarding-orchestration.json` beside `team.json`.
- MUST NOT include onboarding orchestration in team health, application record snapshots, new identity fingerprints, session rosters, runtime prompts, or primary-agent scheduling.
- MUST return onboarding orchestration as an independent `ready | missing | invalid` read result.
- MUST keep a structurally usable team available for real conversations when orchestration is missing or invalid.
- MUST let AI team creation write and reread core definition, independent orchestration, and every member file in the same staging directory before registration.

#### Scenario: A pre-relay team starts normally

- **GIVEN** an existing team's `team.json` and cached record do not contain `relayBeats`
- **WHEN** the desktop starts and lists teams
- **THEN** the team is evaluated from its core definition and member files
- **AND** `agent-teams:list` succeeds
- **AND** a usable team can still create a real conversation.

#### Scenario: Invalid orchestration is locally unavailable

- **GIVEN** a usable team whose `onboarding-orchestration.json` is malformed or references a non-member slug
- **WHEN** the desktop reads the team and runtime roster
- **THEN** the team remains usable
- **AND** orchestration returns `invalid`
- **AND** no orchestration content enters the roster or prompt.

### Requirement: Embedded relay compatibility is bounded

- MUST tolerate recent manifests and cached definitions that contain an embedded `relayBeats` field without treating it as team core.
- MAY use a valid embedded value as transitional onboarding input only when the independent file is absent.
- MUST preserve valid embedded relay data into `onboarding-orchestration.json` before a safe user-team definition write removes the embedded field.
- MUST ignore missing or invalid embedded relay data for team health.
- MUST calculate new identity fingerprints from only core `team.json` and ordered member `AGENT.md` files.
- MUST accept the previous relay-inclusive fingerprint algorithm only for relocating a record that still carries valid legacy relay data, then MUST write the new core fingerprint.

#### Scenario: Legacy relay data is migrated on a safe write

- **GIVEN** a user team's `team.json` contains valid embedded relay beats and has no independent orchestration file
- **WHEN** the app saves core team information
- **THEN** it first writes `onboarding-orchestration.json`
- **AND** then writes a core-only `team.json`
- **AND** a failed step does not remove the still-readable legacy source.

#### Scenario: Relay-only changes do not change identity

- **GIVEN** a team's core definition and member files are unchanged
- **WHEN** its onboarding orchestration changes or is removed
- **THEN** its new identity fingerprint is unchanged
- **AND** its bound-session roster and primary agent are unchanged.

### Requirement: Agent identity metadata in frontmatter

- Team member `AGENT.md` files MUST store new display identities in leading YAML frontmatter fields `display_name` and `description`.
- `display_name` and `description` MUST be non-empty single-line strings and MUST be treated as one atomic identity pair.
- The member directory name MUST remain the only source of the stable slug; frontmatter MUST NOT duplicate a `name` or slug field.
- The team list row, member selector, current Agent heading, and mention completion MUST prefer the canonical frontmatter identity over persona headings or paragraphs, and MUST NOT cache a separate member summary that can drift from `AGENT.md`.
- When both canonical identity fields are absent, the desktop MUST preserve legacy compatibility by reading the first level-one persona heading and its first eligible paragraph.
- When only one canonical identity field exists, YAML is invalid, or either canonical value is invalid, the desktop MUST mark the team as needing repair with a visible metadata issue and MUST NOT silently combine canonical and legacy identity sources.
- New member creation MUST emit canonical snake_case identity frontmatter.
- Existing legacy user-team files MUST NOT be rewritten merely because they were read or listed.

#### Scenario: Persona heading does not replace the display name

- **GIVEN** a member `AGENT.md` declares `display_name: 开发经理` and `description: 负责技术决策、架构选型与质量保证。`
- **AND** its persona body begins with `# 角色`
- **WHEN** the built-in team and member identity render
- **THEN** the visible member name is `开发经理`
- **AND** the visible description is the frontmatter description
- **AND** `角色` remains persona content only.

#### Scenario: Legacy identity remains readable

- **GIVEN** an existing user-team member has no `display_name` or `description` frontmatter
- **AND** its persona body begins with `# 开发经理` followed by `默认接单并组织团队推进`
- **WHEN** the team is loaded after the upgrade
- **THEN** the member remains usable with that legacy display name and description
- **AND** the file is not rewritten automatically.

#### Scenario: Partial canonical identity is repairable, not silently mixed

- **GIVEN** a member frontmatter contains `display_name` but omits `description`
- **AND** the persona body contains a legacy description paragraph
- **WHEN** the team is loaded
- **THEN** the team is marked as needing repair for invalid Agent metadata
- **AND** the desktop does not combine the frontmatter name with the legacy paragraph.

### Requirement: Built-in team seeding by content fingerprint

Source: docs/product/pages/agent-teams.md#更新官方来源团队
Source: docs/product/pages/agent-teams.md#官方版本与三方比较

- MUST package official team content and a versioned recommendation manifest in `seed/teams`.
- MUST register packaged content as the latest official version C without overwriting an existing
  editable `.system` team B.
- MUST create B and a verified applied baseline A from C only when that official team has never
  been installed.
- MUST migrate a legacy fingerprint-only applied baseline to a content-bearing baseline exactly
  once: when the current editable content B's fingerprint equals the legacy applied fingerprint,
  MUST back-fill A's content snapshot from B's current content and MUST mark `baselineConfidence`
  as `verified`; when the fingerprints differ, MUST mark `baselineConfidence` as `conservative`
  without inventing A's content, and MUST record one `user`-authored Agent Markdown revision
  capturing B's content at migration time so the member's revision timeline has a starting point.
- MUST NOT use a package fingerprint mismatch as authority to replace `.system`.
- MUST keep user team directories byte-identical while registering or applying official updates,
  except for an explicitly requested protective copy.
- MUST leave the migration's `conservative` outcome untouched by this requirement — no merge, no
  one-time merge entry point and no baseline reconstruction are performed as part of migration;
  those remain out of scope until a future auto-sync capability defines them.

#### Scenario: Upgrade registers rather than applies

- **GIVEN** the current official-source team has local edits
- **WHEN** a new application version carries different official content
- **THEN** startup leaves the current team unchanged
- **AND** the team reports an available official update
- **AND** applying the packaged version still requires an explicit team-page action.

#### Scenario: Clean legacy baseline is back-filled as verified

- **GIVEN** a legacy applied baseline stores only a fingerprint
- **AND** the current editable content's fingerprint equals that legacy fingerprint
- **WHEN** the desktop migrates the applied baseline to the content-bearing structure
- **THEN** the applied baseline's content snapshot is back-filled from the current editable content
- **AND** `baselineConfidence` becomes `verified`
- **AND** no revision is created solely for this migration step.

#### Scenario: Customized legacy baseline becomes conservative with a revision starting point

- **GIVEN** a legacy applied baseline stores only a fingerprint
- **AND** the current editable content's fingerprint differs from that legacy fingerprint
- **WHEN** the desktop migrates the applied baseline to the content-bearing structure
- **THEN** `baselineConfidence` becomes `conservative` and no fabricated content is stored for A
- **AND** exactly one `user`-authored revision is created capturing the current editable content
- **AND** no merge of any kind is performed as part of this migration.

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

### Requirement: Environment capability probing remains outside team management

Source: docs/product/pages/agent-teams.md#Agent-运行配置
Source: docs/product/pages/agent-teams.md#非目标
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

Execution capability probing MAY serve onboarding, AI team building or an explicit runtime
diagnostics surface. The Agent Teams list/detail and profile mutation IPC MUST NOT expose capability
snapshots, refresh actions, unable-to-verify state or needs-adjustment state. Removing team-management
probing MUST NOT weaken onboarding's existing readiness, installation, revision or redaction contract.
The normal operator console MUST NOT start Codex/Claude/Kimi readiness checks on mount, shell-ready, team
navigation or message submission. It MUST NOT consume onboarding readiness for new-conversation member
preparation or compatibility presentation. It MUST preserve onboarding's post-install recheck while an
installation initiated there is still completing.

#### Scenario: Opening a team while all CLIs are missing

- **GIVEN** neither Codex, Claude nor Kimi can be resolved on PATH
- **WHEN** the user opens a valid team and switches between members
- **THEN** every saved static profile remains readable and editable
- **AND** team management exposes no runtime-health state
- **AND** onboarding readiness behavior is unchanged.

#### Scenario: Opening the normal console does not expose readiness

- **GIVEN** onboarding is not active and readiness is checking, ready, missing, needs-login or unavailable
- **WHEN** the normal operator console mounts, receives shell-ready, opens Agent Teams and enters new conversation
- **THEN** no Codex, Claude or Kimi readiness check is started for normal-console presentation
- **AND** no readiness snapshot drives member preparation or compatibility copy in new conversation.

#### Scenario: Onboarding installation finishes after entering the console

- **GIVEN** onboarding started a CLI installation and the user entered the normal console while it was running
- **WHEN** that installation succeeds
- **THEN** the shell rechecks only the installed CLI according to the onboarding contract
- **AND** the result is not projected into a new-conversation preparation hint.

### Requirement: Official three-way state is derived from A, B and C

Source: docs/product/pages/agent-teams.md#官方版本与三方比较

The desktop MUST compare the applied official baseline A, current editable content B and packaged
latest official version C. The applied baseline A MUST be stored as a complete content snapshot
alongside its fingerprint, not the fingerprint alone; a comparison that requires A's content but
finds only a legacy fingerprint-only record MUST resolve through the migration path below before
comparison proceeds. Team content fingerprints MUST include core/member content and MUST
exclude onboarding orchestration, official manifests, execution profiles, caches and internal
metadata. Protection for removed/renamed overridden members and user-member slug collisions MUST
take priority over a `B == C` fast path.

#### Scenario: Equal content still needs protection

- **GIVEN** B content equals C content
- **AND** C removes a member whose saved source is user override
- **WHEN** the update state is derived
- **THEN** the primary action is protective-copy-and-update
- **AND** the equal-content registration path is not offered.

### Requirement: Official update is explicit, planned and failure-safe

Source: docs/product/pages/agent-teams.md#更新官方来源团队

The desktop MUST show current/latest versions, member changes, recommendation changes and protected
bindings before update. It MUST revalidate an immutable update plan immediately before commit.
When protection is required it MUST create a valid user-team copy with explicit saved profiles
before making the official latest state visible. Failure or retry MUST leave either the complete old
state or the complete copy-plus-latest state, without visible partial copies or duplicate copies.

#### Scenario: Diverged content is preserved before update

- **GIVEN** B differs from A and C
- **WHEN** the user confirms protective-copy-and-update
- **THEN** a user team preserves B and every saved member profile as explicit
- **AND** the official team becomes C with same-slug overrides preserved and recommendations
  migrated
- **AND** the copy has no official update identity.

#### Scenario: Stale update plan is rejected

- **GIVEN** an update plan was prepared from a specific A/B/C state
- **AND** a member file changes before commit
- **WHEN** the plan is submitted
- **THEN** the store rejects it as stale
- **AND** neither the official team nor a user copy is changed.

### Requirement: Official member profile migration uses stable slug only

Source: docs/product/pages/agent-teams.md#官方成员与运行配置迁移

Same-slug overrides MUST remain unchanged; same-slug recommended members MUST adopt C's current
recommendation; new official slugs MUST use C's recommendation. Removed or renamed slugs MUST NOT
transfer profiles to another slug. Removing/renaming an overridden member and colliding with a
user-added slug MUST require a protective copy.

#### Scenario: Rename does not steal an override

- **GIVEN** A has overridden member `qa`
- **AND** C removes `qa` and adds `quality`
- **WHEN** the protected update completes
- **THEN** the user copy retains `qa` and its saved profile
- **AND** official `quality` uses C's recommendation
- **AND** `qa`'s profile is not attached to `quality`.

### Requirement: 安装包提供开发与内容生产内置团队

Source: docs/product/pages/agent-teams.md#软件内置团队

安装包 MUST 在 `seeds/teams/` 中提供 `development` 与 `content-production` 两支结构有效的内置团队。`content-production` MUST 由内容生产总控担任主 Agent，并包含证据调研、创作编辑、视觉制作和发布包装成员；其成员身份 MUST 来自各自 `AGENT.md`，首次引导协作示例 MUST 保存在独立 `onboarding-orchestration.json` 中。

#### Scenario: 首次播种内容生产团队

- **GIVEN** 新数据根尚未播种内置团队
- **WHEN** 桌面应用从安装包执行团队播种
- **THEN** `content-production` 团队状态为 usable
- **AND** 主 Agent 是 `content-production-orchestrator`
- **AND** 五名成员身份均可从各自 `AGENT.md` 读取
- **AND** 独立 onboarding 编排只引用当前团队成员。

### Requirement: 反馈驱动工程团队把完整实现收束为可合并检查点

仓库内的 `feedback-driven-engineering` 团队种子 MUST 让明确、已授权且不存在待决策分叉的实现默认从实现者继续进入独立审查，并在不推导 Git 或外部动作授权的前提下形成可复用的 `merge-ready` 检查点。只有用户明确要求草稿、局部试做、先看效果或暂不审查时，主 Agent 才可把当前实现标记为 `provisional-feedback` 并在开发反馈后暂停。检查点 MUST 识别比较基线、适用时的目标分支头、覆盖 tracked 与未跟踪交付文件的变更指纹、审查范围和验证摘要。

后续本地 commit、rebase 或 squash merge MUST 继续要求用户对该 Git 动作的明确授权。若检查点仍覆盖当前变更且目标分支变化不影响已审查范围，主 Agent MUST 复用原结论并只执行必要的 Git 安全检查与获授权动作；若变化只影响部分证据，MUST 只复核受影响半径。Git-only 授权 MUST NOT 被扩张为修改代码、改变产品行为或扩大实现范围的授权。

#### Scenario: 明确实现自动进入独立审查

- **GIVEN** 用户已经授权一个目标明确且没有待决策分叉的实现
- **WHEN** 实现者完成代码和与风险相称的开发反馈
- **THEN** 主 Agent 无需用户再次要求“审查”“收尾”或“继续”就把结果交给独立审查者
- **AND** 审查通过后向用户报告 `merge-ready` 检查点
- **AND** 未获得 Git 动作授权时不创建 commit、不 merge。

#### Scenario: 有效检查点下只执行获授权的 Git 收尾

- **GIVEN** 当前变更和集成影响仍与已通过的 `merge-ready` 检查点一致
- **WHEN** 用户明确要求本地 commit、rebase 或 squash merge
- **THEN** 主 Agent 不重新启动代码审查或机械重跑测试
- **AND** 只执行必要的 Git 安全检查和用户授权的 Git 动作。

#### Scenario: Git 收尾不能隐式重开实现

- **GIVEN** Git 收尾前的检查发现基线或工作树变化使检查点部分或全部失效
- **WHEN** 恢复有效检查点需要修改代码、扩大范围或重新决定产品行为
- **THEN** 主 Agent 报告失效原因和影响范围
- **AND** 不从 Git-only 授权推导新一轮实现授权。

### Requirement: Team structural readiness

- MUST treat a team as usable for creating a new conversation only when it has exactly one primary agent, that primary agent is a current member, every member has a team-unique slug, and every member's `AGENT.md` is readable with a valid canonical or legacy identity.
- MUST treat a team with no primary agent as an unfinished draft, retained on the team list and marked as such.
- MUST treat a team as needing repair when its directory is missing or unreadable, when any member's `AGENT.md` is missing, unreadable, or has invalid identity metadata, when any member lacks a slug, or when two members share a slug.
- MUST allow a single-member team to be usable when it otherwise satisfies the readiness conditions.
- MUST NOT analyze persona semantics beyond the bounded legacy identity fallback when deciding readiness.
- MUST NOT check whether files referenced by `AGENT.md` exist when deciding readiness.
- MUST re-evaluate readiness after files are restored and clear the needs-repair state once all members are valid again.

#### Scenario: Duplicate slug blocks team usage

- **GIVEN** a user team whose two members carry the same slug
- **WHEN** the team list and the new-conversation team selector render
- **THEN** the team is marked as needing repair
- **AND** it cannot be selected for a new conversation.

#### Scenario: Unfinished draft does not count as broken

- **GIVEN** a team draft with no members yet
- **WHEN** the team list renders and the sidebar entry evaluates its indicator
- **THEN** the team is marked unfinished and cannot be used for a new conversation
- **AND** the sidebar entry shows no repair indicator.

### Requirement: Agent Markdown 修订带作者与人话摘要持久化

Source: docs/product/pages/agent-teams.md#编辑与保存-agentmd
Source: docs/product/flows/agent-evolution.md#一本地调教留痕

`AGENT.md` 每次成功保存（团队页保存或被读取到的 Finder 外部有效修改）MUST 落一条修订，MUST 至少包含完整内容、作者种类（`user | official | agent`）、发生时间。Finder 外部修改 MUST 记为 `user` 作者，与团队页内保存等价对待；外部修改检测 MUST 同时覆盖官方来源团队与用户团队（两者都解析各自磁盘位置：官方团队按稳定 id 落在 `.system/`，用户团队走记录位置）。外部修改的修订 MUST 在 `changed` 响应返回给 renderer 之前完成持久化，renderer 在载入外部版本后 MUST 立即刷新该成员的修订历史。修订 MUST 独立存储在团队内容目录之外，MUST NOT 出现在团队文件夹中。修订存储 MUST NOT 设置数量或时间上限。

成员尚无任何修订时，首次保存（或首次被读取到的外部修改）MUST 以写入前的已持久化内容（保存路径为写前磁盘全文，外部修改路径为应用最后已知内容）作为比较基线：段落标记与人话摘要只反映本次实际改动，MUST NOT 把整份文档标成新增。

人话摘要 MUST 由默认 Agent 在保存完成后异步生成，MUST NOT 阻塞保存反馈返回。摘要生成失败或默认 Agent 不可用时，修订 MUST 保留、MUST 用中性状态标记摘要不可用，MUST NOT 编造摘要内容、MUST NOT 阻止后续保存或读取。

#### Scenario: 保存成功立即产生修订，摘要异步补上

- **GIVEN** 用户在团队页修改一名成员的 `AGENT.md` 并点击保存
- **WHEN** 写盘成功
- **THEN** 保存反馈立即返回，且不等待摘要生成
- **AND** 该次保存已经产生一条 `author=user` 的修订，内容为保存后的完整全文
- **AND** 摘要就绪后可以被后续读取到，不需要用户重新保存触发。

#### Scenario: 默认 Agent 不可用时修订仍然成立

- **GIVEN** 默认 Agent 未配置或调用失败
- **WHEN** 一次 `AGENT.md` 保存完成
- **THEN** 修订正常落盘，包含完整内容、作者与时间
- **AND** 摘要状态为不可用，不重试轰炸
- **AND** 没有任何用户内容因为摘要失败而丢失或被覆盖。

#### Scenario: 首次保存以既有内容为基线

- **GIVEN** 一名成员已有持久化 `AGENT.md` 内容且尚无任何修订（如 `verified` 基线团队首次编辑）
- **WHEN** 用户只修改其中一个段落并保存
- **THEN** 该次修订的段落标记只落在实际变化的段落上
- **AND** 摘要不可用时机械摘要（「本次改动涉及 N 处」）的 N 等于实际变化段落数
- **AND** 未变化段落不出现任何变化标记或伪作者。

#### Scenario: Finder 外部修改与团队页保存产生同等修订

- **GIVEN** 用户在 Finder 中直接修改一名成员的 `AGENT.md`（官方来源团队或用户团队均可）
- **WHEN** 应用读取到该有效修改
- **THEN** 产生一条 `author=user` 的修订，与团队页内保存的修订结构一致
- **AND** 该修订在 `changed` 响应返回前已落盘
- **AND** renderer 载入外部版本后立即刷新该成员的历史，无需重新打开成员或再次保存
- **AND** 官方来源身份不因此改变。

#### Scenario: 时间线只有历史版本可回退，回退本身产生新修订

- **GIVEN** 一名成员已有三条修订（最新版、中间版、最早版）
- **WHEN** 用户查看时间线
- **THEN** 最新（当前）版本不提供「回到这一版」入口，中间版与最早版都可回退
- **AND** 点击任一历史版本的「回到这一版」后，正文与磁盘内容回到该版本内容
- **AND** 回退本身产生一条新的 `author=user` 修订，历史修订不被删除或覆盖
- **AND** 直接请求回退到当前版本被拒绝，不产生重复内容的空修订。

#### Scenario: 保存控件附近的摘要状态同步就位

- **GIVEN** 用户刚保存一名成员的 `AGENT.md` 并停留在编辑器底部（保存按钮附近）
- **WHEN** 摘要任务在后台到达终态（`ready` 或 `unavailable`）
- **THEN** 保存按钮附近同一摘要行从 pending 占位自行更新为终态文案
- **AND** 用户无需滚动、切换成员或重新保存即可观察到该更新。

### Requirement: 应用级默认 Agent 配置

Source: docs/product/pages/settings.md#默认-agent

应用 MUST 持久化一份单例的默认 Agent 执行配置（CLI / Provider 引用 / 模型 / 思考程度），MUST 独立于任何团队、任何成员、任何会话。没有已保存选择时 MUST 解析为内置"通用助手"官方推荐组合，MUST NOT 呈现为空白或未设置。保存 MUST 立即生效、MUST NOT 需要重启，MUST NOT 影响任何团队成员的运行配置，MUST NOT 被任何团队成员的运行配置变化回写。

默认 Agent MUST 只服务应用自己发起的后台工作（修订摘要，以及后续官方同步的合并），MUST NOT 绑定任何会话或 run 生命周期，MUST NOT 在会话列表中产生用户未发起的条目。

#### Scenario: 未设置时显示内置推荐而非空白

- **GIVEN** 用户从未保存过默认 Agent 配置
- **WHEN** 设置页读取当前默认 Agent
- **THEN** 返回内置"通用助手"的官方推荐 CLI/model/effort
- **AND** 不返回空值或"未设置"状态。

#### Scenario: 默认 Agent 的调用不产生会话记录

- **GIVEN** 一条 `AGENT.md` 修订触发摘要生成
- **WHEN** 默认 Agent 完成一次单轮调用
- **THEN** 该次调用不创建会话、不出现在会话列表或 run 审计中
- **AND** 调用结果只写回该修订的摘要字段。

## Requirement: #14 桌面运行名单只来自会话团队
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

The desktop main process MUST inject a resolver that loads one complete valid saved team version for a stable ownership/id binding. The version MUST contain core team identity, stable source disambiguation, ordered member identity and Markdown, and each persisted execution profile. The resolver MUST use recorded user-team locations and built-in locations, MUST reject deleted/needs-repair/invalid teams without falling back to shared agents, and MUST NOT move `teams/` layout or profile-store knowledge into local-console. A legacy session without a team binding MUST continue using the registered shared-agent compatibility resolver and MUST NOT be classified as deleted.

The same resolved version MUST serve new-session capture, explicit team switch and update inspection/application. It MUST exclude renderer drafts and onboarding orchestration.

### Scenario: One resolver supplies a complete version

- GIVEN a usable user team at a relocated recorded path
- WHEN local-console requests the saved version for creation or update inspection
- THEN the result contains the recorded core, source identity, ordered members, Markdown and persisted profiles from that path
- AND it contains no unsaved renderer draft or onboarding relay.

### Scenario: Broken team is not a candidate

- GIVEN the bound team has an unreadable member file
- WHEN the resolver is called for update inspection
- THEN it returns the existing needs-repair failure
- AND no partial roster or candidate version is returned.

### Scenario: Unbound legacy session keeps the compatibility roster

- GIVEN a legacy session has no team ownership/id binding
- WHEN desktop resolves its runtime roster
- THEN it uses the registered shared-agent compatibility resolver
- AND it does not create a team candidate or report team deletion.

## Requirement: #17 桌面团队健康接通恢复入口
Source: docs/product/pages/main-conversation.md#三种不可继续状态的共同规则

系统 MUST 将团队已删除与团队需要修复作为不同健康状态交给本地控制台，并让改选可用团队或团队修复在真实 IPC/HTTP 装配中恢复推进。系统 MUST NOT 把缺失团队引导到不可执行的修复动作。

### Scenario: 桌面窗口改选已删除团队
- GIVEN 桌面窗口中的当前会话绑定团队已被删除并处于只读态
- WHEN 用户从团队上下文菜单改选内置可用团队
- THEN 真实会话绑定更新、输入恢复且原时间线仍可见

## Requirement: Markdown 外链通过窄 IPC 交给系统浏览器
Source: docs/product/pages/main-conversation.md#时间线

桌面壳 MUST 为已确认的 Markdown 外链提供单用途 preload IPC。主进程 MUST 使用 URL parser 再次验证绝对 URL，只允许 `http:`、`https:`、`mailto:` 后调用 `shell.openExternal`；malformed、relative、`file:`、`data:`、`javascript:` 与自定义协议 MUST 被拒绝。renderer MUST NOT 获得任意 shell、文件打开或窗口创建能力。

### Scenario: 合法与非法链接在主进程分流
- GIVEN renderer 依次提交 HTTPS URL、mailto URL、file URL 与 malformed text
- WHEN preload 调用外链 IPC
- THEN 主进程只为前两项调用 `shell.openExternal`
- AND 后两项不触发 shell、文件系统或窗口副作用

## Requirement: 主窗口拒绝 Markdown 直接导航
Source: docs/product/pages/main-conversation.md#时间线

主 BrowserWindow MUST 拒绝 renderer 内容创建新窗口，并 MUST 阻止离开应用自身页面的 top-level navigation。链接确认与系统浏览器 IPC MUST 是 Markdown 外链的唯一打开路径；context isolation 与 node integration 禁用边界 MUST 保持不变。

### Scenario: Markdown 尝试绕过外链 IPC
- GIVEN Markdown link 或 raw HTML 尝试使用 target、window.open 或 top-level navigation
- WHEN 用户激活该内容
- THEN 主窗口不新建窗口且不离开操作台页面
- AND renderer 仍不能访问 Electron、Node 或本地文件 API
## Requirement: desktop renderer 通过窄能力接入本地附件
Source: docs/product/pages/main-conversation.md#添加与发送附件

desktop main MUST 为每次应用启动生成仅用于 local-console 附件端点的随机 capability，并把同一 capability 注入 main process 拥有的 local console server 和窄 preload API。renderer MUST 用 Chromium 图片解码能力为 PNG/JPEG/GIF/WebP 生成有界 PNG preview，再通过 loopback local-console 附件 API 流式上传原件、finalize preview、恢复元数据、读取派生缩略图和移除未发送附件。renderer MUST NOT 获得完整托管原件或普通文件任意内容读取能力，也 MUST NOT 启用 Node integration、直接读写文件系统、SQLite 或托管附件目录。

preload MUST NOT 暴露通用文件读取、任意路径读取或任意 HTTP header 能力；capability MUST NOT 写入日志、持久化草稿、消息 DTO 或可见 DOM URL。

### Scenario: 选择文件后仍由 local-console 持久化
- GIVEN Electron renderer 从浏览器 File API 收到用户选择的文件
- WHEN 它准备附件草稿
- THEN 它携带窄 capability 调用 loopback attachment endpoint
- AND main/preload 不直接写消息或 SQLite
- AND renderer 不获得原始文件系统路径。

### Scenario: 外部来源缺少 capability
- GIVEN 另一个本地网页知道 local console 端口但没有当前启动 capability
- WHEN 它尝试写入或读取附件内容
- THEN local console server 在文件 IO 前拒绝请求。

### Scenario: 移除 pending 附件抑制迟到响应
- GIVEN 一个附件仍在流式上传且用户已从草稿移除它
- WHEN renderer 取消请求而服务端或网络随后返回结果
- THEN renderer 立即撤销本地占位并忽略该上传的迟到结果
- AND 已移除附件不会重新出现在原草稿。

## Requirement: desktop 发送编排保持选择与草稿一致
Source: docs/product/pages/main-conversation.md#指标与验收

desktop renderer MUST 在首次发送和已有 session 发送中同时提交正文与当前 draft key 的有序 ready attachment ids。selection mutation 或发送已经在途时，handler 边界 MUST 拒绝重复附件提交；API 成功后才清空对应正文与附件草稿，失败或过期响应 MUST 保留草稿和原选择。

### Scenario: 首次发送原子创建含附件会话
- GIVEN 新对话已选项目且草稿含正文和多个 ready 附件
- WHEN 首次发送成功
- THEN renderer 选择服务端返回的 session
- AND 只清空 `draft:new` 的正文与附件
- AND 其他 session 的草稿不变。

### Scenario: selection mutation 阻止附件重复提交
- GIVEN create/open/rebind mutation 已经拥有 selection gate
- WHEN 又发生发送或附件提交 intent
- THEN handler 不发送第二个消息请求或附件归属请求
- AND 现有草稿保持不变。

## Requirement: 对话菜单提供分析、复制记录路径与归档
Source: docs/product/pages/main-left-sidebar.md#项目与对话菜单

系统 MUST 在每个对话菜单中依次提供「在右侧栏分析这段对话」「复制对话记录路径」和「归档」。系统 MUST NOT 把任一对话操作放入项目菜单。

### Scenario: 打开对话菜单
- GIVEN 侧边栏存在一段用户发起的对话
- WHEN 用户打开该对话的菜单
- THEN 菜单项依次为「在右侧栏分析这段对话」「复制对话记录路径」和「归档」

## Requirement: 非当前对话分析采用原子组合路由
Source: docs/product/pages/main-left-sidebar.md#在右侧栏分析这段对话

用户从左侧栏非当前对话触发分析时，desktop renderer MUST 先准备目标来源视图、对话级片段、可归并草稿与右侧栏标签，全部成功后再提交唯一选中行、主内容和右侧栏状态。任一步失败时 MUST 保留进入前的选中行、主内容、右侧栏标签、草稿与阅读现场，MUST NOT 留下半切换状态或无来源片段的草稿。

### Scenario: 非当前对话成功切换

- GIVEN 主内容显示对话 A 且用户从对话 B 的菜单触发分析
- WHEN B 的来源视图、片段、草稿与标签全部准备成功
- THEN B 成为左侧栏唯一选中项
- AND 主内容显示 B，右侧栏显示 B 的分析草稿
- AND A 的右侧栏标签、草稿和阅读状态按 A 保留

### Scenario: 非当前对话准备失败

- GIVEN 主内容显示对话 A 或全局新对话页，且用户从对话 B 的菜单触发分析
- WHEN B 的读取、片段生成、草稿准备或页面呈现任一步失败
- THEN 进入前的选中项、主内容与右侧栏保持不变
- AND B 不留下新草稿或半套标签
- AND 用户看到可理解且可访问的失败原因

## Requirement: 分析发送条件只取草稿当前项目
Source: docs/product/pages/main-conversation.md#右侧栏中的分析新会话

来源项目目录不可用但记录路径可取得时，renderer MUST 允许打开完整分析草稿，并 MUST 保留且标明不可用的来源项目，根据草稿当前选择的项目重新计算工作空间与发送条件。用户改选可用项目后 MUST 立即恢复发送；原来源项目之后不可用 MUST NOT 继续阻止发送。

### Scenario: 改选项目恢复发送

- GIVEN 分析草稿来源项目不可用且草稿内容与片段完整保留
- WHEN 用户把草稿当前项目改为可用项目
- THEN 工作空间与发送条件按新项目重新计算
- AND 来源片段保持不变

## Requirement: 复制动作把事实日志稳定路径写入系统剪贴板
Source: docs/product/pages/main-left-sidebar.md#复制对话记录路径

系统 MUST 由桌面主进程查询目标 session 的内部事实日志路径并直接写入系统剪贴板。系统 MUST NOT 让 renderer 自行拼接记录路径或把路径作为 IPC 结果返回展示层。

### Scenario: 复制现有对话记录路径
- GIVEN 目标 session 的 jsonl 事实日志存在且可读
- WHEN renderer 经受控 IPC 触发“复制对话记录路径”
- THEN 系统剪贴板内容为该 session 的绝对 jsonl 路径

## Requirement: 同一对话重复复制得到同一路径
Source: docs/product/pages/main-left-sidebar.md#复制对话记录路径

系统 MUST 在对话继续推进和应用运行期间保持同一 session 的复制路径稳定。系统 MUST NOT 为复制动作生成导出快照或临时路径。

### Scenario: 对话推进后再次复制
- GIVEN 同一 session 已复制过记录路径且随后又追加了消息或运行事实
- WHEN 用户再次触发“复制对话记录路径”
- THEN 第二次写入剪贴板的路径与第一次相同且该文件包含后来追加的事实

## Requirement: 复制失败不改写剪贴板
Source: docs/product/pages/main-left-sidebar.md#复制对话记录路径

系统 MUST 在记录服务未就绪、记录文件不可用或系统剪贴板写入失败时给出可理解的失败说明。系统 MUST NOT 在路径查询或文件可用性校验失败后调用剪贴板写入。

### Scenario: 记录文件不可用
- GIVEN 系统剪贴板已有内容且目标 session 的事实日志不存在或不可读
- WHEN 用户触发“复制对话记录路径”
- THEN 界面显示复制失败说明且剪贴板保留原有内容

## Requirement: 路径值不进入界面文案与常驻状态
Source: docs/product/pages/main-left-sidebar.md#复制对话记录路径

系统 MUST 在成功时只显示“路径已复制”并在失败时只显示不含路径的说明。系统 MUST NOT 把事实日志路径加入界面文案、renderer 可展示状态、会话列表 DTO 或详情 DTO。

### Scenario: 成功和失败反馈均不泄露路径
- GIVEN 底层成功取得路径或失败异常文本包含本机路径
- WHEN 对话菜单完成复制动作并渲染反馈
- THEN 成功反馈为“路径已复制”且失败反馈不包含本机路径

## Requirement: AI 建队草稿在同一流程中可退出并恢复
Source: docs/product/pages/onboarding.md#第-2-步--ai-建队子流程
Acceptance: onboarding#6

系统 MUST 以「你希望这支团队长期替你完成什么工作？」作为固定首问、每轮 clarifying 只返回一个问题，并以独立草稿保存对话、最后有效方案和当前状态供用户返回后恢复。系统 MUST NOT 把未确认草稿登记为正式团队或在同一轮展示多个追问。

### Scenario: 退出后恢复未确认草稿
- GIVEN 用户已提交长期工作目标且 AI 建队草稿含一轮对话
- WHEN 用户退出并再次打开同一建队入口
- THEN renderer 获得原对话、最后有效方案和可继续的草稿状态，团队列表没有新增项

### Scenario: 固定首问与单次追问
- GIVEN 用户首次打开一个尚无对话的 AI 建队草稿
- WHEN service 返回 idle 状态并在后续一轮收到 clarifying 输出
- THEN 第一条 assistant 消息以固定长期目标问题开头，clarifying 消息只包含一个可回答的问题

## Requirement: AI 团队方案经验证后整支提交
Source: docs/product/pages/onboarding.md#第-2-步--ai-建队子流程
Acceptance: onboarding#7

系统 MUST 只接受含 2–6 名成员、唯一稳定 slug、唯一主 Agent、结构化职责、至少一条克制与启用条件、交棒引用、有效接力示例的方案。系统 MUST NOT 提交过期 proposal revision 或未经验证的方案。

### Scenario: 当前有效方案创建并选中
- GIVEN 当前显示方案已通过业务校验且 proposal revision 为 N
- WHEN 用户以 revision N 请求创建
- THEN 系统一次创建全部成员及其有效 `AGENT.md`，登记普通用户团队并返回 selected 状态

## Requirement: AI 建队使用并冻结当前可用 CLI
Source: docs/product/pages/onboarding.md#第-2-步-ai-建队
Acceptance: onboarding#20

AI 建队创建 draft 时 MUST 按 `Codex → Kimi → Claude Code` 选择第一套 ready CLI，
保持已有 Codex/Kimi 顺序不变。三者都不 ready 时 MUST 拒绝启动。选定 CLI、
execution profile、隔离 cwd 与 provider session MUST 在 draft 生命周期内冻结。
draft 第一次执行 MAY 创建 Codex thread、Claude Code session 或 Kimi session；取得
external ID 后，submit、adjust、retry、恢复与唯一一次结构 repair MUST 只 resume
该 ID。失败 MUST NOT 跨 CLI。

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

## Requirement: AI 建队执行环境保持隔离只读
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

## Requirement: AI 建队失败有界并保留可恢复内容
Source: docs/product/pages/onboarding.md#第-2-步-ai-建队
Acceptance: onboarding#21

系统 MUST 继续把非法输出修复限制为最多一次。AI 建队观察到 external ID 后 MUST 立即随 draft 保存，即使当轮随后失败。resume 失败、
requested / observed ID 冲突或 provider 会话不存在时 MUST 只执行一次 resume，MUST
保留 draft ID、external ID、对话和最后有效方案，MUST NOT reset thread、构造
reconstruction prompt、执行 full / `session/new` 或跨 CLI。

renderer MUST 显示
`AI 上下文暂时无法继续，已保留对话和最后有效方案。` 并保留 `重试`，但 MUST NOT
接收 provider ID。

### Scenario: resume 失败后重试仍保留身份

- **GIVEN** draft 已有 Kimi session ID 和最后有效方案
- **WHEN** `session/resume` 返回 Session not found
- **THEN** draft 进入可重试 failed
- **AND** external ID 不清空
- **AND** 本轮没有 `session/new`
- **AND** 页面显示固定安全文案与 `重试`。

### Scenario: started 后输出非法

- **GIVEN** 首次 Codex 调用已报告 thread ID
- **WHEN** 输出非法且 repair 失败
- **THEN** failed draft 已保存该 thread ID
- **AND** 下一次 retry resume 同一 thread。

## Requirement: AI 建队 invocation manifest 仅供内部审计

Source: docs/product/prd.md#desktop-持久-agent-的执行会话连续性

AI 建队每个内部 runDir MUST 记录安全 invocation manifest，至少包含
`full|resume`、requested / observed ID 一致性和 outcome，使测试可以断言失败轮只有
一次 resume 且没有 reconstruction。manifest MUST NOT 包含 prompt、原始模型输出、
provider 密钥或 token，且 MUST NOT 进入 renderer DTO。

### Scenario: renderer 读取失败 draft

- **GIVEN** resume 失败轮已写 invocation manifest
- **WHEN** renderer 通过 IPC 读取 draft
- **THEN** DTO 只含安全 error、canRetry、消息与最后有效方案
- **AND** 不含 external ID、runDir 或 manifest 内容。

## Requirement: renderer 只接收白名单 AI 建队 DTO
Source: docs/product/pages/onboarding.md#AI-建队技术约束
Acceptance: onboarding#22

系统 MUST 只向 renderer 返回 phase、公开消息、方案预览、revision、安全错误摘要、可执行动作、所选 CLI 枚举和 selected 终态的团队 id。系统 MUST NOT 返回 provider session id、模型、effort、原始协议记录、schema 路径、cwd、内部堆栈或内部错误。

### Scenario: 所选 CLI 运行失败后的 IPC 响应
- GIVEN 所选 CLI 在内部运行目录中产生 stderr 与堆栈
- WHEN renderer 通过 AI 建队 IPC 读取草稿
- THEN 响应只含安全 `error.code`、`humanMessage`、`canRetry` 与恢复动作，序列化结果不含任何内部路径或 provider session id

## Requirement: AI 建队提交对团队列表原子可见
Source: docs/product/pages/agent-teams.md#AI-建队
Acceptance: agent-teams#6

系统 MUST 在同一文件系统临时目录写完并重读验证完整团队后才切换为正式用户团队并登记记录。系统 MUST NOT 在确认前或任一步失败后让团队列表看到临时目录、部分成员或残留团队记录。

### Scenario: 团队记录登记失败
- GIVEN 临时团队的 2–6 名成员及全部 `AGENT.md` 已写完并通过重读校验
- WHEN 正式目录 rename 后的用户团队记录登记失败
- THEN writer 删除正式目录和临时目录，团队列表不返回该团队且 last-used team 记录不变

## Onboarding shell

### Requirement: 首次启动进入独立引导路由

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#1`

桌面应用 MUST 在首启完成 marker 未命中时导航到 `/onboarding/*` 并从第 1 步开始。该路由 MUST 是独立于新建对话页和 `OperatorConsole` 的顶层视图。

#### Scenario: 全新数据根启动

- **GIVEN** 当前数据根没有有效的 `.onboarding-completed` marker
- **WHEN** 桌面 renderer 完成首次路由判定
- **THEN** 用户看到引导第 1 步
- **AND** 新建对话页尚未挂载。

### Requirement: 已完成引导的启动直达主页面

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#2`

桌面应用 MUST 只把包含有效 ISO 完成时间的 `<dataRoot>/.onboarding-completed` 视为已完成引导；marker 缺失、不可读或损坏 MUST 视为未完成。有效 marker 命中时 MUST 直接导航到 `/`，不得再次显示引导。

#### Scenario: 有效 marker 命中

- **GIVEN** 当前数据根的 `.onboarding-completed` 包含有效 ISO 时间
- **WHEN** 应用启动并读取 marker
- **THEN** renderer 直接显示主页面的新建对话形态
- **AND** 不显示任何引导步骤。

### Requirement: 已完成用户可非破坏性回看引导

Source: docs/product/pages/onboarding.md#重新查看引导

桌面 renderer MUST 允许 marker 已完成的用户从主页面进入完整 onboarding 回看。回看 MUST 作为非持久化展示态保持进入前的操作台挂载；退出或在第 4 步点击“开始使用”后 MUST 恢复进入前的项目、对话、草稿和应用页面状态。

进入、退出和结束回看 MUST NOT 删除、覆盖或重写 `.onboarding-completed`，MUST NOT 调用首启完成 IPC，MUST NOT 生成 `pendingAgentTeamKey`，并 MUST NOT 更新上一次成功创建会话所用团队。应用在回看中关闭后，下次启动 MUST 继续按有效 marker 进入主页面。

#### Scenario: 退出回看

- **GIVEN** 有效 completion marker 已命中且用户从一个带未提交草稿的主页面进入回看
- **WHEN** 用户点击“退出”
- **THEN** 原操作台重新可见且草稿、当前项目、当前对话和应用页面保持不变
- **AND** completion marker 内容未改变。

#### Scenario: 从第 4 步结束回看

- **GIVEN** 用户在回看第 2 步临时选择了不同团队
- **WHEN** 用户在第 4 步点击“开始使用”
- **THEN** renderer 返回进入前的操作台
- **AND** 不调用 `onboarding:complete`
- **AND** 不把临时团队选择交给新建对话或 last-used team。

#### Scenario: 回看中关闭应用

- **GIVEN** 有效 completion marker 已命中且用户正在回看第 2 步
- **WHEN** 应用关闭并重新启动
- **THEN** renderer 按原有效 marker 进入主页面
- **AND** 不恢复或强制继续回看。

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

### Requirement: 第 2 步默认选择内置开发团队

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#5`

第 2 步 MUST 展示可用于新建对话的团队，并在没有本步选择时优先默认选中可用的内置 `development` 团队；若该团队不可用，MUST 回退到首个可用内置团队。该步 MUST 提供“跟 AI 聊出一支新团队”入口并在同一步内嵌既有 `TeamBuilderView`。

#### Scenario: 内置开发团队可用

- **GIVEN** 团队列表包含可用的 `system:development`
- **WHEN** 用户第一次进入第 2 步
- **THEN** 开发团队卡片处于选中态
- **AND** 用户无需额外选择即可继续。

### Requirement: 完成引导把团队一次性交给新建对话

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#9`

第 4 步 MUST 只有一个主 CTA“开始使用”。点击后系统 MUST 先原子写入完成 marker，再导航到 `/` 并以 route state 携带 `pendingAgentTeamKey`。新建对话 MUST 让该 pending pick 优先于 last-used 和内置回退，消费后立即清除 route state；引导完成本身 MUST NOT 写 last-used，只有成功创建会话才能沿用既有规则写入。

#### Scenario: 选择团队后完成引导

- **GIVEN** 用户在第 2 步选中了一个可用团队并到达第 4 步
- **WHEN** 用户点击“开始使用”
- **THEN** marker 写入成功后页面进入 `/`
- **AND** 新建对话的团队预选等于引导所选团队
- **AND** route state 被清除且 last-used 文件未因引导完成而更新。

### Requirement: 标题区是引导唯一的步骤进度提示

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#10`

引导 MUST 在标题区显示“第 n 步，共 4 步”并与当前步骤同步。引导 MUST NOT 在内容下方或窗口底部重复渲染四个步骤圆点、`n / 4` 文本或其它第二套步骤进度。

#### Scenario: 从第 2 步前进

- **GIVEN** 用户正在第 2 步
- **WHEN** 用户点击“继续”进入第 3 步
- **THEN** 标题区由“第 2 步，共 4 步”更新为“第 3 步，共 4 步”
- **AND** 页面不存在底部步骤圆点或 `3 / 4` 文本。

### Requirement: 四步共享稳定的 780px 对齐框架与固定底部操作 footer

Source: docs/product/pages/onboarding.md#步骤操作行每屏
Acceptance ID: `onboarding#11`

四步 MUST 共享最大约 780px 的响应式内容对齐框架。第 1、2、4 步普通内容 MUST 在框架内保持约 512px 的阅读宽度；第 2 步 AI 团队设计器与第 3 步接力舞台 MAY 使用框架完整宽度。

全局步骤操作 MUST 位于独立的全宽 footer 中；该 footer MUST 稳定占据窗口底部、与可滚动步骤主体分离且不得覆盖主体。footer 内部 MUST 使用最大约 780px 的响应式对齐边界，把操作以 8px 间距右对齐，并让最右侧主操作与内容框架共用右边缘。footer MUST NOT 渲染步骤圆点、`n / 4` 或其它第二套进度。AI 团队设计器子流程打开时 MUST 隐藏全局 footer。

#### Scenario: 连续浏览普通步骤与宽版步骤

- **GIVEN** 用户从第 1 步连续前进到第 4 步
- **WHEN** 主体在约 512px 普通内容与约 780px 宽版内容之间切换
- **THEN** 全局步骤 footer 始终占据窗口底部且不随主体滚动
- **AND** 操作按钮保持 8px 间距并与约 780px 框架共用右边缘
- **AND** footer 中不存在步骤圆点或 `n / 4` 文本。

#### Scenario: 低窗口响应式降级

- **GIVEN** 窗口高度不足以完整显示当前步骤内容
- **WHEN** 用户滚动步骤主体
- **THEN** 主体可独立滚动且不被 footer 覆盖
- **AND** footer 及其操作保持可见。

#### Scenario: AI 团队设计器打开

- **GIVEN** 用户位于第 2 步
- **WHEN** 用户打开 AI 团队设计器
- **THEN** 全局步骤 footer 不渲染
- **AND** 设计器自己的返回、调整和创建操作保持可达。

### Requirement: AI 建队提交后即时显示用户消息

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#23`

用户提交 AI 建队目标、追问回答或自然语言调整后，renderer MUST 在等待所选 CLI 结果期间立即把正文显示为右侧用户消息气泡，并在其后显示 AI 正在输入状态。服务端公开消息包含本轮用户消息后，renderer MUST 把临时气泡无重复地收敛为正式消息；系统 MUST NOT 等到完整 turn 返回才第一次显示用户正文。

#### Scenario: 所选 CLI 回复尚未返回

- **GIVEN** AI 建队输入框可提交且服务端 callback 仍在等待草稿冻结的 CLI
- **WHEN** 用户发送一条非空消息
- **THEN** 输入框清空并锁定
- **AND** 同一条正文立即显示为右侧用户消息气泡
- **AND** AI 正在输入状态显示在该气泡之后。

#### Scenario: 服务端状态接管临时气泡

- **GIVEN** renderer 已显示一条临时用户气泡
- **WHEN** 父级状态新增本轮正式用户消息和 assistant 结果
- **THEN** 对话中本轮用户正文只出现一次
- **AND** 后续历史只使用服务端公开消息。

### Requirement: AI 团队设计器完整展示响应式提案

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#24`

第 2 步 AI 团队设计器打开时，主体 MUST 随窗口缩小且不得产生页面级横向滚动。有效团队提案 MUST 按内容完整展示 2–6 名成员、各自 `@slug`、主 Agent 与接力关系；提案卡 MUST NOT 因纵向 flex 收缩而裁掉成员，超高内容 MUST 只由设计器对话区滚动。

#### Scenario: 大窗口显示四名成员

- **GIVEN** desktop viewport 有足够宽高且 AI 方案包含四名成员
- **WHEN** renderer 显示 AI 团队设计器和当前提案
- **THEN** 设计器宽于普通 512px 主体且不超过约 780px
- **AND** 设计器高度随可用空间增长且不超过约 720px
- **AND** 四名成员、四个 slug、主 Agent 与接力关系都位于完整提案卡内。

#### Scenario: 窄窗口降级

- **GIVEN** viewport 小于设计器最大宽度或高度
- **WHEN** AI 团队设计器打开
- **THEN** 设计器缩小到可用宽度且不产生页面级横向滚动
- **AND** 对话区仍可滚动到全部提案内容和输入框。

### Requirement: 引导期间不挂载操作台侧栏

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#12`

`/onboarding/*` MUST NOT 渲染 `OperatorConsole`、项目侧栏或三栏操作台。引导完成进入 `/` 后 MUST 恢复正常操作台；操作台自身 MUST 不再含“引导期强制打开侧栏”的特殊分支。

#### Scenario: 首启路由与主路由隔离

- **GIVEN** 未完成引导的用户位于 `/onboarding`
- **WHEN** renderer 渲染第 1 至第 4 步
- **THEN** DOM 中不存在操作台侧栏
- **WHEN** 用户完成引导并进入 `/`
- **THEN** 操作台按普通侧栏偏好渲染。

### Requirement: 引导文案不暴露仓库协作术语

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#13`

引导所有步骤、错误态、按钮、状态标签和 AI 建队入口的可见文案 MUST NOT 出现 `gh`、`GitHub`、`PR` 或 `issue` 字样。

#### Scenario: 遍历所有引导状态

- **GIVEN** 测试依次渲染 Codex-only、Kimi-only、双缺失、团队选择、接力 slot、完成和 AI 建队状态
- **WHEN** 收集所有可见文案
- **THEN** 不包含任何禁止术语。

### Requirement: 引导视觉只使用设计令牌

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#14`

引导 UI MUST 使用 `packages/console-ui/DESIGN.md` 定义的语义颜色、边框、圆角、排版与状态令牌，MUST NOT 在引导组件中加入裸十六进制色值。

#### Scenario: 检查引导样式源码

- **GIVEN** 引导四步组件已经实现
- **WHEN** 审查其颜色和状态样式
- **THEN** 所有颜色来自共享语义令牌
- **AND** 不存在裸十六进制色值。

### Requirement: 引导支持亮暗双主题

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#15`

引导 MUST 继承 console-ui 的亮暗主题令牌，并在两种主题下保持正文、辅助文字、边框、选中态、成功态、错误态和 disabled 按钮可辨识。

#### Scenario: 系统主题切换

- **GIVEN** 引导当前停留在任一步骤
- **WHEN** 应用主题在亮色与暗色之间切换
- **THEN** 页面无需重新装配即可应用对应令牌
- **AND** 关键状态与操作仍可读、可区分。

### Requirement: 返回上一步保留引导成果

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#17`

第 2 至第 4 步 MUST 提供“上一步”，第 1 步 MUST 不提供回退入口。返回 MUST 保留本次引导中的双 CLI readiness、安装任务状态和团队选择；从第 4 步返回第 3 步 MUST 增加一次接力重播轮次，使后续实现能从第一棒重新播放。

#### Scenario: 从第 4 步返回团队选择

- **GIVEN** 用户已有至少一套 CLI ready、选择团队并到达第 4 步
- **WHEN** 用户连续两次点击“上一步”
- **THEN** 页面回到第 2 步
- **AND** 原团队仍为选中态
- **AND** 第 1 步的成功环境状态没有被重新判为失败。

### Requirement: 品牌母版可重复派生并校验

Source: docs/product/prd.md#品牌与发行平台

系统 MUST 把 `assets/brand/moebius.png` 作为唯一品牌母版，通过仓库脚本派生 1024px 应用图标、64px UI 图标、32px favicon 与 180px Apple Touch Icon，并在只读检查中校验源/产物哈希、PNG 格式、正方形尺寸和文件大小上限。系统 MUST NOT 通过手工维护多份互不校验的图标或在派生时裁切、抠图、重绘、改变白底与原有留白。

#### Scenario: 已提交产物与母版一致

- **GIVEN** 品牌母版和 manifest 已提交
- **WHEN** 运行资产脚本的 `--check` 模式
- **THEN** 每个声明产物的 SHA-256、PNG 尺寸和文件大小都通过
- **AND** 同尺寸部署副本具有相同内容哈希。

#### Scenario: 产物被手工替换

- **GIVEN** 64px UI 图标被替换为另一张同尺寸 PNG
- **WHEN** 运行资产脚本的 `--check` 模式
- **THEN** 检查因哈希不匹配失败
- **AND** desktop 打包不得继续。

### Requirement: 桌面安装包使用统一 Moebius 图标

Source: docs/product/prd.md#品牌与发行平台

Electron 打包 MUST 使用品牌脚本生成的 1024px PNG 作为 `.app` 和 DMG 的应用图标来源，并让 Electron-builder 在打包时生成系统所需的 ICNS 尺寸。辅助诊断页和 desktop renderer head MUST 使用同源 64px/32px 产物。系统 MUST NOT 回退到 Electron 默认图标或与应用内品牌位置不同的图形。

#### Scenario: 检查打包后的应用

- **GIVEN** macOS arm64 打包已完成
- **WHEN** 检查 `.app` bundle 与挂载后的 DMG
- **THEN** 应用和磁盘映像显示 Moebius 品牌图标
- **AND** bundle 内存在由 1024px 母版派生的系统图标资源。

### Requirement: 正式发行仅生成 macOS Apple Silicon 产物

Source: docs/product/prd.md#品牌与发行平台

桌面打包配置与正式发布流程 MUST 只生成 macOS arm64 的 DMG 和 ZIP，产物名 MUST 明确包含 `mac-arm64`。正式发布 MUST 在创建 `vX.Y.Z` tag 与 GitHub Release 前校验应用签名和可执行文件 arm64 架构，MUST NOT 生成或上传 Windows、Linux、macOS x64 或 universal 产物。

#### Scenario: 正式发布生成 v tag

- **GIVEN** 正式发布流程准备版本 `X.Y.Z`
- **WHEN** 签名、arm64 架构与 Electron-builder 产物检查全部通过
- **THEN** Release 只收到同版本的 macOS arm64 DMG 与 ZIP
- **AND** 正式 tag 为 `vX.Y.Z`
- **AND** 没有 exe、AppImage、x64、universal 或其他平台产物。

#### Scenario: 候选应用不是 arm64

- **GIVEN** 候选应用的可执行文件不是 arm64
- **WHEN** 正式发布流程执行架构门禁
- **THEN** 流程在创建 tag 或 GitHub Release 前失败
- **AND** 不发布交叉编译或架构不明的产物。

### Requirement: 正式 macOS 更新自动检查并后台下载

Source: docs/product/pages/settings.md#更新检查、下载与安装

正式打包的 macOS Apple Silicon 应用 MUST 在启动后自动检查正式 GitHub Release，并在发现新版本后自动后台下载和校验；用户 MUST 还能手动立即检查。本 change 不引入运行期间的周期调度。更新器 MUST 将检查、下载进度、下载完成和失败投影为稳定状态；MUST NOT 在检查或下载阶段安装、重启、打开浏览器或弹出完成通知。开发态、非正式平台或更新元数据不可用时 MUST fail closed 并保留浏览器 Release 兜底。

#### Scenario: 启动后发现更新

- **GIVEN** 正式 macOS arm64 应用启动，GitHub 提供与当前版本不同的有效签名 Release 元数据
- **WHEN** 自动检查完成
- **THEN** 主进程开始后台下载
- **AND** renderer 收到版本与有界下载进度
- **AND** 未调用 `shell.openExternal`、安装或退出

#### Scenario: 包下载完成

- **GIVEN** 更新器报告目标包已完整下载并校验通过
- **WHEN** 更新状态广播到 renderer
- **THEN** 状态进入 `ready-to-install`
- **AND** 只有 UI 安装入口可触发下一步

#### Scenario: 检查或下载失败

- **GIVEN** 网络、元数据、签名或下载发生失败
- **WHEN** 更新器结束本次尝试
- **THEN** 状态进入可重试失败
- **AND** 当前版本仍可见、侧栏没有安装按钮、应用保持运行

#### Scenario: 安装器未使进程退出

- **GIVEN** 更新状态为 `ready-to-install`，用户已确认安装，但上游 `quitAndInstall()` 未使隔离应用进程在有界时间内结束
- **WHEN** 安装退出看门狗到期
- **THEN** 应用恢复可用并显示脱敏的安装失败/重试状态
- **AND** 已下载更新 marker 保留，重复安装调用被解除单飞锁
- **AND** 本地 console 与退出协调器恢复，用户不需要第二次启动应用才能继续工作

#### Scenario: 普通重启恢复已就绪更新

- **GIVEN** 更新包已完整下载并校验通过，更新器缓存和就绪元数据仍有效
- **WHEN** 用户执行普通应用重启
- **THEN** 主进程恢复 `ready-to-install` 状态而不重新下载完整包
- **AND** 设置“关于”显示“已准备好”，侧栏重新显示“安装更新”

### Requirement: Release 更新资产必须与最终 arm64 ZIP 一致

正式 GitHub Release MUST 使用明确白名单上传最终 macOS arm64 DMG、最终 ZIP、`latest-mac.yml` 和该 YML 明确引用的 ZIP blockmap sidecar；MUST NOT 上传 builder 中间文件。`latest-mac.yml` 的版本、ZIP 文件名、字节大小和 SHA-512 MUST 与最终 ZIP 一致；本地发布目录和远端 Release MUST 使用同一校验规则。最终 ZIP 内的 `.app` MUST 已签名、公证并 stapled，不能把 ZIP 本身描述为 stapled。

#### Scenario: 本地发布门禁拒绝中间文件

- **GIVEN** release 目录包含最终 arm64 产物、更新元数据和一个未列入白名单的 builder 文件
- **WHEN** 执行 `pnpm release:validate-update --dir <dir> --version <version>`
- **THEN** 校验失败并列出非白名单文件
- **AND** 发布流程不得上传该目录

#### Scenario: 远端发布门禁校验最终 ZIP

- **GIVEN** Draft Release 提供最终 arm64 资产、`latest-mac.yml` 和 YML 引用的 sidecar
- **WHEN** 执行 `pnpm release:validate-update --remote v<version> --version <version>`
- **THEN** 校验器下载远端 YML 与最终 ZIP 到系统临时目录
- **AND** 只有远端 YML 的版本、文件名、大小和 SHA-512 全部匹配时才返回成功

### Requirement: 更新安装必须经过用户确认与安全收尾

Source: docs/product/pages/settings.md#更新检查、下载与安装

`ready-to-install` 状态 MUST 只由侧边栏“安装更新”入口触发安装流程；设置“关于”只展示就绪状态，不提供安装按钮。侧栏入口 MUST 先显示安装确认；无运行任务时提供“取消/重启并安装”，有运行任务时提供独立的重启安装保护弹窗。确认停止任务后，主进程 MUST 等待任务和 local resources 有界回收，再只调用一次 `quitAndInstall()`；取消、任务回收失败或安装失败 MUST 保持应用打开。

#### Scenario: 用户取消安装

- **GIVEN** 更新包处于 ready 状态
- **WHEN** 用户从侧栏进入安装确认并选择取消或“继续工作”
- **THEN** 应用和当前工作区保持原位
- **AND** ready 安装按钮继续存在
- **AND** `quitAndInstall()` 未调用

#### Scenario: 有运行任务时确认重启安装

- **GIVEN** 至少一个 local Agent、AI 建队或 CLI 安装任务正在运行
- **WHEN** 用户选择“停止任务并重启安装”
- **THEN** 弹窗明确列出任务影响并进入准备安装状态
- **AND** 任务实际停止、local console/worker 收尾完成后才调用一次 `quitAndInstall()`

#### Scenario: 任务无法回收

- **GIVEN** 用户确认停止任务但某个受管任务未确认 close
- **WHEN** 安全收尾超时或失败
- **THEN** 应用保持打开并显示脱敏失败说明
- **AND** 更新包与安装入口可再次尝试

### Requirement: 普通退出与重启安装共享保护但使用独立弹窗

Source: docs/product/pages/settings.md#弹层与危险操作

Desktop MUST 使用一个共享的任务快照、停止和资源回收边界处理普通退出与重启安装；MUST 根据终止意图分别显示退出保护弹窗和重启安装保护弹窗。无运行任务时普通退出 MUST 不新增确认弹窗并直接安全收尾；有运行任务时才显示退出保护。安装流程 MUST NOT 复用普通退出弹窗，也 MUST NOT 让第二个弹窗叠在第一个弹窗上。

#### Scenario: 普通退出保护

- **GIVEN** 用户执行普通关闭或 `Command + Q` 且有运行任务
- **WHEN** 系统请求退出
- **THEN** 显示退出保护弹窗
- **AND** 用户取消时任务与应用保持运行，确认时停止任务并退出

#### Scenario: 无运行任务时普通退出

- **GIVEN** 用户执行普通关闭或 `Command + Q` 且没有运行任务
- **WHEN** 系统请求退出
- **THEN** 不显示退出确认弹窗并直接进入安全收尾
- **AND** 进程最终结束

### Requirement: 单次 Command + Q 完成退出

Source: docs/product/pages/main-left-sidebar.md#验收标准

Desktop MUST 在第一次退出事件登记唯一终止意图并复用同一个收尾 Promise。后续 `before-quit`、主窗口 `close` 和 `window-all-closed` 事件 MUST 只等待已登记的收尾，不得发起第二个确认或第二套清理。一次 `Command + Q` 在收尾成功后 MUST 使进程结束，Dock MUST 不再显示运行中指示；仅在应用未固定到 Dock 时要求图标消失。

#### Scenario: 一次 Command + Q

- **GIVEN** 隔离的正式桌面实例无运行任务
- **WHEN** 用户按一次 `Command + Q`
- **THEN** local console 与 worker 有界关闭
- **AND** 最终退出调用恰好一次
- **AND** 进程结束、Dock 不再显示运行中指示；若应用未固定在 Dock，图标消失，无需再次操作

### Requirement: 设置只通过窄 IPC 读取应用信息并复制版本

Source: docs/product/pages/settings.md#关于
Source: docs/product/pages/settings.md#复制版本与公开链接

preload MUST 只暴露读取应用元数据、检查更新和复制固定版本信息的 settings 能力。应用元数据 MUST 只含当前版本与 `Apple Silicon Mac`。复制 MUST 由主进程生成 `Moebius <version> · Apple Silicon Mac` 并写入剪贴板；renderer MUST NOT 提交任意剪贴板文本。失败 DTO MUST 使用稳定 reason，MUST NOT 含路径、环境、原始异常或 Release 响应正文。辅助状态页 MUST NOT 保留已经迁入设置的旧检查更新入口或旧通用检查 IPC。

#### Scenario: 复制版本信息

- GIVEN 当前应用版本为 `0.1.4`
- WHEN renderer 调用复制版本能力
- THEN 系统剪贴板收到 `Moebius 0.1.4 · Apple Silicon Mac`
- AND renderer 没有向主进程提交待复制字符串

### Requirement: 更新检查在 15 秒内原地收敛

Source: docs/product/pages/settings.md#更新检查、下载与安装

主进程 MUST 只比较当前版本与 GitHub 最新正式桌面 Release，并在 15 秒内进入 latest、available 或 failed。正式 Release MUST 使用稳定版 `vX.Y.Z` tag、非 Draft、非 Prerelease 状态，且 HTTPS Release URL MUST 与同一 tag 精确对应；不满足任一条件的响应 MUST 视为非法。检查本身 MUST NOT 打开浏览器、安装或要求重启；发现更新后由自动更新器在后台下载并校验。HTTP 失败、响应非法、网络异常和超时 MUST 返回 failed，MUST NOT 伪装为 latest。available MUST 返回最新版本与本仓库对应的 HTTPS Release URL。

#### Scenario: 检查到新版后开始后台下载

- GIVEN 当前版本为 `0.1.4` 且最新正式版本为 `0.1.5`
- WHEN renderer 调用检查更新
- THEN IPC 返回 available 或 downloading、`0.1.5` 与正式 Release URL
- AND `shell.openExternal`、安装和退出均未调用

#### Scenario: 请求超过时间上限

- GIVEN GitHub 请求在 15 秒内没有返回
- WHEN 更新检查达到上限
- THEN IPC 返回 failed 且 reason 为 timeout
- AND 同一 renderer 会话可再次发起检查

### Requirement: 设置公开链接继续经过安全系统浏览器边界

Source: docs/product/pages/settings.md#复制版本与公开链接

更新失败时的浏览器下载、发布记录、反馈问题和开源仓库 MUST 只在用户显式激活后通过既有外链 IPC 交给系统浏览器。主进程 MUST 复验绝对 URL 协议。反馈 Issue 预填 MUST 只含当前产品名、版本和 Apple Silicon Mac，MUST NOT 包含项目、对话、草稿、路径或诊断。

#### Scenario: 更新失败时用户显式打开浏览器兜底

- GIVEN 更新检查或后台下载返回 failed
- WHEN 用户激活浏览器下载兜底
- THEN 对应 Release URL 通过安全外链 IPC 打开一次
- AND Moebius 设置弹窗和当前工作区保持原位

### Requirement: Durable desktop language preference

Source: `docs/product/pages/settings.md#切换语言`

The desktop shell MUST persist a versioned `zh-CN` or `en` language preference beneath the application data root using a temporary file and atomic rename.

Missing, malformed, or unsupported preferences MUST resolve to `zh-CN`.

The shell MUST create the first interactive renderer using the resolved saved locale so a saved English preference does not expose an interactive Chinese-first state.

#### Scenario: Saved language is restored on restart

Given `en` was saved successfully
When the desktop application fully exits and starts again
Then the first interactive main window uses `en`
And no network request is required to load language resources.

### Requirement: Persist before global locale commit

Source: `docs/product/pages/settings.md#切换语言`

The preload bridge MUST expose only read preference, save preference, and locale-change subscription capabilities.

The main process MUST update its in-memory locale and broadcast to all desktop windows only after the preference file is written successfully.

If persistence fails, the active locale MUST remain unchanged, no locale-change broadcast MUST occur, and the renderer MUST be able to retry.

#### Scenario: Save failure does not flash or roll back language

Given the active and last saved locale is `zh-CN`
When the user selects `en` and the preference write fails
Then every open window remains in `zh-CN`
And no window first renders English and later rolls back.

### Requirement: Desktop-wide static copy follows the saved locale

Source: `docs/product/pages/settings.md#语言覆盖范围`

The main operator window, auxiliary status window, Moebius-provided menu/dialog copy, tooltips, placeholders, errors, and accessible names MUST follow the active saved locale.

The shell MUST NOT translate or rewrite user/Agent content, custom names, file content, file names, local paths, CLI output, or raw OS diagnostics.

#### Scenario: Existing and newly opened windows agree

Given multiple desktop windows are open
When a target locale is saved successfully
Then all open windows commit that locale
And a status window opened afterward starts in the same locale.

### Requirement: 既有安装原子登记通用助手

Source: docs/product/pages/agent-teams.md#既有安装首次登记通用助手

桌面壳 MUST 把 `general-assistant` 作为官方来源团队随安装包提供。干净安装或既有安装缺失该官方团队时，系统 MUST 原子登记恰好一支官方团队；失败 MUST 保持缺失状态并可重试，MUST NOT 留下半团队、重复记录或覆盖现有用户团队/文件。

#### Scenario: 旧安装首次升级

- GIVEN 数据根已有其他官方团队但没有 `general-assistant`
- WHEN 新版本完成官方团队播种
- THEN 恰好新增一支官方「通用助手」
- AND 其他官方或用户团队不变
- AND 唯一 `assistant` 成员推荐 Codex、gpt-5.6-sol、high。

#### Scenario: 稳定身份与目录冲突

- GIVEN 非官方记录占用稳定身份或预定目录存在不可识别内容
- WHEN 用户选择产品内保留并添加动作
- THEN 现有团队和文件保持
- AND 官方团队在新的受管记录/位置原子登记
- AND 失败时回到原冲突状态且可重试。

### Requirement: sidebar chat 初始团队不改写普通偏好

Source: docs/product/pages/agent-teams.md#新建对话中的团队预选

renderer MUST 在手动 sidebar chat 与消息级或对话级分析入口创建的草稿中初始选择当前可用的官方 `general-assistant`，并允许发送前改选。首次发送成功前 MUST NOT 更新 last-used team；团队不可用时 MUST 保留草稿并等待修复或用户改选，MUST NOT 静默替换团队或运行配置。

#### Scenario: 改选团队后首次发送

- GIVEN sidebar chat 初始选择官方通用助手
- WHEN 用户改选团队 T 且首次创建成功
- THEN session 使用 T 的快照
- AND last-used team 记录为 T
- AND 通用助手不成为应用级默认团队。

### Requirement: renderer 持久化完整手动 sidebar presentation route

Source: docs/product/pages/main-left-sidebar.md#选择对话

renderer MUST 以版本化文档保存手动 sidebar chat 的 selected、main、right 与 host 会话关系、每个 host 的右侧标签现场和未发送 sidebar 草稿。重启恢复、归档、项目移除和来源失效 MUST 提交完整组合或保持最后成功组合，MUST NOT 持久化半套选择。分析会话标签与面板开合状态分别适用下文 Requirements；面板开合不得进入该版本化文档。

#### Scenario: 重启恢复组合

- GIVEN 最后成功状态选中手动 sidebar chat B、主内容为来源 A、右侧聚焦 B
- WHEN desktop renderer 重启且 A/B 均可用
- THEN 左侧只高亮 B
- AND 主内容恢复 A
- AND 右侧恢复 B 及其标签阅读现场。

#### Scenario: 创建失败保留草稿

- GIVEN 手动 sidebar 草稿包含上下文、正文、来源胶囊和普通附件
- WHEN 会话创建或首条消息原子提交失败
- THEN 版本化草稿完整保留
- AND renderer 不写入 session locator 或 last-used team。

### Requirement: 分析草稿提升为直接父拥有的唯一会话标签

Source: docs/product/pages/main-right-sidebar.md#分析对话标签与跨树路由

desktop renderer MUST 在分析首发成功后把草稿原位提升为已创建分析会话标签，并在根会话的同一外层标签组中按会话标识去重。分析会话不生成左侧栏会话行。

#### Scenario: 重复激活直接子项

- GIVEN 分析会话 B 已在根会话 A 的标签组打开
- WHEN 用户再次激活 A 面板中的 B
- THEN 聚焦既有 B 标签
- AND 不创建重复标签。

#### Scenario: 孙辈打开为兄弟标签

- GIVEN 分析会话 B 在根会话 A 的外层标签组中
- AND B 的面板包含直接子项 C
- WHEN 用户激活 C
- THEN C 在同一外层标签条打开
- AND 不创建嵌套右侧栏。

### Requirement: 跨树分析导航原子切换工作现场

Source: docs/product/pages/main-right-sidebar.md#分析对话标签与跨树路由

跨树 `moebius-ref:` 导航 MUST 先解析并准备目标根会话及其标签现场，再一次提交根选择与目标分析标签；失败 MUST 保持原工作现场。

#### Scenario: 跨树消息引用成功

- GIVEN 当前位于根会话 A，引用目标属于根会话 B 的分析后代
- WHEN 用户激活引用
- THEN 主内容切换为 B
- AND 恢复 B 自己的标签组并聚焦目标
- AND 消息目标挂载后获得焦点与短暂高亮。

#### Scenario: 目标准备失败

- GIVEN 目标根会话或目标分析会话不可用
- WHEN 用户激活引用
- THEN 当前根会话、标签组、活动标签和阅读位置不变
- AND 原链接显示可理解的不可用反馈。

### Requirement: 面板开合只在当前应用进程按 session 记忆

Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

renderer MUST 按当前对话 session 分别记忆分析面板开合，MUST NOT 将该状态持久化到跨进程存储。

#### Scenario: 切换后返回

- GIVEN 用户在本次应用运行中打开会话 A 的分析面板
- WHEN 切换到 B 再返回 A
- THEN A 的面板保持打开。

#### Scenario: 软件重启

- GIVEN 上次运行结束前 A 的面板打开
- WHEN 应用重新启动
- THEN A 的面板默认关闭。

### Requirement: 服务端提交后才清理分析入口和标签

Source: docs/product/pages/main-conversation.md#分析对话归属归档与移除

renderer MUST 仅在归档或项目移除服务端提交成功后清理对应面板入口和分析标签；失败或回滚 MUST 保持原工作现场。根对话归档恢复只恢复对话树与直接父面板入口，不自动重开归档前的分析标签；未归档现场的软件重启仍恢复已持久化的标签现场。

#### Scenario: 强制项目移除失败

- GIVEN 分析子树在面板与标签组中可见
- WHEN 强制移除的停止或放弃步骤失败
- THEN 面板入口、标签顺序和活动标签保持不变。

#### Scenario: 根对话归档后恢复

- GIVEN 根对话归档前打开了若干分析标签
- WHEN 根对话恢复
- THEN 直接父面板入口恢复
- AND 归档前分析标签不自动重开。
### Requirement: renderer 原子编排会话侧栏 mutation

Source: docs/product/pages/main-left-sidebar.md#项目与对话菜单

renderer MUST 在 local-console mutation 持久化成功并取得 canonical session 后才提交圆点、位置或标题。失败或 409 MUST 保留提交前组合，不得产生侧栏、主内容、右栏或搜索半更新。

#### Scenario: 置顶请求失败

- GIVEN 目标会话仍在项目列表且当前组合包含来源主内容和右侧会话
- WHEN 置顶 mutation 失败
- THEN 会话仍只在原项目出现
- AND 选中、主内容与右栏组合不变。

### Requirement: 标题变化使旧搜索响应失效

Source: docs/product/pages/search.md#操作与反馈

renderer MUST 让搜索请求绑定查询条件与标题 generation。成功重命名 MUST 取消旧 generation、清除陈旧结果并保留原查询以重试；晚到旧响应 MUST NOT 提交。

#### Scenario: 搜索过程中重命名

- GIVEN 查询 A 尚未完成
- WHEN 标题 A 成功改为不包含 A 的 B 且旧响应晚到
- THEN 页面不得重新显示 A
- AND 用户可按原查询条件重试。

### Requirement: 右栏会话标题由 canonical session 解析

Source: docs/product/pages/main-right-sidebar.md#会话重命名同步

renderer MUST 以 conversation tab sourceKey 解析 canonical session 标题和区分上下文，并持久保留不依赖标题解析成功的用户可读区分上下文。持久 tab title MUST NOT 成为会话标题事实源；无法解析时 MUST 输出可自动或手动重试的 pending 状态而不是旧标题，多个 pending 标签 MUST 仍可稳定区分。

#### Scenario: 保留标签组在重启后恢复

- GIVEN 隐藏标签组保留绑定会话的 sourceKey 且会话已重命名
- WHEN 应用重启并恢复该组
- THEN 标签直接使用 canonical 新标题
- AND 不短暂显示持久化旧标题。

### Requirement: 托管运行项进入统一退出保护

Source: docs/product/pages/main-left-sidebar.md#底部应用操作
Source: docs/product/pages/main-left-sidebar.md#验收标准

Desktop MUST 把 local-console supervisor 的 active managed-process count 纳入普通退出与安装更新共用的单次 running-task snapshot。有 managed process 时普通退出 MUST 使用既有退出保护；用户取消 MUST 保持应用和全部运行项不变，用户确认 MUST 等待全部 managed groups 被停止和 reap 后才允许 `app.quit` 或 `quitAndInstall`。

Desktop MUST 继续让 Agent graceful resume、managed-process stop、AI builder/CLI installer cancel、local console close 与 state worker close 共享唯一 termination intent 和 cleanup promise。managed-process cleanup reject 或超时 MUST 使安全收尾失败，应用保持打开并显示 cleanup blocked；后续 Electron `before-quit`、window close 与 `window-all-closed` MUST NOT 启动第二套清理或绕过失败。

#### Scenario: 有运行项时取消退出

- **GIVEN** 真实 Desktop 有一个 ready managed process 且没有其他运行任务
- **WHEN** 用户执行 Command + Q 并选择留在应用
- **THEN** Desktop 保持运行
- **AND** managed process、PID/PGID 与 endpoint 保持可用
- **AND** quit 调用次数为零。

#### Scenario: 确认退出先回收全部运行项

- **GIVEN** 真实 Desktop 有多个 managed process
- **WHEN** 用户确认停止任务并退出
- **THEN** 每个 process group 在应用退出前进入 exited 并被 reap
- **AND** 所有 endpoint 端口关闭
- **AND** 最终 quit 恰好调用一次
- **AND** 不需要第二次 Command + Q。

#### Scenario: 运行项清理失败阻断退出

- **GIVEN** 一个 managed process group 在总清理 deadline 内无法确认退出
- **WHEN** 用户确认普通退出或重启安装
- **THEN** Desktop 不调用 quit 或 quitAndInstall
- **AND** 显示 cleanup blocked
- **AND** 同一 termination intent 不重复弹确认或并发执行第二套 stop。

### Requirement: Desktop 启动先清理残留且不自动重启

Source: docs/product/pages/main-conversation.md#退出应用与恢复执行

Desktop MUST 在 local console 对 renderer 发布 running URL 之前完成 managed-process ownership-manifest reconciliation。reconciliation MUST 只清理 HMAC manifest 验证通过并由精确 `launchd` service target 证明归属的残留 job，MUST NOT 使用裸 PID/PGID、同名 executable 或端口猜测，MUST NOT bootstrap/kickstart 或执行旧 start payload，MUST NOT 恢复旧 registry、endpoint 或日志。每个 manifest MUST 独立处理；无法证明归属、plist 缺失或精确清理失败的条目 MUST 保留并记录 cleanup blocked，不得误杀其目标，也不得阻止其他有效项清理或把应用永久锁在启动失败。local console 可在 reconciliation 完成后以空 registry 发布 ready，但 MUST NOT 把 blocked 条目宣称为受托管 running 状态。

#### Scenario: 崩溃后启动只清理

- **GIVEN** 上次 Desktop 异常终止留下一个 HMAC 有效 ownership manifest、对应 launchd service 和仍监听的端口
- **WHEN** Desktop 再次启动
- **THEN** renderer 获得 local console URL 前旧组与端口已消失
- **AND** 旧命令执行计数没有增加
- **AND** 新会话运行项列表为空。

#### Scenario: 无法证明 service 归属时不误杀

- **GIVEN** manifest HMAC/label/digest 与实际 service identity 冲突且存在一个无关同名进程
- **WHEN** Desktop 启动 reconciliation
- **THEN** 无关进程保持存活
- **AND** local console 记录 cleanup blocked，继续清理其他有效 manifest 并可完成启动
- **AND** 没有向任何裸 PID/PGID 发信号
- **AND** 不发布虚假的 running 状态。

### Requirement: 项目与会话移除先处理托管运行项

Source: docs/product/pages/main-left-sidebar.md#归档
Source: docs/product/pages/main-left-sidebar.md#移除项目

Desktop renderer orchestration MUST 把目标根会话及分析后代的 active managed process 纳入归档与项目移除保护。普通归档 MUST 在存在运行项时禁用并给出可操作原因；强制移除项目 MUST 先停止范围内全部 Agent run 与 managed process，再放弃待接回结果并提交归档/移除。任一 stop 失败 MUST 保留项目、会话、面板、标签和运行项可见现场，MUST NOT 执行后续 mutation。

#### Scenario: 活动运行项阻止普通归档

- **GIVEN** 当前根会话或分析后代有 active managed process
- **WHEN** 用户打开归档菜单
- **THEN** 归档不可执行并说明需要先停止运行项
- **AND** 进程和会话保持不变。

#### Scenario: 强制移除先停止运行项

- **GIVEN** 项目移除范围同时有 Agent run、managed process 和待接回结果
- **WHEN** 用户确认强制移除
- **THEN** Desktop 先等待 Agent run 与 managed process 全部停止
- **AND** 再放弃待接回并提交项目移除
- **AND** managed-process stop 失败时后两步均不发生。

## Team snapshot traceability and apply

### Requirement: Desktop console forwards team-update and run-audit intents through narrow APIs

Source: docs/product/pages/main-conversation.md#团队按钮展开
Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

The renderer application layer MUST use the loopback local-console API for update inspection, apply, retry, cancel, run information and historical Markdown. Preload MUST NOT expose filesystem, SQLite or arbitrary team-file reads for these actions. Renderer requests MUST identify only the selected session/run and action; they MUST NOT submit Markdown, profiles, paths or internal snapshot keys.

Late responses MUST be committed only when their session/run request key and revision are current. Parent re-render or callback identity change MUST NOT repeat a mutation, clear a newer result or let an old response replace current state.

#### Scenario: Late inspection belongs to the old session

- GIVEN update inspection for session A is slow
- WHEN the user switches to session B and B's inspection completes first
- THEN A's late result does not appear above B's composer
- AND no apply callback for B is replaced by A's callback.

#### Scenario: Markdown read has no path capability

- GIVEN the user opens a historical Agent Markdown dialog
- WHEN the renderer calls desktop application APIs
- THEN the request contains session/run identity only
- AND preload receives no arbitrary path or file-read capability.

### Requirement: Team mutation feedback reflects only persisted results

Source: docs/product/pages/agent-teams.md#保存后的生效反馈

The desktop application layer MUST derive save feedback from completed team mutations. It MUST distinguish full success, partial success with per-item failures, and a valid external version loaded without an internal draft. It MUST preserve failed drafts and MUST NOT report success for rejected, conflicted, invalid, unreadable or needs-repair state.

A successful mutation MUST be visible to the complete-version resolver without restarting the application. A save-all-and-leave success MUST commit a feedback payload containing the team and saved-item count before navigation; partial failure MUST keep the detail view active.

#### Scenario: Partial save keeps failed draft out of snapshots

- GIVEN two member Markdown drafts and one profile draft are being saved
- WHEN one Markdown save fails and the other two mutations persist
- THEN feedback marks only the two persisted items as saved
- AND the failed draft remains editable
- AND a subsequent complete team resolve uses the failed member's previous saved file.

#### Scenario: Save all success survives navigation

- GIVEN save-all-and-leave persists three items successfully
- WHEN the team detail closes
- THEN the list receives the team identity and count-three success payload
- AND the payload is not lost during navigation.

#### Scenario: Valid external load is distinct from conflict

- GIVEN no internal draft exists for a member
- WHEN a valid external change is loaded successfully
- THEN an external-loaded success payload is emitted without restart
- WHEN the external content is invalid or conflicts with a draft
- THEN no success payload is emitted.
### Requirement: API Provider 档案由桌面主进程拥有

Source: `docs/product/pages/settings.md#ai-服务商`

Desktop main MUST 是 Provider catalog、档案事务与凭据能力的唯一 composition root。Preload MUST 只暴露列出安全档案、提交输入 Key、验证、生命周期动作和 operation 状态的窄 IPC；renderer MUST NOT 读取 credentialRef 对应 blob、Key、Base URL 或原始 Provider 错误。

#### Scenario: Renderer 列出档案

- **GIVEN** 主进程保存了一个已就绪 DeepSeek 档案
- **WHEN** renderer 请求 AI 服务商列表
- **THEN** DTO 只含稳定 ID、显示名、服务商、模型、状态、Key 脱敏尾号和可执行动作
- **AND** 不含 Key、凭据文件路径或 Authorization。

### Requirement: Provider 凭据明文原子持久化于本机数据根

Source: `docs/product/flows/byok-agent-runtime.md#2-输入-key-与选择模型`

Desktop MUST 仅由 main process 把有界 API Key 以 UTF-8 明文写入应用数据根的凭据文件，写入 MUST 原子（临时文件 + rename）且文件 mode 为 `0600`。凭据记录缺失、凭据文件损坏或原子写失败 MUST 形成可修复的安全状态（档案进入“需要处理”并阻止新运行），MUST NOT 把 Key 交给 renderer/local-console server，也 MUST NOT 使用空 Key 或旧缓存继续运行。

#### Scenario: 凭据记录缺失或无法解析

- **GIVEN** 档案元数据存在但凭据文件中没有对应记录或记录无法解析（含旧版 safeStorage 密文记录）
- **WHEN** 应用重启并校准档案
- **THEN** 档案进入“需要处理”且新运行被阻止
- **AND** 历史仍可读，用户在设置中替换 Key 并重新验证保存后恢复“已就绪”。

#### Scenario: Key 轮换提交失败

- **GIVEN** 旧档案 revision 可正常运行且新 Key 已通过验证
- **WHEN** 本地 profile commit 失败
- **THEN** 旧 revision 和旧 credential 继续有效
- **AND** 用户可不产生额外 API 用量重试本地保存。

### Requirement: Provider 生命周期操作可从崩溃恢复

Source: `docs/product/pages/settings.md#管理-ai-服务商`

创建、轮换、重新启用、迁移和删除 MUST 使用持久 operation journal 与完整 commit marker。应用关闭或崩溃后 MUST 只呈现完整成功，或恢复操作前状态并显示“上次操作未完成”及重试入口；不得呈现半迁移、半团队替换或档案/凭据不一致。

#### Scenario: 批量迁移期间崩溃

- **GIVEN** 用户确认把多个引用迁移到新档案
- **WHEN** 应用在部分独立对象提交后崩溃
- **THEN** 重启后已提交对象明确列为完成，未提交对象保持旧引用并可重试
- **AND** 任一单对象的结构与 Provider 引用不会半提交。

### Requirement: API Provider 单独满足首次引导门槛

Source: `docs/product/pages/onboarding.md#第-1-步--环境就绪至少一个执行引擎已就绪`

首次引导 MUST 将已就绪 API Provider 与已就绪 CLI 统一视为可用执行环境。纯 API 用户 MUST 能使用 Pi 完成 AI 建队并保存每名成员的 Provider、模型和实际思考程度。对任意不可用执行配置，批量“改用这个 API” MUST 原子更新成员配置与引用，失败时整体保持原状。

#### Scenario: 无 CLI 的用户完成建队

- **GIVEN** 三套 CLI 均不可用且一个 DeepSeek 档案已就绪
- **WHEN** 用户用 AI 生成并创建团队
- **THEN** AI 建队由 Pi 执行，创建前逐名显示 Pi 档案、模型和思考程度
- **AND** 保存后的团队可以直接发起首个任务。

### Requirement: Pi Host 与原生依赖进入桌面产物

Source: `docs/product/prd.md#开发域-mvp`

Desktop build/dist MUST 包含 Pi Host entry、精确锁定的 Pi SDK/adapter 代码及 macOS arm64 所需原生依赖。打包应用 MUST 能启动、停止和 resume Pi Host，且退出后零普通 helper；缺失或不兼容依赖 MUST 在构建或能力检查时 fail closed，不得在用户发送后才静默换 CLI。

#### Scenario: 打包应用执行 Pi 首任务

- **GIVEN** 安装态 macOS arm64 应用和已就绪 DeepSeek 档案
- **WHEN** 用户从真实页面发起受控编码任务并退出应用
- **THEN** Pi Host 完成工具循环、结果持久化与有界退出
- **AND** 应用退出后不残留 Pi Host 或其普通 helper。

### Requirement: Provider 档案引用与团队写入同成同败

Source: `docs/product/pages/agent-teams.md#provider-引用与团队生命周期`

团队创建、AI 创建、成员/团队复制、官方更新、成员删除和团队删除 MUST 与对应 Provider 引用在同一用户可见提交中完成。失败时团队结构与引用 MUST 一起保持原状；解除团队引用 MUST NOT 解除可恢复会话、草稿、任务或一次性执行的冻结引用。

#### Scenario: 复制团队引用保存失败

- **GIVEN** 源团队成员使用 Provider 档案 P
- **WHEN** 复制团队时 P 的新增引用提交失败
- **THEN** 新团队不可见且 P 的引用列表不增加半成品
- **AND** 源团队与既有会话保持不变。
