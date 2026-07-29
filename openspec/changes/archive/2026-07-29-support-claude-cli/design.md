# 设计：support-claude-cli

## 1. 设计基线与边界

Claude Code 作为既有 execution driver registry 下的第三个 adapter：

```text
Agent Team static profile registry
        │ snapshot { cli, model, effort }
        ▼
local-console immutable run context
        │ hard route, never fallback
        ▼
execution driver registry
  ├─ Codex driver
  ├─ Claude headless driver  ← 本 change
  └─ Kimi ACP driver
```

依赖方向保持 `console-ui → desktop-shell → local-console driver interface`。Claude adapter
位于 `src/`，不读取 Electron IPC、团队目录或 UI 状态；desktop 继续只把完整 profile、
workspace 与 managed attachments 注入 runtime。GitHub runner 继续直接走 Codex。

因此本 change 不增加 architecture SVG：模块职责、依赖方向和数据流拓扑不变，只在
既有 registry 内增加同级 adapter。三行 onboarding 是已有页面内的布局变化，见
`wireframes.md`。

外部协议依据：

- CLI/headless 参数：
  https://code.claude.com/docs/en/cli-usage
- model alias、effort 与 Fable 最低版本：
  https://code.claude.com/docs/en/model-config
- headless stream-json 与 session：
  https://code.claude.com/docs/en/headless
- 认证状态：
  https://code.claude.com/docs/en/authentication
- 原生安装：
  https://code.claude.com/docs/en/setup
- permissions 与 sandbox：
  https://code.claude.com/docs/en/permissions
- subagents / agent teams：
  https://code.claude.com/docs/en/sub-agents 和
  https://code.claude.com/docs/en/agent-teams

实施时若官方当前 help 与文档冲突，以目标最低版本及当前受测 CLI 的 machine-readable
行为为准，并用 contract test 固定，不能在生产代码里猜测另一套参数。

## 2. Profile registry 与数据迁移

### 2.1 类型和静态 registry

```ts
type ExecutionCli = "codex" | "claude" | "kimi";

const CLAUDE_MODELS = {
  fable: {
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
  },
  sonnet: {
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
  },
  opus: {
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
  },
};
```

profile parser 仍只要求 non-empty model/effort 并允许历史未知值读取；新选择和保存用
registry 校验。`DEFAULT_EXECUTION_PROFILE` 不变，避免升级后改变任何未配置成员。

Claude 的账号/组织可用性不属于 registry：团队详情不 spawn Claude、不调用认证或
模型探针。`fable` 的账号可用性在真实启动时裁决。`default`、`best` 与 `opusplan`
会让实际模型动态变化，不能满足 profile 精确冻结；完整版本 ID 与 1M alias 更新频繁；
`haiku` 不符合当前 model+effort 联动字段，因此都不进入首版新选择。Sonnet/Opus alias
在部分 provider 解析到不支持 `xhigh` 的模型并静默降为 `high`，所以两者只提供跨
provider 共同支持的四档；Fable 官方明确支持五档，可以提供 `xhigh`。

### 2.2 SQLite table rebuild

现有 `session_agent_team_members.execution_cli` 内联 CHECK 只允许两值，SQLite 不能
原地修改。迁移在独占事务中：

1. 读取 schema version，已完成则 no-op；
2. 暂停 foreign key enforcement；
3. 创建相同列、主键、外键、排序与 NOT NULL 约束的新表，只把 CHECK 扩为
   `('codex','claude','kimi')`；
4. `INSERT ... SELECT` 全量复制，校验行数与关键列；
5. 交换表名、重建索引；
6. 执行 `PRAGMA foreign_key_check`，成功后提交并恢复 foreign keys。

任何一步失败均回滚，旧表继续可用。测试必须从真实旧 schema 迁移，覆盖重复启动
幂等、旧 profile 行逐列不变、NULL legacy 行仍为 NULL、外键和 member order 保留。

## 3. 可执行文件发现与启动

把 Kimi 当前可靠发现逻辑抽成参数化 resolver：

