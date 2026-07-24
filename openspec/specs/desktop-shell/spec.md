# desktop-shell 规格

## 域定位
`desktop-shell` 负责把 runner 与 observer 装配成一个纯本地桌面应用（Electron 壳）：启动应用即启动当前全部功能，直接调用本机 codex CLI。壳层只做装配、子进程监管、环境自检与更新提示，不承载任何业务规则；runner 行为事实源在 `github-issue-runner`，本地操作台与 observer 呈现事实源在 `local-console`，目标账本事实源在 `goal-ledger`。终端形态（`pnpm start` / `pnpm observer`）继续有效且行为不变。

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
- MUST 启动应用即依次完成：数据根解析 → PATH 修复 → 首启种子拷贝 → 环境自检 → 启动 observer 服务 → 启动 main 进程拥有的 local console server → 派生 runner 子进程 → 打开操作台主窗口。
- MUST 持有单实例锁：第二个应用实例启动时激活已有窗口后退出，NEVER 出现两个实例同时派生 runner 或并发写 `.state/`。
- MUST 在种子拷贝失败时不派生 runner 子进程，并把失败原因呈现在状态页；NEVER 让 runner 在缺失 `config.toml` 的数据根上静默启动失败。
- MUST 在关闭主窗口时先停止 runner 子进程（温和信号，超时后强杀）、再关闭 local console server 与 observer，然后退出应用；NEVER 留下孤儿子进程。

### 数据根
- MUST 打包态数据根默认为 `~/.moebius`，开发态默认为仓库根；`MOEBIUS_DATA_ROOT` 环境变量为最高优先级覆盖。
- MUST 把 runner 子进程工作目录设为数据根，使 `.state/` 等相对路径状态文件落在数据根下。
- MUST 让 `WORKDIR_ROOT` 默认派生自数据根（`<数据根>/workdir`），NEVER 以应用包或源码目录为基准。防止 workdir 落在应用包 / 源码附近 MUST 由该默认值本身保证，NEVER 依赖各入口逐个注入环境变量；`MOEBIUS_WORKDIR_ROOT` 仅作显式覆盖（如放到独立磁盘）。
- MUST 首启把 `agents/`（含 `ceo-scripts/`）与示例 `config.toml` 种子拷贝到数据根；已存在的文件 NEVER 覆盖。
- MUST 保持 `src/config.ts` 在未设置数据根环境变量时行为与终端形态完全一致，且此时 `WORKDIR_ROOT` 落在（作为数据根的）仓库根下。

### observer 边界
- MUST 在壳内以 `127.0.0.1` + 动态端口启动 observer，并把实际端口呈现在状态页。
- MUST 保持 observer 只读旁路语义：壳层 NEVER 给 observer 增加写接口、操作按钮或 runner 控制能力；启停 runner 属于壳层主进程能力。

### 操作台主窗口
- MUST load the desktop operator console as the default BrowserWindow content after application boot.
- MUST use an integrated hidden-inset titlebar for the macOS main window so traffic-light controls visually belong to the console rail.
- MUST provide a safe renderer drag region for the integrated main window while keeping interactive controls usable.
- MUST keep status and observer diagnostics reachable from the operator console, but they must not be the default main-window experience.
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
- MUST prevent the runner child from starting a duplicate local console server when the desktop main process already owns it.
- MUST close the local console server during desktop shutdown along with runner and observer.

### runner 子进程监管
- MUST 用显式状态机监管 runner 子进程：停止 / 启动中 / 运行中 / 已崩溃。
- MUST 在子进程异常退出后按退避策略自动重启；连续崩溃达上限（3 次）后停住并在状态页呈现失败原因与日志位置。
- MUST 把壳层主动停止（退出收尾）与异常退出区分开：主动停止 NEVER 触发自动重启。
- MUST 捕获 runner 子进程的 stdout/stderr 并落盘到数据根 `logs/` 下（按启动分文件），供崩溃排查；日志写入失败 NEVER 中断 runner 运行。

### 环境自检与 PATH
- MUST 在 macOS 图形进程内做 PATH 修复（合并登录 shell 的 PATH）；读取失败时保底沿用原 PATH。

### 更新
- MUST 让正式 macOS 应用通过 GitHub Releases 检查版本，有新版时跳转到 Apple Silicon 下载页。
- MUST 把版本比较与下载页决策保持为纯逻辑模块。

