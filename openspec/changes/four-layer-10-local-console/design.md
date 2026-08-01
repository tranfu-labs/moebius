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
