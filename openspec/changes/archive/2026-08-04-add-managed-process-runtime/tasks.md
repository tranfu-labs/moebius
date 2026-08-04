# 任务：add-managed-process-runtime

- [x] 建立 managed-process 纯契约
  - [x] 定义 start/list/inspect/read_logs/stop DTO、状态联合、readiness 与 endpoint schema。
  - [x] 固化 kind 边界：service/watcher 无自然终点；task 有自然终点但明确跨 invocation 或需持续监督；普通 Python/测试/构建即使耗时也保持 Provider 前台。
  - [x] 实现 label、argv、workspace-relative cwd、loopback URL、字面 stdout readiness 和数量/字节上限的纯 admission。
  - [x] 实现 starting/running/ready/unhealthy/stopping/exited reducer、active/exited summary、停止幂等计划与日志 ring cursor。
  - [x] 把 readiness、日志、停止、Kimi settle 等运行参数集中到 `src/config.ts`。
  - [x] 登记 four-layer 文件与依赖边界，证明 domain closure 不到达 fs/SQLite/provider/Electron/HTTP/child process。

- [x] 实现 process supervisor 与 Darwin ownership job
  - [x] 新增 local-console application supervisor、session/workspace 索引、readiness 调度和 in-memory registry。
  - [x] 新增 Darwin launchd adapter 与固定 wrapper：HMAC ownership manifest、不可预测 service label、一次性 start payload、`AbandonProcessGroup=false`/`KeepAlive=false`/`RunAtLoad=true`，wrapper 以 `spawn(executable,args[])`、`shell:false`、非 detached 启动目标并转发生命周期与有界 stdout/stderr。
  - [x] 实现认证 control stop 与精确 service-target fallback 的 SIGTERM→SIGKILL→bootout/reap；重复 stop 共用 promise，supervisor/reconciliation 禁止裸 PID/PGID kill。
  - [x] startup 验证 manifest version/HMAC/UID/domain/label/plist digest 后只清对应 launchd service；绝不 bootstrap/kickstart 旧 payload。非 Darwin 稳定 unsupported 且 target spawn=0。
  - [x] 覆盖 PID/PGID 复用、无关同名进程、伪造/冲突 manifest、supervisor/wrapper/target 各阶段崩溃、日志洪泛、readiness 慢/失败/恢复和注册上限。

- [x] 建立 stdio MCP bridge
  - [x] 用同一 schema 暴露 `managed_process_start/list/inspect/read_logs/stop`，bridge 只转发，不直接 spawn。
  - [x] 新增受能力保护的 loopback bridge endpoint，capability 绑定 session/workspace/providerRunId 并在 invocation 后撤销。
  - [x] 服务端拒绝其他 session、绝对或越界 cwd、外部 URL、shell 字符串、任意 env/PID/PGID 和过量 payload。
  - [x] 普通 renderer API 只开放 list/inspect/log/stop，start 仅允许 MCP capability。
  - [x] 补 MCP schema、capability 隔离、token 脱敏、full/resume 新 token 与跨回合同 registry 测试。

- [x] 三家 Provider 临时注入同一 MCP
  - [x] Codex 使用单轮 config overrides，不修改 `~/.codex/config.toml`。
  - [x] Claude 使用权限受限的 run-local `--mcp-config`，不使用 strict/replacement settings，调用后清理。
  - [x] Kimi 在 ACP `session/new` 与 `session/resume` 的 `mcpServers` 注入同一 server。
  - [x] 将版本化 Runtime Contract 组合进 full、delta、graceful resume、retry 与 edit-resend prompt，不解析 Agent 正文 JSON。
  - [x] injection/bridge init/tool discovery 任一失败时撤销 capability、拒绝 start、不写 completed 成功消息；Runtime Contract 明令不得回退 `nohup`/`&`/double-fork。
  - [x] 覆盖三家工具发现、工具名/schema 对等、配置冲突、临时文件清理与已知用户全局配置 hash/mtime 不变；每家故障注入断言 target spawn=0、registry/manifest=0、无成功回复和无原生后台 shell 回退。

- [x] 收口 Kimi 工具完成但回合不终结
  - [x] bridge 按 providerRunId/toolCallId 报告托管工具完成，不泄露参数或 capability。
  - [x] Kimi adapter 增加 post-managed-tool settle timer；真实正文/reasoning/终局撤销，心跳/配置不刷新。
  - [x] 到期复用既有 ACP cancel→signal escalation，形成可重试 provider-turn timeout，不写成功 Agent message或推进 cursor。
  - [x] 证明 Provider abort 不停止已托管进程，用户下一回合仍可 list/inspect/stop，且工具调用不重复。
  - [x] 覆盖正常终局、后续进展、悬挂、工具仍在途、父级 abort 和 resume 同一 Kimi session。

- [x] 接入 local-console API 与生命周期
  - [x] 在 `startLocalConsoleServer` composition root 创建 supervisor，先完成 ownership-manifest reconciliation 再对外 ready。
  - [x] 增加 session-scoped list/inspect/log/stop/acknowledge-exited HTTP API、稳定错误 DTO、日志 cursor 和 stop/acknowledge admission key。
  - [x] 把 managed process active count 接入 running task、归档保护与项目强制移除的先停止阶段。
  - [x] local runtime close 先持久化 Agent graceful resume，再停止 managed groups，最后关闭 store/server；失败向上阻断退出。
  - [x] `pnpm start` 的 SIGINT/SIGTERM 与 Desktop 使用同一 close 行为，不恢复旧条目或旧命令。

