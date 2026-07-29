# 任务：support-claude-cli

实施顺序为 0 → 1 → 2 → 3 → 4 → 5 → 6。第 2 组依赖第 1 组的 profile/schema，
第 3–4 组依赖第 2 组 driver，第 5 组在所有表面完成后执行。第 6 组逐条给出可在真实
应用中复核的验收信号。

## 0. 方案与范围

- [x] 读取产品 PRD、当前 desktop-shell/local-console/console-ui spec、模块地图、Kimi
      实现与测试
- [x] 核验 Claude 官方 CLI 的 headless、session、permission、auth、Fable 与安装协议
- [x] 产品选择已确认：默认 `sonnet/high`、普通 Agent 不干预 Claude 配置、
      `Codex → Kimi → Claude`、全局最低 `2.1.170` 与禁止跨 CLI fallback
- [x] 更新受影响 PRD，写入 proposal、design、三个 spec delta 与 `wireframes.md`
- [x] 确认不需要 architecture SVG：只增加现有 registry 的同级 adapter，不改变模块
      依赖拓扑
- [x] 主理人核对本清单并明确放行代码实施

## 1. Profile domain、registry 与 schema

- [x] `ExecutionCli`、runtime/IPC/DTO unions 增加 `claude`，默认 profile 保持 Codex
- [x] desktop 与 console-ui 共用/对齐 Claude `fable`、`sonnet`、`opus` 及各自
      effort/model fallback；切换 CLI 的 compatibility default 固定 `sonnet/high`
- [x] 历史未知 Claude model/effort 继续作为 legacy custom，不自动保存或替换
- [x] SQLite table rebuild 把 CHECK 扩至三 CLI，事务、row-count、foreign-key check 完整
- [x] schema migration 测试：旧库、重复启动、旧 profile、NULL legacy、FK/顺序不变
- [x] 单测：CLI/model/effort 联动、默认值、非法空值、官方推荐/override/explicit 与复制

## 2. Claude executable 与 local-console driver

- [x] 先补 Kimi resolver 行为测试，再抽取通用 PATH-first/default-location resolver
- [x] Claude 发现 `PATH` 首个候选或 `~/.local/bin/claude`，绝对路径、`shell:false`
- [x] 每次 full/resume 对同一权威 executable 执行有界 `--version`；`<2.1.170` 在
      print-mode/session-link 前稳定失败并返回受信任 update action
- [x] full 参数：`-p`、stream-json、verbose、`--include-partial-messages`、应用 UUID、
      snapshot model/effort 与 `auto` permission
- [x] resume 参数：只 `--resume <canonicalId>`，保持同 profile/cwd/tool policy
- [x] 用 exact `--disallowedTools` 清单、agent-team/background env 清理与
      `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` 禁用内部 Agent/agent teams，并删除
      `CLAUDE_CODE_EFFORT_LEVEL`
- [x] 普通 Agent 不传 safe-mode/setting-sources/strict-MCP/disable-slash/tools，不创建
      replacement settings，不查找/读取/解析/复制/管理用户配置；不测试 Claude 最终
      加载哪些原生扩展
- [x] bounded JSONL parser 与 session state machine：init/result ID 精确核验、立即持久化
- [x] 只从 `stream_event/content_block_delta/text_delta` 增量发布主 Agent Markdown；
      thinking、parent_tool_use_id、tool/protocol 内容不进入公开 timeline
- [x] managed attachments：图片与普通文件 manifest、Read 路径、失败 fail closed
- [x] auth/model/effort/permission/rate-limit/billing/service/resume/protocol/timeout 安全分类
- [x] cancel/watchdog：pre-spawn、SIGINT → SIGTERM → SIGKILL、幂等与有限 settle
- [x] raw stdout/stderr 只落 run 诊断目录；renderer/timeline 不含 token、路径或 provider
      payload
- [x] registry 硬路由与 session link/recovery planner 增加 Claude；任何失败不调用其他 CLI
- [x] fake Claude tests：精确 argv/env、init tool inventory、full、resume、增量 text
      delta、init 后失败、ID mismatch、malformed/oversized、attachments、cancel 各阶段、
      旧版 gate、原生配置参数边界、错误分类与禁止 fallback
- [x] 既有 Codex/Kimi full/resume/cancel/discovery 测试全绿，证明 resolver 和 union 无回归

## 3. Desktop onboarding readiness 与安装

- [x] Claude version parser 与最低 `2.1.170` gate，旧版不调用 auth probe
- [x] `claude auth status --json` parser：ready、needs-login、unavailable、timeout、非法 JSON
- [x] readiness keyed map/revision 支持三 CLI，慢旧结果不得覆盖新结果
- [x] install registry 增加 Claude enum 与固定官方 URL，curl/bash 分进程 Node stream
- [x] maintenance registry 增加受信任 `update-claude`：只对 readiness 解析的权威路径
      `spawn(path, ["update"], {shell:false})`，renderer 不能提交 path/command/args