```ts
resolveCliExecutable({
  commandName,
  hostPath,
  fallbackAbsolutePaths,
})
```

语义保持：

- 按 host `PATH` 顺序检查，首个存在 candidate 即权威；
- 权威 candidate 必须是 executable regular file，否则返回稳定错误，不继续 fallback；
- PATH 完全没有 candidate 才检查 CLI 自己的官方默认路径；
- 使用 host home 推导默认路径，不使用 managed runtime `HOME`；
- 返回 absolute path，spawn 永远 `shell: false`；
- child `spawn` 成功事件在有界时间内发生后才写输入。

Kimi fallback 保持 `~/.kimi-code/bin/kimi`；Claude 新增
`~/.local/bin/claude`。resolver 纯逻辑与 fs/spawn 边界分别测试，防止重构改变 Kimi
优先级和失败分类。

Claude driver 每次 full/resume 都在 protocol spawn 前，对 resolver 返回的同一绝对
路径执行一次有界 `--version` 并解析 semver。版本低于 `2.1.170` 时返回稳定
`unsupported-version` 与结构化 `update-claude` action，禁止执行 `-p`、生成/写入
canonical session link 或调用其他 driver。版本检查 spawn/error/timeout 也按安全错误
失败，不回退到 onboarding 缓存；这样即使用户跳过引导、运行后降级或导入其他机器的
Fable 配置，运行路径也不会把旧 CLI 协议错误变成崩溃。

## 4. Claude headless protocol

### 4.1 命令与运行配置

普通 Agent full 由 adapter 生成 UUID S：

```text
<absolute claude> -p
  --output-format stream-json
  --verbose
  --include-partial-messages
  --session-id S
  --model <snapshot.model>
  --effort <snapshot.effort>
  --permission-mode auto
  --disallowedTools <internal-agent deny rules>
  --add-dir <managed attachment directory>
  <prompt>
```

resume 使用同样的 frozen model、effort、cwd、tool policy 与 prompt，但把
`--session-id S` 换成 `--resume S`。禁止 `--continue`、session picker、最近 session
和 filesystem mtime。参数按数组构造，用户消息、团队内容与附件名不进入 shell。

`auto` 对齐 Kimi 普通 Agent 的既有自动执行权限语义；Moebius 不使用
`bypassPermissions`。为保证 snapshot effort 不被宿主配置覆盖，子进程删除
`CLAUDE_CODE_EFFORT_LEVEL`；CLI 的 `--model` 与 `--effort` 必须出现在 full/resume。

内部委派使用三层硬边界：

1. `--disallowedTools` 至少包含 `Agent`、兼容旧名 `Task`、`AskUserQuestion`、
   `TeamCreate`、`TeamDelete`、`SendMessage`、`TaskCreate`、`TaskGet`、`TaskList`、
   `TaskUpdate`、`TaskOutput`、`TaskStop`；
