# desktop-shell spec delta：defer-runtime-validation-to-execution

## MODIFIED Requirements

### Requirement: Agent execution profile is saved per team member

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The desktop MUST save a complete CLI/model/effort profile for each stable team id and member slug.
Team list, detail, save and recommendation-restore operations MUST resolve only persisted bindings,
current applied recommendations and static profile validation. They MUST NOT spawn, probe, authenticate
or enumerate Codex or Kimi. Official members MUST distinguish recommendation from user override; user
teams and user-added members MUST use explicit profiles. Bindings MUST survive team relocation and
MUST NOT enter team content fingerprints.

### Scenario: Unknown but structurally valid model is saved

- GIVEN a member draft contains CLI Kimi and model/effort values `"  future-model  "` and `"  future-effort  "` unknown to this machine
- WHEN the team page saves the draft
- THEN `future-model` and `future-effort` are persisted for that team/member
- AND no Codex or Kimi process is started
- AND another team containing the same slug remains unchanged.

### Scenario: Static profile is invalid

- GIVEN model or effort contains only whitespace
- WHEN the renderer or IPC validates the save request
- THEN save is rejected with a field-safe reason
- AND the previous binding remains effective
- AND no CLI capability result is consulted.

## REMOVED Requirements

### Requirement: Execution capabilities are probed without inventing options

本 change 删除团队管理必须枚举本机 Codex/Kimi 能力、返回 capability snapshot 并据此判定
unable-to-verify / needs-adjustment 的要求。底层能力探针可以继续服务引导、AI 建队或未来用户
主动发起的运行环境诊断，但不再属于团队配置读取/保存链路。

## ADDED Requirements

### Requirement: Environment capability probing remains outside team management

Source: docs/product/pages/agent-teams.md#非目标
Source: docs/product/pages/agent-teams.md#Agent-运行配置
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

Execution capability probing MAY serve onboarding, AI team building or a future explicit runtime
diagnostics surface. The Agent Teams list/detail and profile mutation IPC MUST NOT expose capability
snapshots, refresh actions, unable-to-verify state or needs-adjustment state. Removing team-management
probing MUST NOT weaken onboarding's existing readiness, installation, revision or redaction contract.
The normal operator console MUST NOT start Codex/Kimi readiness checks on mount, shell-ready, team
navigation or message submission. It MAY consume readiness already produced by onboarding and MUST
preserve onboarding's post-install recheck while an installation initiated there is still completing.

### Scenario: Opening a team while both CLIs are missing

- GIVEN neither Codex nor Kimi can be resolved on PATH
- WHEN the user opens a valid team and switches between members
- THEN every saved static profile remains readable and editable
- AND team management exposes no runtime-health state
- AND onboarding readiness behavior is unchanged.

### Scenario: Opening the normal console does not probe both CLIs

- GIVEN onboarding is not active and no onboarding installation is completing
- WHEN the normal operator console mounts, receives shell-ready and opens Agent Teams
- THEN neither Codex nor Kimi readiness check is started
- AND an already available readiness snapshot may still drive the existing advisory compatibility copy.