### 架构约束
- MUST 把壳层业务逻辑（数据根解析、种子拷贝计划、自检解析、子进程状态机、更新分支）拆为不依赖 Electron 运行时的纯模块并配单元测试；装配层 NEVER 承载业务规则。
- MUST 限定 preload IPC 为窄口：状态快照推送、local console URL、打开诊断状态页、打开观察页、打开数据目录、检查更新；NEVER 暴露配置写接口。
- MUST NOT 把 runner / observer 的行为规则复制进本域；本域只引用它们的编程入口（`start()`、`startObserverServer()`）。

## 场景

### 场景 DS.T4.1：主窗口默认是操作台
Given the desktop app has finished booting
When the main BrowserWindow finishes loading
Then it displays the local operator console
And the user can reach status/observer diagnostics from an auxiliary action.

### 场景 DS.T4.2：桌面形态只有一个 local console server
Given desktop main process starts a local console server
When runner child starts
Then runner child does not start a second local console server
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
And the IPC does not write SQLite, configuration, or runner state by itself.

### 场景 DS.T4.7：renderer 仍走安全边界
Given the renderer has received a selected folder path
When it creates or updates a local project
Then it calls the loopback local console API
And it does not use Node integration or direct filesystem access.

## Agent 团队存储

本节规则从 `console-ui` 迁入：磁盘布局、内置团队播种与结构有效性判定属于壳层数据责任，`console-ui` 只消费这里给出的状态与可用性。

### Requirement: Team storage layout and write ownership

- MUST store teams under `<dataRoot>/teams/`, where `<dataRoot>` is resolved by the existing `resolveDesktopDataRoot`.
- MUST place built-in teams under the reserved `<dataRoot>/teams/.system/` subtree and user teams as siblings directly under `<dataRoot>/teams/`.
- MUST give built-in and user teams the same on-disk shape: `team.json` plus `members/<slug>/AGENT.md`.
- MUST store only the team name, one-line description, primary agent slug, and member order in `team.json`.
- MUST NOT store member display names or member descriptions anywhere except each member's own `AGENT.md`.
- MUST reject every write request targeting a team under `.system/` at the data layer, independently of whether the UI disabled the corresponding control.
- MUST NOT convert a built-in team into a user team as a result of any external file modification.

#### Scenario: Built-in team write is rejected below the UI

- **GIVEN** a built-in team exists under `<dataRoot>/teams/.system/`
- **WHEN** a write request targeting that team or any of its members reaches the data layer without passing through the UI
- **THEN** the request is rejected with an explicit error
- **AND** no file under `.system/` is modified.

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

- MUST package the repository's `seeds/teams/` directory into the installer as `seed/teams`.
- MUST compare the content fingerprint of `seed/teams` against `<dataRoot>/teams/.system/.teams-seed.marker` on startup.
- MUST replace the entire `.system/` subtree when the fingerprint does not match, and MUST skip seeding entirely when it matches.
- MUST perform the replacement by unpacking to a temporary location and then swapping atomically, and MUST write the marker file only after the swap succeeds.
- MUST NOT read, write, move, or delete anything outside `.system/` during seeding.
- MUST NOT apply the existing `buildSeedCopyPlan` skip-if-destination-exists rule to built-in teams; that rule MUST remain unchanged for `agents/` and `config.toml`.
- MUST keep the previously seeded `.system/` subtree usable when seeding fails, rather than leaving it emptied.

#### Scenario: Upgrade delivers improved built-in teams

- **GIVEN** a user installed an earlier version and its built-in teams were seeded
- **WHEN** the user upgrades to a version whose `seed/teams` content differs
- **THEN** `.system/` is replaced with the new content
- **AND** every user team directory is byte-identical to before the upgrade.

#### Scenario: Interrupted seeding does not leave a partial built-in area

- **GIVEN** seeding is in progress
- **WHEN** the process is killed before the marker file is written
- **THEN** the next startup finds a mismatched fingerprint and runs the full seeding flow again.

#### Scenario: Removed built-in team falls back rather than dangling

- **GIVEN** a built-in team existed in the previous version and is absent from the new `seed/teams`
- **WHEN** seeding replaces `.system/` and that team was recorded as the last used team
- **THEN** the last-used record falls back to the first built-in team
- **AND** existing sessions keep their history and the team version loaded at creation time.

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

## Requirement: #14 桌面运行名单只来自会话团队
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 从会话绑定团队的内容快照解析名单并把主 Agent 排在首位；没有团队绑定的存量会话 MUST 按已登记兼容契约回退共享 agents 目录。系统 MUST NOT 在已绑定团队删除或需要修复时使用共享 agents 顶替，也 MUST NOT 把未绑定存量会话误判为团队已删除。