2. 从子进程环境删除 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`、
   `CLAUDE_AUTO_BACKGROUND_TASKS` 与 `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`，并设置
   `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`；
3. 不传 `--forward-subagent-text`；init 事件的 `tools` 不得出现上述 Agent/team
   工具，出现即把本次协议视为失配，在接受任何可见 assistant/tool 事件前 fail closed。

普通 Agent 使用 Claude 原生配置加载语义：adapter 不传 `--safe-mode`，不传
`--setting-sources`、`--strict-mcp-config` 或 `--disable-slash-commands`，也不创建
替代 settings；adapter 及 Moebius 其他模块不得查找、读取、解析、复制、转换或管理
用户/项目 Claude 配置。Claude 自身最终加载哪些 CLAUDE.md、settings、hooks、MCP、
skills、plugins、custom commands 或 custom agents 属于上游行为，不进入本 change 的
实现与验收矩阵。adapter 不接受用户追加任意 flags，也不允许加载配置覆盖公共 deny/env
边界；即使 settings 的 `env` 请求启用 agent teams，也不能重新加入被 CLI deny 删除的
工具，init inventory 再做 fail-closed 核验。AI 建队始终使用第 7 节的隔离 profile。

### 4.2 session id 与输出状态机

JSONL parser 设单行和累计字节上限，只接受 object line。状态机：

1. full 前生成 S，resume 前读取 canonical S；
2. 等待 `system/init`，要求其 session id 精确等于 S；未给出、冲突或 init 前终止均
   fail closed；
3. `--include-partial-messages` 产生 `type:"stream_event"` JSONL；只接受嵌套
   `event.type:"content_block_delta"` 且 `event.delta.type:"text_delta"` 的
   `event.delta.text`，按顺序追加为主 assistant 可见 Markdown；thinking、tool input、
   tool result、带 `parent_tool_use_id` 的子 Agent 内容与 protocol metadata 不进入
   公开时间线；
4. terminal result 的 session id 若存在也必须等于 S；
5. 只有经过 id 核验的 S 才能写 execution session link；
6. malformed、oversized、重复冲突 init 或 result mismatch 都有限失败。

如果 CLI 在 init 后、terminal result 前失败，canonical S 已有协议证据，应立即绑定，
后续只能 resume S。若从未观察到匹配 init，则重试仍可走首次 full。该边界与现有
Codex/Kimi external identity 契约一致。

### 4.3 附件

所有附件先由 runtime 复制到 run 级 `input-attachments/` 并生成有序 manifest；prompt
只引用 managed absolute path、媒体类型和安全 display name，并通过 `--add-dir` 授权
managed attachment directory。Claude 使用 Read 工具
读取图片和普通文件；PNG/JPEG/GIF/WebP 由 Claude 的 Read 视觉能力处理，SVG 仍作为
普通文件。原始用户路径不直接交付，managed copy 或 manifest 失败会在 spawn 前终止。

Claude 不具备 Kimi reverse RPC，故 adapter 不伪造文件传输协议。cwd、permission
profile 与 managed path 授权必须让本次 run 可读 workspace/attachments，同时
对未授权路径 fail closed。附件失败不触发 Codex/Kimi。

### 4.4 取消、watchdog 与诊断

沿用 runtime 的 idle/max-duration 与 AbortSignal。取消过程幂等：

1. 尚未 spawn：取消启动并有限 settle；
2. 已 spawn：SIGINT，等待 grace；
3. 未关闭：SIGTERM，等待 grace；
4. 仍未关闭：SIGKILL，等待最终 bounded settle。

每种 signal 最多一次；outer close 不追加 signal。stdout/stderr 原文只写 run 诊断目录，
普通 timeline 只获得 stable code 与安全说明：

- missing / non-executable / unsupported-version / spawn-failed；
- auth-required；
- invalid model/effort 或 permission/tool-policy rejected；
- rate-limit / billing / service unavailable；
- resume unavailable / session-id mismatch；
- protocol malformed/oversized、nonzero exit、idle/max timeout、cancelled。

分类器只匹配受测 machine-readable event/code；未知 stderr 不直接展示，回落到通用失败。

### 4.5 fake CLI 与配置表面的可断言信号

fake CLI 必须在任何 fixture 输出前保存脱敏 argv/env 证据，协议测试逐项断言：

- full 恰有 `--session-id S`，resume 恰有 `--resume S`；两者都有
  `--include-partial-messages`、冻结 model/effort、`auto` 和完整 deny list，且都没有
  `--continue`、`--forward-subagent-text`；
- `CLAUDE_CODE_EFFORT_LEVEL`、`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`、
  `CLAUDE_AUTO_BACKGROUND_TASKS`、`CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` 不存在，
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`；
- 普通 Agent 恰好不含 `--safe-mode`、`--setting-sources`、`--strict-mcp-config`、
  `--disable-slash-commands` 或 `--tools`；Moebius 对 Claude 配置路径/内容的读取、
  解析、复制与 replacement-settings 写入调用次数均为零；
- builder 恰有 safe-mode、dontAsk、Read/Glob/Grep、strict MCP、disable slash 与 JSON
  schema，且没有 Bash/Edit/Write/NotebookEdit；
