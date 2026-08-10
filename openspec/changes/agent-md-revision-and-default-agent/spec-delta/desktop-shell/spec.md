# desktop-shell delta：agent-md-revision-and-default-agent

## ADDED Requirements

### Requirement: Agent Markdown 修订带作者与人话摘要持久化

Source: docs/product/pages/agent-teams.md#编辑与保存-agentmd
Source: docs/product/flows/agent-evolution.md#一本地调教留痕

`AGENT.md` 每次成功保存（团队页保存或被读取到的 Finder 外部有效修改）MUST 落一条修订，MUST 至少包含完整内容、作者种类（`user | official | agent`）、发生时间。Finder 外部修改 MUST 记为 `user` 作者，与团队页内保存等价对待。修订 MUST 独立存储在团队内容目录之外，MUST NOT 出现在团队文件夹中。修订存储 MUST NOT 设置数量或时间上限。

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

#### Scenario: Finder 外部修改与团队页保存产生同等修订

- **GIVEN** 用户在 Finder 中直接修改一名成员的 `AGENT.md`
- **WHEN** 应用读取到该有效修改
- **THEN** 产生一条 `author=user` 的修订，与团队页内保存的修订结构一致
- **AND** 官方来源身份不因此改变。

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

## MODIFIED Requirements

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
