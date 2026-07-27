# 提案：resume-desktop-agent-sessions

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/prd.md` | `Desktop 持久 Agent 的执行会话连续性` | 新增三类 Desktop 持久 Agent 首次创建、后续强制 resume 的总契约与辅助推理排除边界 | 已写入 |
| `docs/product/pages/main-conversation.md` | `Agent 执行与恢复`、`重试`、`退出应用与恢复执行`、`验收标准` | local 身份、公开时间线增量、唯一 external ID、旧数据迁移与 fail-closed 文案 | 已写入 |
| `docs/product/pages/agent-conversation.md` | `步骤、尝试与 run`、`重试与恢复`、`验收标准` | 区分产品 run 与 provider session；新 run 仍沿用同一 Agent external session | 已写入 |
| `docs/product/pages/onboarding.md` | `第 2 步 AI 建队`、`AI 建队技术约束`、`验收标准` | 删除保存对话重建一次，改为 draft 内唯一 session 与 resume 失败保留 ID | 已写入 |

PRD 在 2026-07-26 的产品采访和两轮范围核对后完成。用户确认只覆盖当前 Desktop
实际使用的运行时；每个 Agent 在一次会话中的首次对话允许创建，之后必须 resume；
resume 不可用时明确失败，不允许 full 重建，并确认没有其他补充。

## 背景

Desktop 当前实际可达的持久 Agent 调用有三类，但连续性契约不一致：

- local 主 Agent / 专业成员的普通新消息、接力、重试和后续步骤每次 full；只有同一
  未完成 run 的退出恢复会 resume。
- AI 建队按 draft 首次创建、后续 resume，但 resume 失败会清空 ID，用保存对话
  reconstruction 一次。
- Desktop 自动启动的 GitHub runner 对 `issue + role` 首次 full、后续 resume，
  resume 失败后会创建 `-fallback` runDir 并再次 full。

这些 fallback 会让用户以为同一个 Agent 上下文仍在延续，实际已经生成 replacement
session。Codex 与 Kimi 的 ID 持久化时机也不完全对等，失败发生在 session 已创建但
最终输出前时可能丢失身份。

## 提案

- 统一三类 Desktop 持久 Agent 的身份与状态机：local 使用
  `session + teamSnapshotFingerprint + role`，AI 建队使用 `draftId`，GitHub 使用
  `issueKey + role`。一个身份第一次允许创建；观察到 external ID 后全部后续执行强制
  resume。
- local 在 session JSONL 追加 canonical provider link、初始化证据、公开时间线 cursor
  与唯一候选旧数据迁移事实。首次 prompt 使用完整共享历史；A → B → A 等后续轮次只
  注入该成员尚未看到的公开增量与附件。
- Codex 与 Kimi driver 都校验 requested / observed ID 一致；ID 缺失、冲突、归属不兼容
  或 resume 失败时只做一次 provider 调用并形成可见失败，不再 full / `session/new`。
- AI 建队删除 reconstruction 与 thread reset；草稿 external ID 一旦观察到立即保存，
  submit、adjust、retry 和结构修复都复用它，跨 draft 永不复用。
- GitHub role 删除 resume fallback；`thread.started` 后立即固化 ID，评论成功前不推进
  `lastSeenIndex`，失败进入既有 retry / dead-letter。
- 新增 provider 调用点白名单测试，锁定 local route-bus、GitHub 无 mention 路由和
  CEO guardrail 的一次性辅助推理边界；新增 invocation manifest / log 只用于内部审计，
  不向 renderer 暴露 provider ID，不改变页面布局。

## 影响

- 业务域：`local-console`、`desktop-shell`、`github-issue-runner`。
- 主要实现：`src/local-console/*`、`src/kimi.ts`、`desktop/src/ai-team-builder/*`、
  `src/conversation.ts`、`src/runner.ts`、`src/state.ts`、
  `src/sqlite-state-worker.ts` 与对应测试。
- 产品与架构：supersede ADR-0007，新增 ADR-0008；更新 module map 和历史成本备忘。
- 数据：local JSONL 与 GitHub role state 增加可迁移字段；AI 建队 draft 从 v2 兼容读入
  新 schema。迁移只接受唯一可证明 ID，绝不按最近时间猜测。
- 可见反馈：local 沿用「原执行已经无法继续 / 你可以重新运行，或直接说话、换一个
  成员接手。」，AI 建队 resume 失败沿用「AI 上下文暂时无法继续，已保留对话和最后
  有效方案。」；无新页面或版式变化。
- 不影响：GitHub runner 不新增 Kimi；无 mention 路由、CEO guardrail、readiness、
  安装、observer、团队页面布局和 renderer DTO 的 provider ID 边界保持不变。