- 普通 Agent init fixture 只验证 `tools` 不含 Agent/team tool；不检查 MCP、skills、
  plugins、custom agents 等 Claude 原生加载结果；
- text delta fixture 在 terminal result 前产生可见 Markdown；thinking、tool、
  `parent_tool_use_id` 和最终重复 assistant 文本不会重复发布。

不为普通 Agent 建立 CLAUDE.md/hooks/MCP/skills/plugins/custom-agent sentinel，也不把
Claude 是否加载这些表面作为通过条件。AI builder 的隔离 fixture 保持独立：其
safe-mode、strict-MCP、disable-slash、只读 tools 和 init inventory 仍必须证明隔离
边界生效。该 fixture 不能替代第 10 节要求的已登录 full/resume/附件/取消硬门。

## 5. local-console 接入

- snapshot、run execution context、driver registry 与 execution session link 的 CLI
  union 增加 `claude`。
- full/resume 都从 immutable run context 取 profile；resume planner 同时核验 session、
  team snapshot、role、workspace、persona、engine 与 profile fingerprint。
- Claude session link 只有在第 4.2 节证据边界满足后写入。冲突、缺失或 provider 报告
  session 不存在时只做一次 resume，进入现有“原执行已经无法继续”，不发起 full。
- first message、普通消息、handoff、retry、rerun、恢复都走同一个硬路由；driver
  失败时另外两套 driver 的调用次数必须为零。
- legacy NULL snapshot 与旧 Codex links 读取逻辑不改。

## 6. Onboarding readiness 与安装

### 6.1 Readiness

Claude 检查状态机：

1. 解析 `claude --version`，低于 `2.1.170` 为 unsupported-version；
2. 执行 `claude auth status --json`；
3. exit 0 且 machine-readable 结果表示 logged in 才 ready；
4. exit 1 的未登录结果为 needs-login；超时、非法 JSON 或其他协议异常为 unavailable。

不发送 `-p`，不产生推理费用，不创建 session，也不尝试动态 model enumeration。
三 CLI 各有独立 revision；全局 gate 是 `some(status === "ready")`。检查 reducer 必须
覆盖父级重渲染、回调身份变化、慢结果、失败结果和旧 revision 迟到。

真实兼容验收发现 Kimi readiness 仍直接 spawn 命令名，和 runtime 第 3 节的 resolver
语义分叉。修复后 onboarding MUST 直接复用 `resolveKimiExecutable`：同样按 host
`PATH` 选择首个权威 candidate，PATH 无候选时检查 `~/.kimi-code/bin/kimi`，权威候选
不可执行时 fail closed。版本检查与后续 `provider list --json` 必须绑定这次解析出的
同一 absolute path；capability probe 传入的命令名只是协议占位，受控 runner 必须忽略
它，不能在第二阶段重新走 GUI PATH。这样 readiness、团队兼容提示、AI 建队选择和实际
runtime 对“本机 Kimi 是否存在”的判断保持同源。

### 6.2 安装与更新

renderer 只能提交受信任 action DTO：

```ts
type CliMaintenanceAction =
  | { kind: "install"; cli: "codex" | "claude" | "kimi" }
  | { kind: "update"; cli: "claude" };
```

Claude install registry entry 固定为官方 URL；主进程分别 spawn `curl` 和 `bash`，
通过 Node stream 连接，`shell: false`，不使用 `exec` / `bash -c`。Claude update 必须
复用 backend 最近一次 readiness 或 runtime gate 解析到的权威绝对路径，以
`spawn(absoluteClaude, ["update"], { shell: false })` 参数化执行；renderer 不得提供
path/command/args。安装/更新任务共用生命周期、阶段、取消、超时、close 确认和完成后
单 CLI 复检；成功只复检 Claude，失败仍保留旧版本与独立重试入口。

聚合从两项改为任意 1–3 项，不保存成 bitmask 或双值特判。应用退出列出所有 running
task 并等待所有进程 close；某项完成只更新自身与聚合计数。

