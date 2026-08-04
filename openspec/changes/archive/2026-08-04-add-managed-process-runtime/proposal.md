# 提案：add-managed-process-runtime

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/prd.md` | `#产品运行形态` | 增加会话所属的本地托管运行项，并确定正常退出回收、崩溃后清残留且不自动重启 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#托管运行项入口与面板` | 主会话顶栏按当前会话展示运行项状态、地址、有限日志与停止操作 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#托管运行项`、`#Agent-执行与恢复` | 三家 Provider 临时获得同一能力；结构化启动、不经 shell、不解析正文 JSON；Kimi 工具完成不等于回合成功 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#退出应用与恢复执行`、`#指标与验收` | 明确跨 Agent 回合、退出、崩溃清理、端口关闭和全局配置不改写的用户验收 | 已写入 |
| `docs/product/pages/agent-conversation.md` | `#验收标准`、`#非目标` | 托管进程与 Agent run 生命周期分离，并修正“无顶部状态”旧非目标 | 已写入 |
| `docs/product/pages/main-left-sidebar.md` | `#底部应用操作`、`#归档`、`#移除项目`、`#验收标准` | 托管运行项进入既有退出、归档和项目移除保护 | 已写入 |

产品决策来自 2026-08-03 本地共享时间线。用户确认采用「统一 stdio MCP 工具 + Moebius supervisor」，并接受：运行项跨 Agent 回合常驻；正常退出全部停止；崩溃后重启只清理残留，不自动重启。主理人已授予实现授权，但按团队流程本 change 写完后先停在方案核验点。

## 背景

当前 Provider 的终端工具只属于一次 Agent run。Agent 可以用后台 shell、double-fork 或 `nohup` 让 Storybook 等进程逃逸到 PID 1，但 Moebius 事后只看见一条命令文本，无法可靠取得最终进程组、端口、健康状态和停止权。于是 Agent 回复里的链接可能已经失效，用户仍需回终端手动启动或清理。

临时 spike 已验证普通 stdio MCP bridge 能让 Codex、Claude 与 Kimi 调用同一组 `managed_process` 工具，并由独立 supervisor 在 Provider turn 结束后继续持有进程。Codex 与 Claude 完成启动、跨回合查询和停止；Kimi 的工具调用及停止同样成功，但工具返回后 ACP `session/prompt` 可能不产生终局。该问题说明进程托管链路可行，同时要求首版把“工具成功”和“Provider 回合成功”分开收束。

只在共享提示中要求 Agent 输出约定 JSON 不能解决所有权：提示无法取得进程句柄，也无法防止 Provider 自行 fork。把所有普通命令都改由 Moebius 执行则会重造三家 Provider 已有终端能力，并扩大安全面。本 change 只接管需要跨工具调用或回合存活、需要用户持续监督的本地进程。

## 提案

1. 在 local-console composition root 内新增会话级 managed-process supervisor。它维护进程组、状态注册表、readiness、可选 endpoint、有界日志和 ownership manifest，并暴露 `start / list / inspect / read_logs / stop` 领域能力。
2. 新增普通 stdio MCP bridge。三家 Provider 每次 full 或 resume 都通过各自的单轮参数入口临时注入同一工具 schema；bridge 使用 Moebius 签发的会话能力调用 supervisor，不写 Codex、Claude、Kimi 的用户全局配置。
3. `start` 只接收 `kind + label + executable + args[] + cwd + readiness + endpoint`。`cwd` 是当前会话工作空间内的相对路径；endpoint/readiness 只接受 loopback；启动固定 `shell:false`，不接收 shell 字符串、会话 ID、任意宿主路径或 Agent 自报所有权。
4. supervisor 通过 Darwin `launchd` ownership adapter 登记带不可预测 service label 的 Moebius wrapper job；wrapper 以同一 job process group、结构化 argv 和 `shell:false` 启动目标并转发有限日志。正常停止先发送 SIGTERM，有限宽限后升级 SIGKILL；Moebius 正常退出等待 job 被 `bootout`。崩溃后重启只对 HMAC 验证通过的 manifest 所指向的精确 service target 执行 kill/bootout，不按 PID/PGID、同名命令或端口猜测归属，也不重新 bootstrap 旧命令。
5. 全局 Runtime Contract 在初始、增量和恢复 prompt 中都说明何时必须使用托管工具、禁止自行后台化。提示只引导工具选择，进程注册表不解析 Agent 正文、Markdown 链接或约定 JSON。
6. 主会话顶栏在当前会话有运行项时常驻显示入口；一个活动项显示名称与状态，多个显示数量。面板显示状态、可选打开地址、有限日志与逐项停止。最后一个活动项退出后入口保留为“已结束”，直到用户在面板明确清除已退出记录；确认后没有其他条目时入口立即消失。运行项不进入侧边栏状态点，不与 Agent run 或完整输出混为一体。
7. Kimi 在 managed-process MCP 调用已经返回后若 ACP 回合没有终局或真实进展，使用独立、集中可配的短收敛闸停止本轮等待并形成可重试 Provider timeout。已经成功托管的进程继续存在；工具返回不能提交成功 Agent 回复。

