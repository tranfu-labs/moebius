# 设计：repair-local-console-acceptance-scripts

## 定性证据

### A2：脚本错误期望，不是产品回归

`git show 2bc009d:src/kimi.ts` 已包含当前空响应说明。现行 `local-console` spec 要求：裸 `end_turn` 归一为 `kimi-empty-response`；页面给出终端 `kimi` 自查动作；普通时间线不得猜测额度、认证、模型或网络。当前 A2 反而要求“可能是额度或服务问题”，既落后于基线，也会把 A2 与后续专门验证已确认额度的 A12 混为一谈。

修复不机械复制整段产品文案。A2 断言以下外部行为：

- terminal 为 `crashed`，`safeCode` 为 `kimi-empty-response`；
- 可见正文包含终端运行 `kimi` 的自查动作，但不包含额度/服务成因猜测；
- 没有 Agent 消息，目标侧边栏行为为失败红点；
- evidence 保存 terminal、安全正文、Agent 消息数和状态点，便于确认 A12/A7/A8 不是因 A2 放松而误过。

这比替换成另一段全文镜像更稳定，也严格保留了现行安全分类。

### T5：成功 fixture 不真实，产品 guard 正确

生产 `src/codex.ts` 从 `thread.started.thread_id` 取得 ID，先等待 `onThreadStarted`，正常成功再返回相同 `threadId`；`tests/codex.test.ts` 已覆盖该顺序。`7300fc2` 同时规定 local-console 对“成功但无 result/observed ID”抛出 `provider-session-id-missing`，并把常规测试的 `codexOk` 从 null 改为 `threadIdFor(options)`。

因此真实 Codex 的正常 closeout 不应返回 null。T5 是遗漏迁移的 fixture，不是产品缺陷。共享 helper 改为异步：

- resume：使用 `options.mode.threadId`；
- full：从本次 `runDir` 生成稳定且不同 run 不冲突的验收 ID；
- 返回成功前 `await options.onThreadStarted?.(threadId)`，再返回同一 `threadId`。

不能只塞一个常量 ID：`primary-agent-closeout` 的 QA 与 dev-manager 是两个 Agent identity，共用 external ID 会制造另一种不真实冲突。也不能删除或捕获 `provider-session-id-missing`：那会掩盖产品契约。

### Handoff resume：路径和样本都不可移植

现脚本不是单纯路径拼错。它依赖固定 session file、run、消息 404/412–415 与 provider ID；当前硬编码根中该 session JSONL 和 SQLite session 已不存在。增加 `--source-data-root` 只能让调用者自行寻找一份未登记、不可重建的私有快照，无法在另一台机器上形成可重复验收。

采用自包含准备阶段：

1. 在系统临时目录创建 `sourceDataRoot`，写入最小 Agent fixture；
2. 用生产 local-console server/store 和受控 provider 产生一条主 Agent handoff QA 的活动 run，记录 source、run、step、attempt、role 与 provider ID；
3. 正常关闭以得到未消费 graceful intent；
4. 复用现有 `local-console-codex-resume` 测试所使用的 legacy footprint 转换规则：去掉旧 intent 不具备的 `sourceDisposition`，保留无害 retry sibling，并把 exact Agent source 投影成历史错误的 `pending`；转换前必须核验 source/intent/context/provider link 唯一，不能靠正文或最近消息猜测；
5. 记录 source manifest，把整个 source root `cp -cR` 到另一个系统临时 root；后续 Electron、shim、repair 与可见完成断言只作用于副本；
6. 最后再次计算 source manifest，证明准备完成后的源根没有被被测启动写入。

IDs 与“需要保留的历史消息集合”从准备结果动态捕获。历史不重写仍比较转换完成时的 fact log 前缀和选定消息稳定字段，而不是继续依赖 404/412–415 这些机器数据编号。

若复用转换规则需要抽取 helper，helper 只接受 fact log 路径与显式 identity tuple、只改调用者给出的临时 fixture，并由原测试与脚本共同使用；不得接受任意用户数据根扫描，也不得成为运行时迁移 API。

## 权衡

### 采用：脚本自建临时 source fixture

优点是每次运行都从生产写链生成合法前置事实，随后只施加一处明确的 legacy 投影；跨机器不需要私有数据，source/copy 隔离和原根未写断言仍保留。随机路径与动态 ID 也直接证明脚本没有依赖作者环境。

