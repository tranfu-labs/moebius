# 提案：align-main-composer-column

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | 页面结构 | 明确主会话输入框、待发射区和新对话输入框与正文列共用左右边界；右侧子任务栏保持独立宽度 | 已写入 |

## 背景

主会话标题和消息正文宿主的最大宽度是 `760px`，已有会话输入框、待发射区与新对话输入框仍沿用 `720px`。宽窗口下因此每侧出现额外 `20px` 缩进，阅读消息与继续输入之间产生可见的横向跳动。

现有页面 PRD 只明确了标题、Agent 历史消息和活动运行共用正文列，没有覆盖底部输入器。这次采访确认输入器应当是同一正文列的操作延续，属于需要补齐的产品意图。

## 提案

- 为主会话列建立共享的 `760px` 最大宽度与水平 gutter 类，统一供标题、时间线、已有会话输入框、待发射区和新对话输入框消费。
- 保留 `w-full` 响应式行为，让小于上限的窗口继续随可用宽度收缩。
- 不改变右侧子任务栏输入框宽度，不改变消息气泡、发送逻辑或运行状态。
- 用组件测试锁定主会话三种输入状态的宽度契约。

## 影响

- `packages/console-ui/src/console/conversation-layout.ts`
- `packages/console-ui/src/console/operator-console.tsx`
- `packages/console-ui/src/console/new-conversation-page.tsx`
- 对应组件测试
- `docs/product/pages/main-conversation.md`
- `openspec/specs/console-ui/spec.md`（归档时合并）
