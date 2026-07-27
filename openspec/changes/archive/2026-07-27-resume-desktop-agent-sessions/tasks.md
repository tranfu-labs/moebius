# 任务：resume-desktop-agent-sessions

- [x] 在 local JSONL 契约中定义 Agent identity、provider initialization、canonical link、公开时间线 cursor 与 invocation audit 事实；同步替换现有“Session team snapshot freezes each member execution profile”“每个 Agent run 持久化到 Codex thread 的稳定关联”“恢复兼容性失败时不自动重新执行”“恢复执行段与缓存用量可诊断”，并删除“仅显式同次未完成执行可以 resume”及其两个 full Scenario。
- [x] 把 `execution-context.ts` 重构为 `first | resume | unavailable` 纯 planner，覆盖未创建前失败、creation evidence 已存在但 ID 缺失、冲突、归属不兼容与 legacy 唯一迁移；明确零/冲突候选均零 provider 调用。
- [x] 重构 `src/local-console/codex-resume.ts`：删除 `planLocalCodexRecovery`、可执行 `full-fallback` 规划与新 fact 写入，只保留旧 `codex_resume_intent` / `codex_resume_consumed` / usage facts 的兼容 codec；历史 `mode=full-fallback` 可读但 runtime 不得再产生。同步 `tests/local-console-codex-resume.test.ts`、execution-context 与 runtime 测试。
- [x] 让 local 主 Agent / worker lane 共用 planner，只有新 `session + teamSnapshotFingerprint + role` 身份可首次 full / `session/new`，同一身份的普通消息、重试、接力、下一步骤、改一改重发、重新运行与重启恢复全部增量 resume；删除所有 `full-fallback` 分支。
- [x] 在 `prompt.ts` 实现 per-Agent 公开时间线增量与附件范围选择，覆盖 A → B → A、失败不推进 cursor 和重试重投。
- [x] 强化 Codex/Kimi execution driver 的 requested / observed ID 一致性、started callback 同步持久化和 Kimi ACP `session/resume` 序列测试；覆盖 external ID 已观察但 canonical link 写入失败时不提交回复、不推进 cursor，后续 unavailable 且零 provider 调用。
- [x] 升级 AI 建队 draft schema，删除 thread rebuild 状态与 reconstruction，确保失败结果也保存已观察 ID。
- [x] 为 AI 建队 Codex/Kimi spawner 写安全 invocation manifest，覆盖 submit、adjust、repair、retry、跨 draft 隔离和 resume 失败无 second call。
- [x] 扩展 GitHub role state 的归属证明与迁移，在 thread started 后固化 ID、评论成功后推进 cursor。
- [x] 按 github-issue-runner delta 的现有原文锚点替换 watchdog、reaction、media、resume 失败与 runDir 五条业务规则，替换场景 10/16/29 并删除场景 50.3；删除实现中的 resume fallback full / `-fallback` runDir，让失败进入既有 retry / dead-letter 并保留 `resume-unavailable:*`。
- [x] 新增 Desktop provider 调用点白名单测试，锁定三类持久 Agent 与 route-bus / external route / CEO guardrail 辅助推理边界。
- [x] 补齐验收清单 1–14 的单元、集成、迁移、失败恢复和调用次数断言；其中 5–10 必须逐条覆盖“ID 先持久化再成功”“creation evidence 有而 ID 缺失”“无 full/session-new fallback”“同快照改一改重发 resume”“新快照才可首次创建”“legacy 唯一/零/冲突候选”。
- [x] 根据真实 Desktop 对抗复核修复 Codex replacement thread 与 callback 吞错：把 rollout resolver 上移为共享 adapter，AI 建队和 GitHub role 在 resume 前精确预检；`src/codex.ts` 的 `onThreadStarted` 失败立即终止并判 run 失败；三域补 canonical persistence failure、real fake CLI replacement、failed manifest/state 与“后续不再 full”回归。
- [ ] 运行 local、AI 建队和 Desktop 后台 GitHub role 的真实入口验收，逐条采集 DOM 文本与 JSONL/state/log/manifest 证据。（已实测 local 主 Agent → 成员 → 主 Agent、local resume 不可用、AI 建队正常续跑及无效 Codex ID fail-closed；Desktop 状态页已确认 runner `运行中`。GitHub 外部 issue 因隔离数据根白名单为空、Kimi Desktop 正向链路因本机未安装 Kimi，归档时仍准确保留为未实测。）
- [x] 运行 `pnpm test`、`pnpm typecheck`、`pnpm --filter @moebius/desktop build`，修复所有失败并反思代码与方案符合度。
- [x] 实现验证通过后把 ADR-0007 标记 superseded、ADR-0008 标记 accepted，更新 `module-map.md` 与 `runner-cost-notes.md`，并将 `architecture/after.svg` 回流为 `docs/architecture/desktop-agent-session-continuity.svg` 当前架构图。