- [x] 同 CLI 去重、三 CLI 并发、1–3 项聚合、取消/超时/close/退出协调
- [x] renderer IPC 不能提交 command/URL/args，错误 DTO 保持脱敏
- [x] 安装/更新成功只复检 Claude；失败、取消和超时保持旧状态与独立重试
- [x] 单元/IPC 测试覆盖父级重渲染、回调身份变化、慢返回、失败返回与并发任务收敛

## 4. AI 建队与用户界面

- [x] AI builder 固定 `Codex → Kimi → Claude`，draft 创建后冻结且不 fallback
- [x] Claude builder 使用独立 UUID/session、isolated cwd、JSON schema、
      `--safe-mode` 与 `Read,Glob,Grep` 只读 tool profile
- [x] submit/adjust/retry/唯一 repair 精确 resume；失败保留对话和最后有效 proposal
- [x] Agent Team profile editor 增加 Claude 选项与 model/effort 联动
- [x] profile draft 覆盖 member switch、parent rerender、新 callback identity、保存失败
- [x] onboarding 三行状态、安装/更新按钮、全局重新检查、n 项聚合与任一 ready gate
- [x] runtime unsupported-version 显示同一受信任更新入口；更新完成保留失败 run 并要求
      用户显式重试，不自动创建 session
- [x] team card、第 4 步和新建对话的 Claude compatibility 提示一致
- [x] 窄窗口无页面级横向溢出，三行状态和 footer 操作可达；键盘与 aria-live 完整
- [x] Storybook/component tests 覆盖三 CLI 的 ready/missing/login/install/error 混合状态

## 5. 自动化验证与符合度反思

- [x] 定向 profile/schema/resolver/Claude driver/readiness/install/update/builder/UI 测试全绿
- [x] `pnpm test > /tmp/moebius-claude-test-final-rerun.log 2>&1`
- [x] `pnpm typecheck > /tmp/moebius-claude-typecheck-final.log 2>&1`
- [x] `pnpm --filter @moebius/console-ui check:storybook > /tmp/moebius-claude-storybook-final.log 2>&1`
- [x] `pnpm --filter @moebius/desktop build > /tmp/moebius-claude-desktop-final.log 2>&1`
- [x] 对照 PRD、proposal、design 与三个 spec delta 逐条反思，无遗漏、越界或重复事实源

## 6. 逐条真实运行验收清单

以下每条都必须记录“页面/入口、操作、可断言信号、证据路径”。fake CLI 可以证明协议
边界，但第 6.5 的真实 Claude 登录态执行不可由 fake 替代。

### 6.1 配置与选择

- [x] Agent 团队详情 → 任一成员运行配置：CLI 列表出现 Codex / Claude Code / Kimi；
      选 Claude 默认 sonnet/high；Fable 出现
      low/medium/high/xhigh/max，Sonnet/Opus 只出现 low/medium/high/max；保存、重开仍为
      Claude，且进程观测中没有启动任何 CLI
- [x] 打开带未知 Claude profile 的 fixture：显示“旧版自定义配置”，切成员和父级刷新
      不改值、不自动保存；主动选择受支持组合后才可替换
- [x] 创建新会话后再修改团队 profile：该会话继续显示/执行原冻结 profile，新会话才
      使用新 profile

### 6.2 Onboarding

- [x] 首次启动/回看引导第 1 步：三行独立显示；任一 ready 时继续可点；三行都不 ready
      时灰置；重新检查始终存在
- [x] Claude missing fixture：只出现固定官方命令和“安装 Claude Code”；点击后持续显示
      阶段，成功只复检 Claude，失败/取消提供独立重试且不泄露原始输出
- [x] Claude 已安装但未登录：显示真实版本与登录指引，不显示安装按钮；旧版本显示
      `2.1.170` 最低要求和「更新 Claude Code」，且 auth probe 调用次数为零
- [x] 点击旧版本更新：主进程只对 readiness 权威路径执行 `["update"]`，renderer
      无法替换 path/args；成功只复检 Claude，失败/取消/超时保留旧版本和独立重试
- [x] 同时运行三项安装：标题栏显示 `3 项 CLI 正在安装`，任一完成后计数准确下降；
      退出确认逐项列出并在进程 close 后才退出

### 6.3 调用与续接

- [x] 新建对话选择 Claude-bound 主 Agent 并发送首条消息：timeline 出现同一 Agent 的
      streamed Markdown；诊断证据显示 `--include-partial-messages`、`--session-id S`、
      model/effort 精确匹配，另两 driver 调用次数为零
- [x] 同一 Agent 再发消息、成员接力后返回、重试与重启恢复：都使用 `--resume S`，
      external ID 始终同一个；不出现 `--continue`、第二个 full 或最近 session
- [x] Claude 返回不同 session id / session 不存在 fixture：仅一次 resume，timeline
      显示“原执行已经无法继续”，没有 full 重建或跨 CLI 调用