### Scenario: 绑定团队不可解析
- GIVEN 会话所绑团队已删除或需要修复且共享 agents 目录仍有文件
- WHEN 桌面壳为该会话解析运行名单
- THEN 返回可区分的团队错误且没有使用共享目录中的 Agent

### Scenario: 未绑定存量会话
- GIVEN 存量会话没有团队绑定且共享 agents 目录存在可用 Agent
- WHEN 桌面壳解析名单与团队健康
- THEN 使用共享目录名单并返回可继续状态

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

## Requirement: 对话菜单只提供归档与复制记录路径
Source: docs/product/pages/main-left-sidebar.md#复制对话记录路径

系统 MUST 在每个对话菜单中提供“归档”和“复制对话记录路径”两个操作。系统 MUST NOT 在当前侧栏范围内加入第三个对话操作或把复制操作放入项目菜单。

### Scenario: 打开对话菜单
- GIVEN 侧边栏存在一段用户发起的对话
- WHEN 用户打开该对话的菜单
- THEN 菜单项恰好为“归档”和“复制对话记录路径”

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

系统 MUST 只接受含 2–6 名成员、唯一稳定 slug、唯一主 Agent、结构化职责与交棒引用、有效接力示例的方案。系统 MUST NOT 提交过期 proposal revision 或未经验证的方案。

### Scenario: 当前有效方案创建并选中
- GIVEN 当前显示方案已通过业务校验且 proposal revision 为 N
- WHEN 用户以 revision N 请求创建
- THEN 系统一次创建全部成员及其有效 `AGENT.md`，登记普通用户团队并返回 selected 状态

## Requirement: AI 建队使用隔离的 Codex execution profile
Source: docs/product/pages/onboarding.md#AI-建队技术约束
Acceptance: onboarding#20

系统 MUST 为每个草稿使用独立 Codex thread、固定 developer instructions、output schema、只读 sandbox、隔离 cwd、2 分钟 idle timeout 与 10 分钟 max-duration timeout。系统 MUST NOT 使用普通 Agent 的 `--yolo` 参数、项目 `AGENTS.md`、用户 MCP 或个人指令。

### Scenario: 首轮与续轮均保持隔离
- GIVEN AI 建队草稿尚无 thread
- WHEN 用户提交首轮目标并在回复后继续调整
- THEN 首轮使用 `codex exec`、续轮使用 `codex exec resume <threadId>`，两轮参数均不含 `--yolo` 且输出受同一 schema 约束

## Requirement: AI 建队续轮显式保持只读 execution profile
Source: docs/product/pages/onboarding.md#AI-建队技术约束
Acceptance: onboarding#20

系统 MUST 在 AI 建队 `codex exec resume <threadId>` 续轮中显式传入 `--sandbox read-only` 与当前草稿的隔离 cwd。系统 MUST NOT 依赖 Codex thread state 隐式继承 sandbox 或 cwd 来满足隔离约束。

### Scenario: 续轮命令声明只读 sandbox 与隔离 cwd
- GIVEN AI 建队草稿已有 Codex thread id 与独立 isolated cwd
- WHEN 系统为下一轮构造 `codex exec resume <threadId>` 命令
- THEN 参数包含 `--sandbox read-only` 与 `--cd <isolatedCwd>`
- AND 参数不包含 `--yolo` 或其他绕过 sandbox 的选项

## Requirement: AI 建队失败有界并保留可恢复内容
Source: docs/product/pages/onboarding.md#第-2-步--ai-建队子流程
Acceptance: onboarding#21

系统 MUST 在非法输出时最多自动执行一次修复 turn，并在超时、resume 失败、二次非法输出或创建失败后进入可重试 failed 状态。系统 MUST NOT 无限自动重试、删除既有对话或最后有效方案、把失败当作已创建。

### Scenario: 修复一次后仍非法
- GIVEN 当前草稿已有对话和一版有效方案
- WHEN 新一轮 Codex 输出非法且唯一一次修复 turn 仍非法
- THEN 状态变为 failed、原对话和有效方案仍可见、动作只允许用户显式重试或取消

## Requirement: renderer 只接收白名单 AI 建队 DTO
Source: docs/product/pages/onboarding.md#AI-建队技术约束
Acceptance: onboarding#22

系统 MUST 只向 renderer 返回 phase、公开消息、方案预览、revision、安全错误摘要、可执行动作和 selected 终态的团队 id。系统 MUST NOT 返回 Codex thread id、原始 JSONL、schema 路径、cwd、内部堆栈或内部错误。

