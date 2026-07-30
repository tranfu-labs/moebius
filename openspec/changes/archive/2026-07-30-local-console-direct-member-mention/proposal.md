# 提案：local-console-direct-member-mention

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#团队推进中` | 输入框从主理人专属入口改为按唯一有效 mention 选择目标车道，并要求按目标显示待发射状态 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#输入框` | 新增主理人与各专业成员独立 FIFO、团队切换期间的队列归属规则 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#说话与提及` | 唯一有效成员 mention 直达；无效、未点名、多目标回主理人；忙碌目标排队且不打断 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#指标与验收` | 增加直达、未启动成员、忙碌排队、重启恢复与既有 Agent 身份续用的可核查结果 | 已写入 |

产品决策由 2026-07-29 本地共享时间线确认：用户接受“单个有效 mention 直达；未点名、无效或多个有效 mention 回主理人；目标忙碌时排队、不并行、不打断”的建议规则。

## 背景

当前 local console 有意把所有 composer 用户消息强制交给团队首成员。即使正文是 `@qa`，runtime 也会覆盖共享 mention trigger 的结果并启动主 Agent；现行 PRD、OpenSpec 和测试都固定了这个行为，所以它不是回归缺陷。

用户已经确认改变产品规则，让唯一有效成员 mention 真正选择第一位执行者。现有实现不能只删除 user-message 覆盖分支：

1. `scheduleWorkerRun()` 当前把同成员新任务解释为主理人 redirect，会中止活动成员；这与用户直达消息“排队、不打断”冲突。
2. 专业成员的等待尾巴只存在内存中；若应用关闭，尚未开始的直达消息会失去目标或顺序。
3. 当前 `pendingPrimaryMessages` 和待发射区只表达主理人 FIFO，无法告诉用户消息实际在等谁。
4. 团队切换、历史会话迁移、provider resume 和 startup catch-up 都依赖既有主理人消息位点，必须显式纳入新队列。

## 提案

1. 在 local-console 域新增纯 `user-message-routing` 规则：使用会话 effective 成员快照解析代码区域外的 mention；按不同有效成员去重后，唯一目标直达该成员，其余情况选择主 Agent。
2. 给本地用户消息持久化 dispatch lane、目标 role 和判定原因；旧数据没有这些字段时确定性兼容为主 Agent。主理人继续使用既有 FIFO，各专业成员新增 SQLite 支撑的独立 FIFO。
3. 把“主理人 redirect 活动成员”和“用户直达忙碌成员”拆成两种调度意图：前者保持中断并重启，后者只排队并在同 role 终态后启动。
4. 扩展 local state/session view 与 operator console 的待发射投影，逐条显示目标成员；保留 `activeRun` 只投影主 Agent，全部真实运行继续由 `activeRuns` 表达。
5. 覆盖团队切换、已有会话 schema migration、graceful restart、orphan/stuck recovery、每 Agent provider identity resume、附件与 pending FIFO。
6. 用纯规则测试、store/runtime 集成测试、组件测试、全量门禁和真实桌面主会话验收共同证明行为；真实验收必须记录入口、发送内容、实际启动成员、未启动成员及排队/恢复信号。

其中跨 role 并行、切换前已排队工作阻止团队快照提升、升级前 pending 继续交给主 Agent，都是把新 dispatch 接入现有并发、切换和升级安全契约的兼容要求，不是借本 change 新增并发模式、团队切换能力或历史消息重路由能力。

## 影响

主要影响：

- `src/local-console/runtime.ts`
- `src/local-console/user-message-routing.ts`（新增纯模块）
- `src/local-console/store.ts`
- `src/local-console/types.ts`
- `src/sqlite-state.ts`
- `src/sqlite-state-worker.ts`
- `src/local-console/prompt.ts`（若本地 prompt 需说明用户直达来源）
- `packages/console-ui/src/console/operator-console.tsx`
- `packages/console-ui/src/i18n/locales/*`
- `desktop/src/console-page/app.tsx`
- local-console、SQLite migration、desktop adapter 与 operator-console 测试
- `scripts/acceptance/` 下的任务级验收脚本或等价真实运行证据入口
- `openspec/specs/local-console/spec.md` 与 `openspec/specs/console-ui/spec.md`（归档时由本 change 的 delta 合入）
- `docs/architecture/local-console-primary-control-lanes.svg`（归档时由 `architecture/after.svg` 回流）

待发射区必须显示真实目标，因为“忙碌成员只排队”需要用户可观察且现有“待发射给主理人”会陈述错误目标；composer 现有“继续告诉主理人”同样需要改成 PRD 已有的中性/可提及成员提示。除此之外不新增 UI 模式或 Page Story，只更新生产组件、必要 i18n、既有 fixture 和组件测试。

不修改共享 `src/conversation.ts` 的 mention parser 与 `selectMentionedAgent()`，不改变 GitHub issue runner 的 mention trigger，不改变 Agent-to-Agent “第一个有效 mention”语义，也不改变主 Agent redirect 活动成员时的中断重启权。CEO guardrail、stage、goal-ledger、附件托管格式和团队首成员作为最终回交目标的事实保持不变。没有新页面、路由或版式，因此不创建 `wireframes.md`。
