# github-issue-runner 规格增量

当前事实规格使用“业务规则 + 编号场景”的旧结构，而不是逐条 `Requirement` 结构。
本 delta 因此以现有原文和场景标题作为归档锚点；归档时按下列
`现有原文 → 替换为` / `删除` 操作合并，MUST NOT 仅把新规则追加到旧 fallback 规则后。

## MODIFIED 业务规则

### 锚点 G1：resume fallback 看门狗

**现有原文**

> - MUST 让 resume 尝试与 resume 失败后的 fallback 全量重跑各自作为独立 run 计时看门狗，MUST NOT 共享同一个看门狗预算。

**替换为**

- MUST 让每次 Codex invocation 独立使用完整空闲与硬上限看门狗预算。已有 role thread
  的 invocation 只能是一次 resume；resume 失败 MUST 直接进入既有 failed / retry /
  dead-letter 链路，MUST NOT 启动第二个 full invocation 或第二份看门狗预算。

### 锚点 G2：Codex execution reaction

**现有原文**

> - MUST 在同一个 issue 处理周期中最多添加一次 Codex execution reaction；resume 失败后 fallback full run MUST NOT 再添加第二次 reaction。

**替换为**

- MUST 在同一个 issue 处理周期中最多添加一次 Codex execution reaction。resume
  失败后 MUST 直接结束 provider 执行并进入失败链路，MUST NOT 添加第二次 reaction，
  也 MUST NOT 发起 full invocation。

### 锚点 G3：issue media prompt 范围

**现有原文**

> - MUST 在首次 full run 与 fallback full run 中包含完整公开 timeline 的媒体；resume run 只包含新增外部 delta 消息中的媒体。

**替换为**

- MUST 在真正首次 full run 中包含完整公开 timeline 的媒体；resume run 只包含新增
  外部 delta 消息中的媒体。系统 MUST NOT 构造 fallback full run 的媒体集合。

### 锚点 G4：resume 失败处理

**现有原文**

> - MUST 在 resume 失败或 thread id 不可用时允许回退到 full prompt 新建 Codex thread，并在 GitHub 评论成功后更新该 role 的 thread 映射。

**替换为**

- MUST 以 `issueKey + role` 作为 Desktop 后台 GitHub 持久 Agent 身份。没有 role
  thread 创建证据时 MAY 首次 full；一旦观察到 thread ID，后续 trigger 和失败重试
  MUST 只 resume 同一 ID。resume 失败、thread 不存在、thread ID 缺失/冲突或返回不同
  ID 时，runner MUST 保留原 canonical ID，以 `resume-unavailable:<reason>` 进入既有
  retry / dead-letter，且单次 issue processing MUST 只有一次 provider invocation。

### 锚点 G5：runDir

**现有原文**

> - MUST 把本地脚本每次执行的 stdout / stderr 落到 `<TMP_ROOT>/moebius-<ISO>-c<count>-r<sequence>/` 下，并在日志中打印该路径，便于追溯；`<sequence>` 是 runner 进程内递增后缀，用于保证并发 runDir 唯一；resume fallback 可使用独立 fallback 目录。

**替换为**

- MUST 把本地脚本每次执行的 stdout / stderr 落到
  `<TMP_ROOT>/moebius-<ISO>-c<count>-r<sequence>/` 下，并在日志中打印该路径，便于
  追溯；`<sequence>` 是 runner 进程内递增后缀，用于保证并发 runDir 唯一。一次
  issue processing 的 provider invocation 只使用这一份 runDir；MUST NOT 创建
  `-fallback` 或其他 second-invocation runDir。

## ADDED 业务规则

- MUST 在首次 full 观察到 `thread.started` 后立即固化当前 `issueKey + role` 的
  canonical thread ID；即使随后的输出、编排副作用或评论发布失败，下一次也只能
  resume 该 ID。
- MUST 把 canonical thread ID 与公开时间线 cursor 作为两个提交点：
  `lastSeenIndex` 只有在 Agent 公开评论及本轮必要副作用成功后才可推进；失败或中断
  MUST 保持旧 cursor 并在下一次 resume 时重新选择未确认 delta。
- MUST 保存 role provider、workspace 与冻结 persona 的归属证明；旧 entry 只有唯一且
  归属兼容的 thread ID 才可迁移，缺失、冲突或不兼容 MUST fail closed。
- MUST 记录结构化 `codex-invocation` 日志，至少包含 mode、requested/observed ID
  一致性与 outcome，使测试可以直接断言失败轮只有一次 resume、没有 full fallback。

## MODIFIED 场景

### 锚点：`场景 10：对话型 — resume 失败时回退 full prompt`

**用以下场景替换现有场景 10（包括标题和全部 Given/When/Then）：**

### 场景 10：对话型 — resume 失败时 fail closed

Given `.state/role-threads.json` 中已有 `hermes-user.threadId = stale-thread`
And 最新消息包含 `@hermes-user`
When `codex exec resume stale-thread` 失败
Then 系统记录一条 `codex-invocation mode=resume threadId=stale-thread`
And processing outcome 为 `failed`
And reason 以 `resume-unavailable:` 开头
And 原 `threadId` 与 `lastSeenIndex` 均不被 replacement 值覆盖
And 不存在 `-fallback` runDir 或同轮 `mode=full`
And 达到既有失败预算后 dead-letter 的 Failure reason 保留同一 reason。

### 锚点：`场景 16：Workspace capability — 后续触发复用已有 worktree`

**仅替换该场景最后一行：**

> And 以已记录 worktreePath 作为 Codex cwd 执行 resume 或 fallback full run

**替换为**

And 以已记录 worktreePath 作为 Codex cwd；已有 canonical thread ID 时只执行 resume，
真正首次且无任何 thread 创建证据时才执行 full。

### 锚点：`场景 29：Codex 执行反馈 — resume fallback 不重复 reaction`

**用以下场景替换现有场景 29（包括标题和全部 Given/When/Then）：**

### 场景 29：Codex 执行反馈 — resume 失败不重复 reaction 或调用

Given runner 已在本轮 resume Codex 前添加过 `eyes` reaction
And `codex exec resume <threadId>` 失败
When runner 把本轮折叠为 `resume-unavailable`
Then 系统不再添加第二次 `eyes` reaction
And 不再调用 full Codex。

## REMOVED 场景

### 锚点：`场景 50.3：fallback 重跑拿到独立看门狗预算`

删除该场景标题及其全部 Given/When/Then。原因：resume 失败后不再存在 fallback
provider invocation；一次 resume 自身仍完整受既有空闲与硬上限看门狗保护。

## ADDED Requirements

### Requirement: 持久 role 与辅助推理调用点边界可验证

Source: docs/product/prd.md#desktop-持久-agent-的执行会话连续性

生产 provider 调用点 inventory MUST 把 mention role 分类为持久 Agent，把 GitHub
no-mention external route 与 CEO guardrail 分类为一次性辅助推理。辅助调用 MUST full
且 MUST NOT 读写 role thread / cursor；新增直接 provider 调用点若未分类 MUST 使测试
失败。

#### Scenario: CEO guardrail 保持无状态

- **GIVEN** mention role 已产生最终回复并进入发布前 guardrail
- **WHEN** guardrail 调用 Codex
- **THEN** guardrail 使用一次性 full
- **AND** 不读取或更新 mention role thread
- **AND** guardrail 失败仍按既有 fail-open 规则返回原回复。
