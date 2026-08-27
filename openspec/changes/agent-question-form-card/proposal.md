# 提案：agent-question-form-card

## 需求基线

`docs/product/pages/agent-form.md`（2026-08-21 采访确认，已落盘）。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/agent-form.md | 全篇 | 新增「Agent 表单」页面 PRD：表单结构、三种作答区、表单规模上限、前进回退与发送规则、绕开与留存 | 已写入 |
| docs/product/pages/main-conversation.md | 关联页面 | 补充指向 Agent 表单页面 PRD 的指针 | 已写入 |

## 背景

Agent 需要用户拿主意时，只能把问题写在正文里；用户读完还要把答案重新组织成一段话打进输入框，问题一多容易漏答。PRD 已经把「一份表单能表达什么」定死（最多 4 题；单选 / 多选 / 自由输入；选择题最多 2 个预设选项，末尾由产品补一个「自己写」），但组件库里没有任何承载它的呈现层。

## 提案

在 `@moebius/console-ui` 新增 Agent 表单卡片的**呈现层与纯模型**：

- `src/console/agent-form-model.ts`：表单规模判定（合规 / 不合规）、作答草稿的读写、已答判定、以及发送消息的逐行组装。纯函数，不碰 React。
- `src/console/agent-form-card.tsx`：受控卡片组件。成员与进度、单题作答区（单选 / 多选 / 自由输入 + 产品补的「自己写」）、导航行（上一步 / 下一步 / 发送）、发送禁用原因常驻。
- i18n：产品定死的那几处说明位进 `zh-CN` / `en` 两份资源。
- `operator-console.tsx`：操作台底部 dock 组合这张卡，排在待发射区与附件草稿之上、输入框之前；判定不可渲染时整块不出现。
- Storybook：`Component/Console/AgentFormCard` 覆盖 PRD「页面状态」表的每一行；`Page/Console/OperatorConsole` 三个 story 在**真实操作台**里走完出现 → 作答 → 发送 → 时间线出现用户消息。

## 影响

- 受影响业务域：`console-ui`（新增组件与令牌用法，无新令牌）。
- 对外行为：包新增导出，不改任何既有组件的 props 或渲染。
- **本次不做**（留给后续 change）：Agent 表达表单的具体写法与解析（PRD「待讨论」未收口）、会话草稿持久化与跨会话恢复、desktop renderer 与 IPC 接线。操作台把这些都收成受控 props，由 renderer 决定。「新表单替换旧表单」的组件侧规则（草稿 formId 不匹配即从第一题重来）已实现，何时换成新表单仍由 renderer 决定。