代价是验收脚本多一个准备阶段，运行时间略增，并且历史输入从“一次真实事故快照”变为“由真实写链生成、再确定性降级的等价 footprint”。原事故快照已经不存在；保留一个不可重跑的路径并不比等价、可复现的 fixture 更有证据价值。原始一次性历史证据仍留在归档 change，不改写。

### 不采用：只把路径改成 `projectRoot`

代码仓库根不是数据根；普通 worktree 没有目标 SQLite/JSONL，把两者混同只会让脚本换一种方式失败。

### 不采用：只增加环境变量或 CLI 参数

参数能消除作者绝对路径，却不能提供已经消失的固定 session 样本；调用成功仍依赖未登记的外部私有数据，不能满足跨机器实跑判据。

### 不采用：提交历史 SQLite/JSONL fixture

真实用户数据不应进入仓库；二进制 SQLite 还会形成难审查、易漂移的 fixture。临时准备阶段使用现有生产写链，证据更透明。

## 验证设计

### A2 / A12 / A7 / A8

运行：

```sh
pnpm exec tsx scripts/acceptance/local-runtime-supervision.ts
```

退出码必须为 0；evidence 中 `A2-empty-end-turn-is-not-success`、`A12-confirmed-quota-speaks-precisely`、`A7-override-rerun-completes-in-place`、`A8-override-does-not-mutate-team-profile`、`A8-next-run-returns-to-original-kimi-session` 全部 `passed=true`。A2 的 observed terminal 必须是 `kimi-empty-response`，且 A12 仍单独证明已确认额度时的精确分类。

### T5 primary closeout

运行：

```sh
pnpm exec tsx scripts/acceptance/local-console-t5.ts --case primary-agent-closeout
```

退出码必须为 0；stdout 为 `ok:true, case:"primary-agent-closeout"`，evidence 中调用与回复顺序均为 `qa,dev-manager`，acceptance/integration facts 仍为空。另用受影响测试或脚本 evidence 核对两个 full run 使用不同非空 ID，若出现 resume 则返回请求 ID；不得通过删除 identity guard 变绿。

### 可迁移 handoff resume

运行：

```sh
pnpm exec tsx scripts/acceptance/local-console-agent-handoff-resume.ts
```

不传作者路径或数据根参数。退出码必须为 0；最终 stdout 的 `passed=true` 且 assertion count 与 evidence 一致。evidence 必须证明：

- `sourceDataRoot` 与 `copiedDataRoot` 都位于系统临时目录、彼此不同且不等于 `projectRoot`；
- `complete-copy-used`、`repair-fact-once`、`exact-source-restored-without-history-rewrite`、`same-run-step-attempt-role-provider`、`fresh-continue-exact-source-isolated`、`provider-and-context-identity`、`visible-completion-without-conflict`、`repeat-startup-idempotent`、`original-data-root-unwritten` 全部通过；
- 原 QA 只有 resume、没有 full replacement；新消息使用自身 source/run 与 dev-manager context；最终无 active/pending、context conflict 或新增 run-not-started。

随机 source path 和动态 session/run/message/provider IDs 是“换一个数据根实跑”的直接信号；代码 diff 或参数解析测试不能替代这次脚本运行。

### 收口闸门

- 迭代收口：`pnpm run test --scope 02c1604`。
- 静态检查：`pnpm typecheck`；仓库未配置 lint，照实记录。
- 三条验收脚本全部实跑；输出重定向到系统临时日志，只汇报退出码、assertion IDs 与 evidence 路径。
- 交付收尾执行一次完整 `pnpm test`。本批没有用户可见行为变化，不补 UI 真机语句，也不以脚本输出冒充产品行为变更验收。

## 风险与回滚

- **准备 fixture 自己不满足 repair 白名单**：准备阶段在污染前核对唯一 intent/context/source/provider link，任何缺失立即失败，不把不完整 fixture“修”到能过。
- **共享 `codexOk` 改变其他 T5 case**：这是纠正所有成功 fixture 的同一 provider 契约；用 scope 闭环与 `--case primary-agent-closeout` 收口，若某 case 因真实 identity 冲突失败，应修该 fixture 的 identity 分配，不能退回 null。
- **脚本运行变慢**：只增加一次内存/本地 server 准备，不新增全量测试用例或真实等待；继续使用仓库 wait helper，禁止固定 sleep 作为就绪判据。
- **回滚**：A2 与 T5 helper 可独立回滚；handoff 脚本若自建 fixture 不稳定，可暂时恢复为显式失败的“缺 fixture”入口，但不得恢复作者绝对路径或宣称可迁移。
