# 0009. 托管进程由 local-console supervisor 持有并通过 stdio MCP 暴露

## 状态

accepted

## 背景

Codex、Claude 与 Kimi 都能在自己的终端工具中启动命令，但这些进程句柄属于 Provider CLI。Agent
可以让子进程后台化甚至脱离到 PID 1，Moebius 事后只能观察到命令文本，无法可靠知道最终 PID、进程
组、readiness、端口和退出状态，也无法保证停止或应用退出时回收。

只要求 Agent 在正文输出 JSON 不能转移所有权；让 Moebius 接管所有普通命令则会重造三家 Provider
终端并扩大执行面。临时 spike 证明，普通 stdio MCP server 可以让三家 Provider 使用同一工具，而
Moebius 侧 supervisor 可以让目标进程跨 Provider turn 存活。Kimi 另暴露出工具已经成功返回但 ACP
回合不终结的状态，要求工具生命周期与 Provider turn 生命周期分离。

## 决策

1. 只有需要跨当前 Provider invocation 或 Agent 回合存活、需要用户持续监督的本地进程进入
   `managed_process`；普通一次性命令继续由 Provider 原生前台终端执行。`task` 有自然终点但明确跨
   invocation 或需持续监督；耗时长本身不构成托管理由。
2. managed-process supervisor 属于 local-console application 层，并随同一 local console server
   被 Desktop 或 `pnpm start` 创建和关闭。它是进程、readiness、日志和 session 所有权的唯一来源。
3. Codex、Claude 与 Kimi 每次 full/resume 都临时注入同一 stdio MCP bridge。bridge 使用短期、
   session/workspace/provider-run 绑定的 capability 调用 supervisor，不直接 spawn，也不修改用户全局
   Provider 配置。
4. start 只接受结构化 executable 与 args 数组、workspace-relative cwd、可选 loopback readiness 和
   endpoint；所有启动固定 `shell:false`。session/workspace 所有权来自 capability，不来自 Agent 参数。
5. macOS 首版由窄 `launchd` ownership adapter 登记不可预测 service label，固定 Moebius wrapper 作为
   job main process，以同一 job process group 和 `shell:false` 启动目标。版本化 0600 manifest 用 installation
   key HMAC 绑定 UID/domain、label、processId、session/workspace identity 与 plist digest，不保存旧命令。
   startup 只对验证通过的精确 service target 执行 kill/bootout，不按裸 PID/PGID、同名命令或端口猜测，
   也不 bootstrap/kickstart 旧 payload。非 Darwin 首版 fail closed，不提供弱化后端。
6. 注册表只跨同一次应用运行和 Agent 回合，不是持久业务事实。正常退出停止全部运行项；崩溃后只
   清残留；重启不恢复列表、不重新执行旧命令。
7. Agent prompt 中的 Runtime Contract 只引导何时调用工具。进程注册和停止不解析 Agent 正文 JSON、
   Markdown 链接或后台命令。
8. managed tool 返回与 Provider turn 终局是两个事实。Kimi 已完成托管工具但 ACP 不终结时由独立有界
   settlement gate 收束 Provider run；已经托管的进程不随该 timeout 停止。
9. Provider MCP 注入、初始化或工具发现失败时撤销 capability，本轮不接受 start、不写 completed 成功
   消息，target spawn 为零；Runtime Contract 禁止回退后台 shell。
10. exited 条目保留到用户显式“清除已退出”或应用退出。最后一个 active 退出时顶栏先保留已结束事实；
    确认清除成功且没有其他条目后入口才消失。

## 后果

- Moebius 在启动前取得进程所有权，可以给 UI 提供真实状态、readiness、有限日志和整组停止，而不再
  依赖 Agent 文本猜测。
- 三家 Provider 的注入实现不同，但 Agent 所见 schema、session 权限和生命周期一致；升级 Provider CLI
  时必须用真实工具发现测试维护各自 adapter。
- local-console 增加一个短命 stdio bridge、一个 Darwin launchd adapter 和每运行项一个极窄 wrapper；
  后两者必须通过依赖边界、service identity 与对抗性进程树测试证明不会演变为第二套 runner。
- 运行项不进入 JSONL/SQLite 可恢复事实；应用重启后用户无法查看旧日志或一键恢复。这是“不自动重启”
  的明确代价，未来 restart/resume 需要新产品决策和新 ADR。
- 当前会话有活动运行项时归档受保护，是因为会话顶栏是唯一管理入口；项目强制移除必须先停止，避免
  归档后留下用户无法找回的进程。会话归属换来最小权限，但用户切换会话后需要回所属会话管理。
  `pnpm start` 共享同一 local-console composition root，验证同一关闭不变量，不新增 CLI 产品或第二套
  supervisor。
- `add-managed-process-runtime` 已完成 A1–A14 自动化与真实应用验证，因此本决策转为 accepted。未来若
  launchd ownership adapter 不再可行，应以新 ADR 替代，不在实现中静默退化为裸 PID/PGID 清理。
