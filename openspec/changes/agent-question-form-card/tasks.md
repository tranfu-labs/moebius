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
- [x] 切题时的卡片高度过渡（WAAPI、可打断、reduced-motion 落终态）
- [x] `src/index.ts` 导出
- [x] `DESIGN.md` 回流新组件模式
- [x] `pnpm --filter @moebius/console-ui test` / `typecheck` / `check:storybook` 全绿
- [ ] Storybook 真机走查并交付验收证据

## 2026-08-28 · 预设选项上限调整

- [x] PRD、proposal、design、spec-delta 与边界矩阵同步 1–4 个预设选项的产品决定
- [x] 纯模型上限调整为 4，并用 4 可渲染 / 5 不可渲染覆盖边界
- [x] `moebius-form` Prompt 协议声明调整为最多 4 个 options，并更新对应测试
- [x] 卡片测试覆盖 4 个预设选项加「自己写」的五项呈现与既有选择语义
- [x] 执行定向测试、类型检查、构建、Storybook 门禁与真实应用验收
