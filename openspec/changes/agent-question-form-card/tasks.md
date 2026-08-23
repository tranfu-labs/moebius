# 任务：agent-question-form-card

- [x] `agent-form-model.ts`：类型、规模判定、草稿读写、已答判定、消息组装
- [x] `agent-form-model.test.ts`：规模上限、已答判定、单选/多选与「自己写」的互斥规则、消息逐行组装与跳过题
- [x] i18n：`console.agentForm.*` 进 `console.zh-CN.ts` 与 `console.en.ts`
- [x] `agent-form-card.tsx`：卡片、成员与进度、三种作答区、导航行、发送禁用原因
- [x] `agent-form-card.test.tsx`：进度跳转保留答案、发送禁用、「自己写」派生选中、键盘完成一次作答
- [x] `agent-form-card.stories.tsx`：Component 层覆盖「页面状态」表每一行
- [x] `operator-console.tsx`：底部 dock 组合表单卡片，排在待发射区与附件草稿之上
- [x] `operator-console.test.tsx`：堆叠次序、超限表单安静降级
- [x] `operator-console.stories.tsx`：Page 层三个 story 在真实操作台走完出现 → 作答 → 发送 → 时间线
- [x] `src/index.ts` 导出
- [x] `DESIGN.md` 回流新组件模式
- [x] `pnpm --filter @moebius/console-ui test` / `typecheck` / `check:storybook` 全绿
- [ ] Storybook 真机走查并交付验收证据
