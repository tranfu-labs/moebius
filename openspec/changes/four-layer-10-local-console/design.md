# 设计：four-layer-10-local-console

## 方案

按用例纵切，不建立横向 `utils/services`：

1. **项目/会话 commands + queries**：把 create/move/switch/archive/search/read/file/process 等流程的
   policy 与时序从 façade 分离；store/files/workspace 通过窄端口注入。
2. **primary execution application flow**：消费既有 control/invocation planner，保持 claim、fact、
   provider callback、cursor、terminal 的相对顺序。
3. **worker execution application flow**：保留 user-direct / primary-redirect、role lane tail、detached
   persistence 和 stop-release 差异，不强行与 primary 合成新 God Function。
4. **terminal/recovery lifecycle**：把 transition 判据提纯，I/O 写入与 best-effort failure 留 application/adapter。

`runtime.ts` 可以继续拥有 active run maps 和 wake scheduling，但不得内联路由、resume/prompt 范围、
terminal 分类或项目/会话 policy。完成判据是依赖与测试，而不是硬性 LOC；预期改动 5.5k–7.5k 行。

## 测试对账

### 外部行为冻结矩阵

| 纵切 | 输入事实 | 决策/时序 | 对外保持不变的信号 |
| --- | --- | --- | --- |
| 项目/会话 | 项目目录、消息数、workspace/team snapshot、运行/待接回状态 | 空会话才可换 workspace；团队切换按 effective/pending 快照推进；归档/移除先守运行边界 | HTTP 错误码、项目/会话摘要、重启后的 workspace/team/归档事实不变 |
| primary | claimed source、effective 主 Agent、恢复事实、活动 primary lane | 单 FIFO；claim→context/invocation plan→provider→terminal/fact→下一条 pending 的相对顺序不变 | 同一 run/attempt、回复/失败/中断终局、cursor/link 与 pending 顺序不变 |
| worker | source disposition、目标 role、各 role 活动/排队事实 | user-direct 不打断同 role；redirect 先停旧 run；同 role FIFO、不同 role 独立 | role/run identity、并发 lane、detached result 与主 Agent 接回事实不变 |
| terminal/recovery | 结构化 terminal、resume intent/link/context、orphan/stale 事实 | 穷尽映射；未知安全失败；graceful resume 优先于 orphan stuck；失败写入可重试 | 页面终局、可重试性、重启不重复回复、provider identity/cursor 不变 |

### test-name ledger

基线样本命令：`pnpm exec vitest run tests/local-console.test.ts tests/local-console-pending-switch.test.ts tests/local-console-codex-resume.test.ts --reporter=verbose`（Node 24.18.0，2026-08-02）。duration 只用于本 change 前后对账，不外推为完整闸门收益。

| 当前集成测试 | 基线 duration | 最终纯测试责任 | 等价分支 | 必须保留接缝 | 当前结论 |
| --- | ---: | --- | --- | --- | --- |
| `tests/local-console.test.ts` · `routes a user message without mention directly to the session primary Agent` | 188ms | `tests/local-console-user-message-routing.test.ts` · `routes 没有点名` | 无/无效 mention → primary、单一有效 mention → 对应 lane、多个有效 mention → primary | 保留同文件一条 HTTP+SQLite 发送→claim→run→fact 链 | 先保留；routing use case 落地后再判合并 |
| `tests/local-console.test.ts` · `claims worker dispatches atomically per role while preserving per-role FIFO` | 128ms | `tests/local-console-control-dispatch.test.ts` · `keeps one FIFO head per idle role and skips active or queued roles` | 同 role 只取 FIFO 头、active/queued role 跳过、其他 role 独立 | 保留真实 store 原子 claim + 并发 worker lane | 先保留；worker flow 落地后再判合并 |
| `tests/local-console-pending-switch.test.ts` · `rejects a workspace switch after the first message while preserving the running team switch` | 528ms | `tests/local-console-session-policy.test.ts` · `rejects workspace mutation after the first message without changing the selected team` | messageCount>0 在任何 workspace 探测/写入前拒绝，pending team 不被触碰 | 保留 restart 后 workspace/team snapshot 恢复 | 先保留；session flow 落地后再判合并 |
| `tests/local-console-codex-resume.test.ts` · `continues an interrupted thread with the edited resend as an overriding delta` | 299ms | `tests/local-console-run-invocation-plan.test.ts` · `includes an edited resend and unseen delta in a resumed invocation` | interrupted + canonical context + edit-resend → resume、正文覆盖、只带 unseen delta | 保留真实 provider continuation/link/cursor + restart | 先保留；primary/worker flow 落地后再判合并 |

实现前在 `tasks.md` 交付记录补全 test-name ledger。初始候选：

- `tests/local-console.test.ts` 中只证明 routing/lane/policy 参数组合的重型用例；
- `tests/local-console-execution-runtime.test.ts` 中 retry/prompt/terminal 纯分支组合；
- `tests/local-console-pending-switch.test.ts` 中 session/team/workspace transition 纯组合；
- `tests/local-console-codex-resume.test.ts` 中 recovery mode/delta 可由值输入覆盖的重复组合。

必须保留每类 HTTP+SQLite 一条、restart recovery、provider observation/link/cursor、store failure、
primary/worker 并发 lane 和 process output 接缝。预计累计纯比例 48–57%，完整闸门 112–126 秒；
若等价剪枝不足，速度收益按零报告，不删唯一接缝。

## 真实运行验收

按系列 RA-01 至 RA-04 执行，记录环境、入口、操作、屏幕观察、与承诺一致否：

- 主页面新建会话并完成一次真实 Agent 运行，重启后无重复终局；
- 运行中停下、保留不完整正文、重试并出现正确 attempt；
- 直接提及专业成员、成员 handoff 与不同 role 并行，身份和过程标签正确；
- 左栏对本批实际迁移的项目/会话 mutation 执行并复查持久化。

## 风险与回滚

- 调用顺序漂移：保留主链顺序测试与 provider/store 接缝，任一差异回滚该用例纵切。
- port 膨胀：只把现有依赖收成窄接口，不新增 repository、schema 或通用 service locator。
- primary/worker 过度统一：共享 pure plan，不共享有真实差异的 persistence/lane application flow。