- [x] 接入 renderer application
  - [x] 新增 managed-process contract/client/model/hook，按当前 session 读取 summary、详情和日志。
  - [x] 用 request revision + AbortController 处理切换会话、慢/失败响应和旧请求迟到，不闪现上一会话条目。
  - [x] 面板关闭低频更新 summary，打开后增量读取日志；settled 项停止无意义高频轮询。
  - [x] stop 幂等防重，父级重渲染和 callback identity 变化不重复请求或错停其他 session。
  - [x] acknowledge-exited 只清当前 session 已 settled 内存项；慢/失败/迟到与 callback identity 变化不误清 active 或其他 session。
  - [x] endpoint 打开复用现有安全系统浏览器边界，只接受服务端已校验 loopback URL。

- [x] 实现主会话运行项 UI
  - [x] 新增 presentational indicator/panel：单项名称+状态、多项数量、无项不占位；最后一项退出后显示已结束，显式确认清除后入口消失并正确转移焦点。
  - [x] 展示 readiness、可选 endpoint、有限日志、截断事实、停止中和 exited code/signal 安全摘要。
  - [x] 把入口放到主窗口 46px 顶栏分析面板开关之前；窄窗收敛但保持 aria、键盘与焦点回返。
  - [x] 更新中英文文案、Story 和 `DESIGN.md` 组件模式；不新增临时 token 或第二套状态色。
  - [x] 覆盖单项/多项/无 URL/unhealthy/exited、最后一项退出、确认成功/失败、日志 loading/failure、父级重渲染、callback identity、键盘与 reduced-motion。

- [x] 接入 Desktop 退出与启动保护
  - [x] 将 managed-process active count 纳入普通退出和安装更新的统一任务 snapshot。
  - [x] 用户取消时保持运行；确认时等待全部组回收；清理 blocked 时保持应用打开且不调用 quit/quitAndInstall。
  - [x] Desktop 启动在 local console ready 前完成 launchd service reconciliation，不执行旧命令、不恢复旧列表、不按裸 PID/PGID 清理。
  - [x] 补单次 Command+Q、第二轮 Electron 事件、安装更新、无任务、清理失败、崩溃后启动和无关进程不受影响测试。

- [x] 自动化验证与符合度复核
  - [x] 跑 managed-process domain/adapter/MCP/provider/runtime/API/renderer/console-ui 定向测试。
  - [x] 跑 `pnpm run test --scope a47b629c`、`pnpm typecheck`、`pnpm --filter @moebius/desktop build`、`pnpm --filter @moebius/console-ui check:storybook`、`pnpm check:boundaries` 与 `git diff --check`。
  - [x] 对照 proposal A1–A14 填写符合度反思，逐项记录实现文件、自动化证据、真实运行证据与未满足项。
  - [x] 复核无 shell 拼接、无外部 cwd/endpoint、无 token/配置正文入日志、无用户全局配置写入、无裸 PID/PGID reconciliation、无 orphan 和无 UI 业务规则复制。
  - [x] 完成首次 QA 复核 B1–B3 返工：managed count 与 Agent run 分离、Kimi sliding settle、坏 manifest 逐项 blocked 且应用继续启动。
  - [x] 补真实 Electron 侧栏断言：仅有托管项时不显示 Agent 运行点，归档仍禁用；重跑定向测试、scope、typecheck、build、Storybook、boundaries 与 diff-check。
  - [x] QA／主理人复核通过后、合并前按仓库规则只跑一次完整 `pnpm test`。

- [x] 真实 Electron 与 local CLI 验收
  - [x] Codex：真实主会话启动 HTTP 服务，回合结束与下一回合后同一 ID/PID/PGID 和 HTTP 200；再从面板停止并确认端口关闭。
  - [x] Claude：同一 schema 完成启动、跨回合 inspect/log 与 UI stop，证明全局配置 hash/mtime 不变。
  - [x] Kimi：真实工具发现与调用；用可复现悬挂证明 MCP 已返回、运行项仍可用、Agent run 有界 timeout 且可 retry。
  - [x] 在主页面分别验收单项、多项、无 URL、慢 readiness、unhealthy、日志截断、切换会话和逐项停止。
  - [x] 让最后一个运行项自行退出和手动停止各一次，证明顶栏保留已结束事实；确认清除后入口消失，确认失败时现场保留。
  - [x] 用真实 Electron `Command + Q` 验收确认/取消、全部进程树和端口回收、重启不恢复。
  - [x] 强制终止隔离应用后重启，证明有效 ownership manifest 的精确 launchd service 被清、旧命令不重启、伪造 manifest blocked、无关同名进程不被杀且没有裸 PID/PGID kill。
  - [x] 用 macOS `pnpm start` 隔离入口证明它与 Desktop 共享同一 local-console composition root、跨回合托管与 SIGTERM 关闭不变量；非 Darwin 只验稳定 unsupported/target spawn=0，不创建第二套后端。
  - [x] 每个副作用动作按真实应用协议记录环境／入口／操作／屏幕观察／与承诺一致否；evidence 只写系统临时目录。