### Scenario: Codex 运行失败后的 IPC 响应
- GIVEN Codex 子进程在内部运行目录中产生 stderr 与堆栈
- WHEN renderer 通过 AI 建队 IPC 读取草稿
- THEN 响应只含安全 `error.code`、`humanMessage`、`canRetry` 与恢复动作，序列化结果不含任何内部路径或 thread id

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

### Requirement: Codex 未就绪时第 1 步硬门禁

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#3`

第 1 步 MUST 在 Codex 缺失或不可运行时禁用“继续”，展示固定安装命令 `brew install codex` 的复制操作和“重新检查”。只有一次新的检查返回可运行状态后才能放行。

#### Scenario: 修复缺失的 Codex

- **GIVEN** 第一次 Codex 检查返回缺失
- **WHEN** 用户尚未完成一次成功的重新检查
- **THEN** “继续”保持禁用
- **WHEN** 用户安装后点击“重新检查”且检查成功
- **THEN** “继续”变为可用。

### Requirement: 引导环境检查只检查 Codex

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#4`

引导环境门禁与桌面环境诊断 MUST 只执行 `codex --version` 检查。`env-doctor`、状态快照和辅助状态页 MUST NOT 检查或展示 gh CLI、gh 登录态、Claude 或 Node 环境。

#### Scenario: 执行环境检查

- **GIVEN** 用户进入引导第 1 步
- **WHEN** 主进程执行环境检查
- **THEN** 唯一被探测的命令是 Codex
- **AND** 其它工具的存在与登录状态不影响“继续”。

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

### Requirement: 四步进度指示与当前步骤同步

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#10`

引导底部 MUST 始终展示恰好四个步骤点和 `n / 4` 文本；当前点和数字 MUST 与正在显示的步骤同步。

#### Scenario: 从第 2 步前进

- **GIVEN** 用户正在第 2 步
- **WHEN** 用户点击“继续”进入第 3 步
- **THEN** 第三个步骤点成为当前点
- **AND** 数字由 `2 / 4` 更新为 `3 / 4`。

### Requirement: 四步共享稳定的引导布局

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#11`

四步 MUST 共享相同的顶部标题区与底部操作条，主体内容宽度 MUST 受 `max-w-lg` 约束。步骤切换不得改变顶底栏的结构位置。

#### Scenario: 连续浏览四步

- **GIVEN** 用户从第 1 步连续前进到第 4 步
- **WHEN** 每一步主体内容发生变化
- **THEN** 顶部标题和底部操作条保持同一布局骨架
- **AND** 主体不超过规定宽度。

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

- **GIVEN** 测试依次渲染 Codex 成功、缺失、团队选择、接力 slot、完成和 AI 建队状态
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

第 2 至第 4 步 MUST 提供“上一步”，第 1 步 MUST 不提供回退入口。返回 MUST 保留本次引导中的 Codex 通过状态和团队选择；从第 4 步返回第 3 步 MUST 增加一次接力重播轮次，使后续实现能从第一棒重新播放。

#### Scenario: 从第 4 步返回团队选择

- **GIVEN** 用户已通过 Codex 检查、选择团队并到达第 4 步
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

桌面打包配置与发布命令 MUST 只生成 macOS arm64 的 DMG 和 ZIP，产物名 MUST 明确包含 `mac-arm64`。Release workflow MUST 只在原生 arm64 macOS runner 上执行，并在打包前校验 runner 架构。正式发布 MUST NOT 生成 Windows、Linux、macOS x64 或 universal 产物。

#### Scenario: desktop tag 触发发布

- **GIVEN** `desktop-v*` tag 触发 Release workflow
- **WHEN** runner 通过架构检查并完成 Electron-builder
- **THEN** Release 只收到同版本的 macOS arm64 DMG 与 ZIP
- **AND** 没有 exe、AppImage、x64、universal 或其他平台产物。

#### Scenario: runner 不是 arm64

- **GIVEN** Release job 被调度到非 arm64 runner
- **WHEN** workflow 执行架构门禁
- **THEN** job 在安装包构建前失败
- **AND** 不发布交叉编译或架构不明的产物。

### Requirement: 正式更新策略只覆盖 macOS

Source: docs/product/prd.md#品牌与发行平台

正式产品 MUST 只承诺 macOS 的“检查更新 → 有新版则跳转下载页”路径。发布 workflow、官网文案和验收矩阵 MUST 只覆盖 Apple Silicon Mac。

#### Scenario: macOS 用户检查更新

- **GIVEN** 用户运行正式 macOS Apple Silicon 版本
- **WHEN** 检查到更新
- **THEN** 应用跳转到包含 Apple Silicon 产物的下载页
- **AND** 不向用户展示其他操作系统或 CPU 架构的下载选项。
