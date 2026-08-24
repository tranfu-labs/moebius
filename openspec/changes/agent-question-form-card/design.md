# 设计：agent-question-form-card

## 方案

### 分层

纯模型（`agent-form-model.ts`）与呈现（`agent-form-card.tsx`）分开。规模判定、已答判定和消息组装都是可以脱离 DOM 断言的规则，放进纯模型后，Storybook 只需要证明「界面把模型的结论显示对了」。

### 受控边界

卡片持有零状态。`spec` 是 Agent 这一轮发来的表单，`draft`（`{ formId, activeIndex, answers }`）是用户答到哪、答了什么，`onDraftChange` 回调出去。留存、替换旧表单、跨会话恢复因此全部落在宿主：PRD 要求「和当前停在第几题一起按会话草稿处理」，只有宿主知道会话是哪一个。`draft.formId` 与 `spec.id` 不一致时组件按新表单从第一题开始渲染，宿主换 `spec` 而忘了换 `draft` 不会显示上一份表单的答案。

### 「自己写」不是 Agent 的选项

产品补的那一项由组件在渲染时追加，不进 `spec.options`，Agent 连它的存在都不用知道。它的选中态是**派生**的：`ownText` 非空即选中，清空即未选中，没有独立的勾选控件可点。单选题里 `ownText` 非空时预设选中项被清掉，多选题里两者并存——这两条写在模型的 `applyOwnText` 里，不在事件处理器里各写一遍。

### 可访问性用原生控件承载

预设选项是真实的 `input[type=radio|checkbox]`，`sr-only` 之后由相邻的 `span` 画出视觉，`peer-checked` / `has-[:checked]` 负责状态样式。分组语义、方向键、点整行切换（`label` 天然的行为）因此都不用自己实现。「自己写」那一行不能包在 `label` 里——多选题下点输入框会连带切换 checkbox；它改为整行 `onClick` 聚焦到 `textarea`，视觉指示器 `aria-hidden`，可访问名落在 `textarea` 上。

### 键盘

卡片根上一个 `keydown`：Enter 在非 `textarea` 上前进 / 发送。`textarea`（自由输入题与「自己写」）里 Enter 是换行，Cmd / Ctrl + Enter 才前进。按钮自身的 Enter 由浏览器变成 click，根处理器跳过 `button`，不会走两遍。

### 纵向溢出

卡片是 `flex max-h-full flex-col`，头部与导航行 `shrink-0`，题目区 `min-h-0 flex-1 overflow-y-auto`。可用高度由宿主给，组件不写 `vh`——它不知道自己上面还有多少东西。

## 权衡

- **规模判定返回布尔而不是抛错**：PRD 要求不合规时静默降级成正文，不向用户解释。判定函数因此只回答「能不能渲染」，把「渲染什么」留给宿主，组件本身不承担降级 UI。
- **消息组装的分隔符走 i18n 而不是写死**：`{question}：{answer}` 与多选的 `、` 在英文下应当是 `: ` 和 `, `。模型接收这两个模板串作参数，保持纯函数，locale 由组件注入。
- **不做 `role="radiogroup"` 手写 roving tabindex**：`agent-portrait-picker` 那种写法是为了把 36 个候选收成一个 tab stop；这里一题最多三项，原生 radio 分组已经是同样的行为，自己实现只会多一处能写错的地方。
- **不给「跳过」按钮**：PRD 已裁决。「下一步」始终可点本身就说明了不答也行。

## 风险

- Agent 的表单写法尚未收口，`AgentFormSpec` 的字段名可能在接线时调整。风险被控制在包内：这次没有任何宿主消费它，改名不影响既有页面。
- `has-[:checked]` 需要 Tailwind ≥ 3.4（本包 3.4.17）与 Chromium 105+（Electron 38 满足）。回滚方式是把状态样式改由 `peer-checked` 画在指示器上，行边框不跟随。