## 首版边界

- 支持单个独立 `service / task / watcher`，不做多服务依赖、启动顺序、工作流编排或容器替代。`task` 专指有自然终点、但用户明确要求跨当前 Provider invocation 继续执行或持续监督的有限任务；耗时长本身不构成托管理由。
- readiness 支持 `none / tcp / http / stdout-contains`；stdout 只做有界字面包含，不接受正则。endpoint 可选且只允许 `http://127.0.0.1` 或 `http://localhost`。
- 首版不提供 restart、编辑命令、自动端口发现、自动解析 Agent 输出链接、跨应用启动恢复或跨会话转移。
- 预期在当前原生工具调用内结束、结果会立刻被 Agent 消费的 Python、测试和构建继续走 Provider 前台终端，即使它可能运行数分钟；不得为了绕开工具时限把它后台化。只有明确需要跨工具调用／Provider 回合存活或由用户在运行项面板持续查看和停止时才使用 managed `task`。无法判断时保持前台且不托管，Moebius 不成为通用 shell。
- 首版生产 ownership backend 以正式发行平台 macOS arm64 的 `launchd` 为边界；非 Darwin 环境不注入该能力或由 `start` 返回稳定 unsupported，target spawn 必须为零，不降级为裸 PID/PGID 托管。
- 已退出条目保留到用户明确清除或当前应用生命周期结束，供用户看见异常和日志；下次启动不恢复列表，也不自动重启。

## A11／A14 与原始目标的必要对应

### A11：归档与项目移除

1. 原始目标把运行项放在“所属主会话右上角”，而首版又明确采用 session ownership；该顶栏与面板就是用户唯一的 list/log/stop 管理入口。
2. 归档会隐藏这个入口，项目移除还会撤销其工作空间。如果操作先成功、进程后停止，用户会得到仍运行但无法从产品找回的本地服务，直接违背“常驻显示并可停止”。
3. 因此 A11 只给现有归档／移除流程增加 reachability guard：普通归档阻止，用户明确强制移除时先停止；它不新增归档形态、不让 exited 瞬时记录持久化，也不把运行项做成全局任务管理器。

### A14：local CLI

1. 产品既有契约规定 Desktop 与 `pnpm start` 启动同一 local console，managed-process supervisor 也位于这个共享 composition root；这不是本 change 新增的 CLI 产品面。
2. 如果只接 Desktop `Command + Q` 而不接共享 server 的 `close()`，`pnpm start` 的 SIGINT/SIGTERM 会绕过同一 supervisor，留下本 change 正要消除的孤儿进程，并迫使实现维护第二套关闭语义。
3. 因此 A14 只验证 macOS 上既有 local entry 复用同一 ownership backend 和 close invariant；不新增 CLI 专属 UI、命令或持久运行模式。非 Darwin 首版只验证 unsupported/target spawn=0。

## 影响

主要影响：

- `src/local-console`：纯状态与校验、supervisor application、Darwin launchd ownership wrapper/manifest/log/readiness adapter、bridge IPC、HTTP DTO 与关闭顺序。
- `src/codex.ts`、`src/claude.ts`、`src/kimi.ts`、`src/local-console/execution-driver.ts`、`prompt.ts`：三家临时 MCP 注入、共享 Runtime Contract、工具完成通知及 Kimi 收敛闸。
- `desktop/src/desktop-shutdown-runtime.ts`、startup/runtime wiring：把 managed process 纳入退出计数、清理与崩溃残留 reconciliation。
- `desktop/src/console-page`、`packages/console-ui`：运行项轮询/请求编排、顶栏入口、面板、日志、打开与停止动作。
- `src/config.ts`：日志上限、readiness 频率与截止、停止宽限、Kimi post-tool settle deadline。
- local-console / desktop-shell / console-ui OpenSpec；归档时回流 `docs/architecture/managed-process-runtime.svg` 和 module-map。

必须保持：

- JSONL 会话事实、SQLite 投影和 Provider canonical session 的既有边界不被运行项临时状态替代。
- console-ui 只消费 DTO 与 callbacks，不导入 local-console、child process、HTTP 或 Electron adapter。
- 普通 Claude 不启用 `--strict-mcp-config`，不屏蔽用户原生配置；Codex/Claude 临时文件权限受限并在调用后删除；Kimi 通过 ACP `mcpServers` 传入。
- 任何 Agent 外部输入都不能形成 shell 字符串、任意 cwd、任意外部 URL 或其他会话的进程操作权限。

## 验收清单

