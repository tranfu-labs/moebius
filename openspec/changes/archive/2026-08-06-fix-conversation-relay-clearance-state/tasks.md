# 任务:fix-conversation-relay-clearance-state

## 实现

- [ ] `conversation-layout.ts`：`planConversationRelayClearance` 改为单参数 `(paneWidth)`；`requiredColumnLeft` 改为 `12 + CONVERSATION_RELAY_COLLAPSED_WIDTH`（从 `conversation-relay-rail-model.ts` 导入）；删除 `CONVERSATION_RELAY_GAP_PX` 常量
- [ ] `operator-console.tsx`：clearance 调用点改为 `planConversationRelayClearance(conversationPaneWidth)`，删除 `deriveConversationRelayLayout` import；`conversation-bottom-dock` 改为与 `conversation-timeline-gutter` 一致的条件留白写法；`TimelineEntry` 移除 `max-w-[68ch]`
- [ ] `conversation-layout.test.ts`：替换 3 条旧断言为 design.md 的 5 条（含 951/952 边界）
- [ ] `operator-console.test.tsx`：L1746 断言去掉 `max-w-[68ch]`
- [ ] `design-refs/app.css`：68ch 注释标注已废止（2026-08-06 产品决定）
- [ ] `DESIGN.md`：删 68ch 表述；目录轨条目补覆盖式留白数值（收起 56px = 12 + 44，展开面板覆盖、正文不动）
- [ ] `docs/product/pages/main-conversation.md`：L3 状态行订正（响应式按 PRD 覆盖原则实现，与 dashboard.html 窄容器规则有意不同）

## 验证

- [ ] `pnpm check:boundaries` 通过（新增 model import 不破坏边界登记）
- [ ] `pnpm --filter @moebius/console-ui typecheck` 通过
- [ ] `pnpm --filter @moebius/console-ui test`（conversation-layout / operator-console / conversation-relay-rail / run-outcome / sub-session-card）全绿
- [ ] `pnpm --filter @moebius/console-ui check:storybook` 通过
- [ ] 真实运行验收：按 design.md「真实运行验收」A/B/C 三组逐条实测（静态 Storybook + Playwright），出数值 + 截图 + evidence JSON，路径写入交付说明
- [ ] 复核 `operator-console.test.tsx:2912-2915`、`2968-2971` 两处 `toBeGreaterThan(32)` 继续通过（预期不用改）
- [ ] 复核涉及右侧栏开启（`rightSidebarOpen`）与 outcome / 子会话分支的既有用例无回归

## 文档

- [ ] 写 `spec-delta/console-ui/spec.md`：新 Requirement（窄容器收起态固定留白 + 覆盖式展开）+ 删改「主会话所有状态共用 dashboard 内容轴」（32px gutter 的 rail 例外）+ 删改「主会话消息采用 dashboard 身份与正文层级」（68ch 移除，写明推翻理由）
- [ ] 写 `.task-done.json`，phase="implement"，status="done"|"failed"|"needs-review"