## 7. AI 建队

选择函数只依赖最近一次完整 readiness，并固定保持已有 Codex/Kimi 顺序：

```ts
selectBuilderCli(ready): "codex" | "claude" | "kimi" {
  return firstReady(["codex", "kimi", "claude"]);
}
```

创建 draft 时一次保存选择、profile、isolated cwd 和 session identity。Claude builder：

- 使用 `--json-schema` 约束 `clarifying | proposal`；
- 使用 `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep
  --strict-mcp-config --disable-slash-commands`，并继承第 4.1 节 Agent/team deny 与环境
  清理；
- 不加载 `CLAUDE.md`、settings、hooks、MCP、skills、plugins、custom commands 或
  custom agents，也不加载项目 `AGENTS.md`；
- full 使用 draft 生成 UUID，取得匹配 init 后立即持久化；
- submit/adjust/retry/唯一 repair 都 `--resume` 同一 UUID；
- 保留既有一次 repair、idle/max-duration、revision 与 stale result 丢弃规则。

Claude 失败保留 draft conversation 与最后有效 proposal；不能改用 Codex/Kimi。

## 8. UI 映射

- profile editor 从三 CLI registry 读取；切换 Claude 的 compatibility default 固定为
  `sonnet/high`。model 切换按交集保留 effort，否则使用该 model 的官方 default effort
  `high`。
- onboarding 用数据驱动三行列表，不复制三套 reducer/组件。footer gate、重新检查、
  安装/更新聚合和 compatibility 都基于 CLI-keyed map。Claude
  unsupported-version 行与 runtime 版本失败都映射到同一受信任 update action。
- 历史未知 profile、独立 draft、save failure、member switch、parent rerender、
  async callback identity 变化的现有契约必须覆盖 Claude。

## 9. 权衡

- 选择静态 Claude registry而非动态 model discovery：与 Agent Team 当前产品契约一致，
  onboarding 也能无推理完成；代价是新模型需随 Moebius 发布更新。
- 选择应用生成 UUID + 精确核验而非让 Claude 自动选择最近 session：可证明 identity，
  代价是 adapter 必须维护 JSONL 状态机。
- 普通 Agent 选择 `auto` 而非 bypass permissions：与 Kimi 既有自动执行语义对齐，
  同时保留 Claude 自身安全裁决；AI builder 用 `dontAsk` + 只读 tools，避免无人可见
  的确认等待。
- AI builder 固定 `Codex → Kimi → Claude`，保持原有 Codex/Kimi 选择行为不变；选择在
  draft 创建时冻结，不引入动态 fallback。

## 10. 风险与回滚

- CLI JSONL 事件随版本变化：最低版本门、fixture contract test、bounded parser 与
  unknown-event 忽略；协议关键事件缺失则安全失败。
- 用户跳过 onboarding、运行后降级 CLI 或导入其他机器的 profile：每次 full/resume
  重新检查实际 executable；旧版在任何 session 副作用前失败并提供可信更新动作。
- SQLite rebuild 损坏旧会话：事务、row count、foreign_key_check、旧 schema fixture
  与重复迁移测试；失败回滚旧表。
- 通用 resolver 重构回归 Kimi：先用现有 Kimi 测试锁定行为，再抽取；Kimi 默认路径和
  PATH 权威规则不可变。
- 三行 UI 造成窄窗口溢出：用 `wireframes.md` 的单卡三行与内部滚动约束做真实 DOM/
  geometry 验收。
- 当前本机未登录 Claude：实现阶段可完成 fake CLI 全协议验证，但 code-verified 前必须
  在已登录环境补真实 full + resume + cancel + attachment 验收；若无法提供登录环境，
  change 保持未完成，不以 fake 测试替代。

回滚时可以禁用 Claude registry/driver 注册和 onboarding 行，但不得回滚已完成的 SQLite
schema widening；扩大的 CHECK 向后兼容旧数据，保留它比反向重建更安全。