| # | 可核查行为 | 必需证据 |
| --- | --- | --- |
| A1 | Codex 从真实 Electron 主会话启动 `python -m http.server` 或等价受控 HTTP 服务，Agent 回合结束和下一回合后同一运行项仍存在 | 入口：主页面目标会话；动作：发送启动指令并再发送一轮查询；信号：顶栏运行项、同一 processId、真实 PID/PGID、HTTP 200 |
| A2 | Claude 使用完全相同的工具 schema 完成启动、跨回合 list/inspect 和停止 | 入口：绑定 Claude 的真实 Electron 会话；动作：启动、下一回合查询、面板停止；信号：工具 payload、同一 processId、端口关闭 |
| A3 | Kimi 使用同一工具完成启动、跨回合查询与停止；若工具返回后 ACP 不终结，不无限卡忙 | 入口：绑定 Kimi 的真实 Electron 会话；动作：启动或停止触发已知悬挂路径；信号：MCP 返回、运行项真实状态、有限时间内 Provider timeout、可重试终局 |
| A4 | 当前会话有一个运行项时顶栏显示名称与状态，多个时显示数量；切换会话不串状态；最后一项退出后先保留事实，明确清除后入口消失 | 入口：真实 Electron 主会话顶栏；动作：依次启动两个运行项、切换会话、停止或等待最后一项退出并清除；信号：可访问名称、数量、面板条目与 sessionId 一致，未闪现上一会话条目；退出后可查日志，清除成功后无入口空位，失败时现场保留 |
| A5 | readiness 区分 spawn 与 ready，HTTP endpoint 可从面板打开并真实访问 | 入口：运行项面板；动作：观察延迟就绪服务后点击打开；信号：starting→ready 状态、系统浏览器收到已校验 loopback URL、HTTP 预期正文 |
| A6 | 查看日志只显示有界 stdout/stderr，溢出后保留尾部并标记截断 | 入口：运行项面板；动作：打开持续输出任务日志；信号：日志持续更新、truncated 标记、无环境变量/Provider 原始 payload |
| A7 | 点击停止只停止目标进程组，子进程与监听端口一起关闭，其他运行项与 Agent run 保持 | 入口：运行项面板；动作：点击目标项「停止」；信号：stopping→exited、PGID 不存活、端口拒绝连接、另一项仍 HTTP 200 |
| A8 | 正常退出把 managed process 算作运行任务，确认后回收全部组；重启不恢复 | 入口：真实 Electron `Command + Q`；动作：有服务时确认退出并重启；信号：退出保护、应用退出前端口关闭、重启后无旧条目且旧命令执行次数不增加 |
| A9 | 崩溃后不重启旧服务；即使旧 wrapper 已消失，也只处理有效 ownership manifest 指向的精确 `launchd` service，不误杀无关同名进程 | 入口：隔离数据根的真实 Electron；动作：分别强制终止应用、再强制终止旧 wrapper 后重启；信号：live service 被 kill/bootout，wrapper 已消失的 job 由 launchd 先回收同组后被 bootout，旧 PGID/端口均关闭且执行计数未增加；伪造／冲突 manifest 只产生 blocked，无关同名进程仍存活，清理链路没有裸 PID/PGID kill |
| A10 | `cwd` 越界、绝对路径、外部 endpoint、shell 字符串和伪造其他 session 操作均 fail closed | MCP 合约/真实 bridge 调用；信号：稳定结构化错误、spawn 次数为零、无注册表条目 |
| A11 | 主会话归档或项目强制移除不会留下失去唯一管理入口的运行项；这是会话归属和原始“右上角持续监督”目标的可达性闭环，不扩展为通用归档重做 | 入口：真实 Electron 左侧栏菜单；动作：在活动运行项存在时归档／移除；信号：普通归档禁用；强制移除先停止目标运行项，任一步失败不提交后续移除 |
| A12 | Codex、Claude、Kimi 的 full 与 resume 都临时发现同一工具，用户全局配置不被改写；注入、初始化或发现失败时 fail closed | 三家真实调用前后及每家故障注入；信号：正常路径有同名/schema 的工具发现/调用记录、临时注入路径清理、全局配置 hash/mtime 不变；失败路径 target spawn=0、registry 无新增、无 completed Agent 成功回复且原生终端没有 `nohup`/`&`/double-fork 回退 |
| A13 | Provider run 成功、失败、停止与 managed process 生命周期互不冒充 | 真实 Electron + session facts；信号：工具成功但 Provider timeout 时无 completed Agent message；Provider 正常结束时运行项仍存在；停止 Agent run 不停止运行项 |
| A14 | macOS 上 `pnpm start` 与 Desktop 共享同一 local-console composition root 和 ownership backend；验证它是原始“全局 Moebius 能力”在第二个既有入口上的同一关闭不变量，而不是新增 CLI 产品或第二套 supervisor | `pnpm start` 隔离验收；动作：Agent 启动服务后向 local entry 发 SIGTERM；信号：服务跨回合存活，entry 关闭后精确 job 被 bootout、进程组和端口消失；非 Darwin 稳定 unsupported 且 target spawn=0 |

实现阶段必须提供定向测试、`pnpm run test --scope a47b629c`、三包 typecheck、desktop build、console-ui Storybook 门禁，以及 A1–A14 的真实运行/调用链证据。完整 `pnpm test` 按仓库规则只在复核通过后、合并前由主理人安排一次。所有副作用 UI 动作必须按 `docs/protocols/real-app-acceptance.md` 记录入口／操作／屏幕观察／与承诺一致否／环境；Story、fixture、直接 HTTP 和测试计数都不能抵扣。
