# 0008. Desktop 持久 Agent 首次创建、后续强制 resume

## 状态

accepted

## 背景

ADR-0007 让 local-console 的普通步骤每轮 full，只允许同一次未完成 run 在退出恢复时
resume。Desktop 当前实际可达的持久 Agent 还有 AI 建队草稿；两条链路对 provider
session 连续性的处理不一致，local 普通步骤持续 full，AI 建队在 resume 失败后还会
静默 full 重建。

用户确认的新产品契约是：Desktop 当前使用的持久 Agent 在一次会话身份中第一次允许
创建 provider session；取得 ID 后所有后续运行都必须 resume。ID 缺失、不兼容或
resume 失败必须明确失败，不能用完整历史静默重建。Codex 与 Kimi 必须对等执行该规则。

## 决策

1. Desktop 持久 Agent 范围只包含 local 对话 Agent与 AI 建队草稿。local 无 mention
   路由没有持久 Agent 身份，继续作为一次性 full 辅助推理。
2. local 身份是 `session + teamSnapshotFingerprint + role`；AI 建队身份是 `draftId`；
   切换 local 团队快照或创建新 draft 都产生新身份。
3. 每个身份第一次允许 full / `session/new`。一旦观察到 external ID，立即持久化
   canonical link；后续普通轮次、接力、重试、修复与恢复只 resume 同一 ID。
4. resume 失败、ID 缺失/冲突、provider 返回不同 ID或上下文归属不兼容时 fail closed。
   单轮只允许一次 provider 调用，不清空 ID、不跨 provider、不执行 full /
   `session/new` fallback。
5. local 首次把完整共享时间线交给 Agent；后续按 Agent 保存的公开时间线 cursor 只交付
   未见公开增量及对应附件。成功形成公开 Agent 回复后才推进 cursor。
6. 旧 local 数据只在同一身份下归一得到唯一兼容 external ID 时迁移为 canonical link；
   没有候选或存在两个不同 ID 都失败，不按时间或成功状态猜测。
7. invocation manifest / JSONL / state / log 只承担内部审计和验收，不向 renderer 暴露
   provider ID，也不改变页面布局。

## 权衡

- 选择 provider session 连续性，保留成员已经完成的文件探索与工具上下文；代价是
  provider session 丢失后同一 Agent 身份会停止推进，不能再靠完整时间线自愈。
- 用公开时间线增量补齐成员离开期间的新事实，避免长期私有 session 与共享协作历史
  脱节；cursor 只覆盖公开事实，不让 provider 私有过程成为产品事实源。
- local 团队快照本身已经冻结 persona、CLI、model 与 effort，因此不再把 model/effort
  变化单独扩张成新身份规则；真正的身份边界由快照 fingerprint 统一承载。
- fail closed 比“尽量继续”更严格，但能让用户和测试直接证明没有发生不可见的
  replacement session。

## 后果

- ADR-0007 的“正常步骤固定 full”与“恢复失败降级 full”不再适用。
- 三类 Desktop 持久 Agent 的 provider 调用都需要稳定身份、canonical external ID、
  一致性校验和只执行一次的审计证据。
- Kimi 继续使用 ACP `session/new` / `session/resume` 精确协议；不采用可能把未知 ID
  当新会话处理的终端最近会话入口。
- 一次性路由和 CEO guardrail 保持无持久状态，并由 provider 调用点白名单测试锁定。