- [x] 普通 Agent 边界 fixture：argv 不含任何配置抑制 flag，replacement-settings
      写入与 Claude 配置 locate/read/parse/copy 调用均为零；fake CLI 记录 exact
      argv/env，init 工具列表不含 Agent/team 工具。不得把 Claude 是否加载
      CLAUDE.md/hooks/MCP/skills/plugins/custom agents 作为验收项

### 6.4 附件、取消与错误

- [x] Claude-bound run 同时附 PNG 与普通文件：两者先进入 managed copy；Claude 回复
      能引用内容；公开 timeline 与 renderer DTO 不出现原始路径或 manifest 内部路径
- [x] 运行中取消：进程在有界时间终止，过程顺序符合 SIGINT → SIGTERM → SIGKILL 的
      必要子集，无孤儿进程、重复 signal 或无限 pending
- [x] 分别注入 missing、auth required、invalid model/effort、permission denied、
      rate limit、resume mismatch、malformed/oversized、idle timeout：timeline 显示
      对应安全可理解原因，另两 CLI 调用次数均为零，原始 stderr/token/path 不可见
- [x] 在跳过 onboarding、readiness 后降级 CLI、导入含 Fable 的外部团队三种路径下，
      用 `2.1.169` fake 启动 full/resume：每次只执行版本检查，`-p`、session-link 写入与
      其他 driver 调用均为零；timeline 不崩溃并显示更新入口，更新后只允许显式重试

### 6.5 真实 Claude CLI（已登录环境）

- [x] `claude --version` 与 `claude auth status --json` 通过最低版本和登录检查，且检查
      期间没有推理 session
- [x] 在临时 workspace 用产品真实 adapter 执行一次 full，得到非空 Markdown 与匹配
      session id；同 identity 执行一次 resume，确认上下文连续且 ID 不变
- [x] 真实 adapter 读取一张图片和一个普通文件，回复包含可核验事实；随后执行一次取消，
      进程有限关闭
- [x] 证据只报告版本、exit、匹配/不匹配、run/session 的脱敏标识与临时目录；不得提交
      登录凭据、完整 stdout/stderr、用户 home 路径或模型敏感输出
- [x] 上述真实 full、resume、图片、普通文件与取消任一未执行或失败时，change 不得标记
      `code-verified`，不得以 fake-only 结果降级替代

### 6.6 兼容性与范围护栏

- [x] Codex-only、Kimi-only 与 Codex/Kimi 混合团队既有真实运行验收仍通过
- [x] 三套 CLI 都 ready 时 AI 建队选择 Codex；Codex 不 ready 而 Kimi/Claude ready
      时选择 Kimi，证明新增 Claude 未改变已有 fallback
- [x] legacy NULL snapshot 仍运行不可变 Codex；数据库迁移前后行数、profile 与 FK 一致
- [x] GitHub mode 启动与定向测试证明 Claude driver 调用次数为零
- [x] `config.toml` Codex provider override、官方团队更新、普通 local start 行为无变化
- [x] Agent Team 页面打开/保存与普通 console mount 均不主动 probe Claude

## 7. 真实验收缺陷修正：Kimi readiness 与 runtime 同源

- [x] onboarding 注入并复用 `resolveKimiExecutable`，不再直接以命令名 `kimi` 判断存在性
- [x] Kimi `--version` 与 `provider list --json` 都绑定同一解析出的 absolute path，
      capability probe 不得退回命令名或重新解析 PATH
- [x] readiness 测试覆盖 GUI PATH 无候选但默认路径存在、PATH 候选优先、权威候选
      不可执行且不 fallback、PATH 与默认路径都缺失
- [x] 定向 readiness/capability/Kimi resolver/AI builder/UI 测试通过
- [x] 全量测试、typecheck、Storybook 与 desktop build 重新通过
- [x] 隔离真实 Electron 中 Kimi `0.29.2` 显示 ready，Kimi-only 与混合团队不再出现
      兼容警告，AI 建队 readiness 可选择 Kimi
- [x] 重新执行 Codex-only、Kimi-only、Codex/Kimi 混合真实运行，实际 engine 与可见
      结果保持通过
- [x] 更新符合度反思、合并修正规格并重新归档

## 8. QA 缺陷修正：三 CLI 文案完整扩展

- [x] AI 团队设计器 context label 复用三 CLI label helper，Claude-only 显示
      `Claude Code`，不得落入 Kimi 分支
- [x] 退出协调由纯函数生成单项/多项安装文案，按 Codex、Claude Code、Kimi 逐项列出
- [x] 中英文覆盖三套单项、三种双项和三项共 7 种非空组合
- [x] 组件测试覆盖 Claude-only 建队卡片与设计器 context label 一致
- [x] 定向测试、全量测试、typecheck、Storybook 与 desktop build 通过
- [x] 最终 Electron Claude-only 环境中，建队卡片与设计器都显示 Claude Code
- [x] 更新符合度反思并重新归档
