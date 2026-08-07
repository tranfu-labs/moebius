# 提案:fix-conversation-relay-clearance-state

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-conversation.md | 「会话目录轨」（L423 起，展开层规则见「展开层从目录轨向右覆盖，不改变正文宽度、标题位置、输入框位置或主时间线消息排布」） | **产品意图事实源**：覆盖式展开本来就是 PRD 既定规则；生产 106px 常驻预留与 PRD 和 design-refs 都不一致。本次修复让实现回归 PRD | 已存在，无需新增措辞 |
| docs/product/pages/main-conversation.md | L3（状态行） | 「…响应式…已对齐 `design-refs/dashboard.html`」——dashboard.html 的窄容器规则是「内容随展开让位」（`app.css:1078-1093`），与 PRD 覆盖式原则冲突；修复后该句不再成立，状态行需订正为如实描述（对齐项不含窄容器响应式，该行为按 PRD 覆盖原则实现，与 dashboard.html 有意不同） | 需订正 |
| docs/product/pages/main-conversation.md | L316（输入框） | 「主会话输入框是这条正文列在页面底部的操作延续…左右边界都与正文列一致」——composer 左缘必须跟随消息列左缘，是既有规则，不是本次新提出的要求 | 已写入，本次是补实现 |
| openspec/specs/console-ui/spec.md | L3079 / L3085 | 「把 Agent 长正文限制为最大 68ch」「且不超过 68ch」——68ch 限宽按用户 2026-08-06 产品决定移除（正文占满 840px 内容列），属设计变更而非缺陷修复，spec-delta 同步删改并留痕 | 需删改 |
| packages/console-ui/DESIGN.md | L60 | 「Agent / system 正文左缩进 32px且最长 68ch」——同上的产品决定，DESIGN.md 同步改 | 需删改 |
| packages/console-ui/design-refs/app.css | L361-363 | 68ch 注释是唯一写着该约定的设计稿位置，标注已废止 | 需标注 |

## 背景

用户反馈：主对话左侧目录轨（git-graph 式接力轨）在真实应用里"一直占据着"全尺寸宽度，而"点开之后才占全宽"。

排查过程（完整证据见本地对话时间线 #3-#15）：

1. 组件自身（`conversation-relay-rail.tsx`）的 hover 展开/收起逻辑正常且有单测覆盖。
2. 问题在容器窄（`conversationPaneWidth` < 约 952px，常见桌面窗口宽度）时：主时间线让给目录轨的左侧留白 `planConversationRelayClearance`（`conversation-layout.ts:8-22`）按"展开态"一次性算死在 106px（= 12 + 82 + 12），不感知 rail 真实的 `expanded` 状态——无论 rail 收起还是展开，内容区永远按展开宽度预留，视觉上就是"一直占据"。
3. 设计稿 `app.css:1078-1093` 的窄容器规则是"内容随 `is-expanded` 让位"（收起 56px ↔ 展开 20+面板宽），composer 与 timeline 同规则同值。
4. 但 `openspec/specs/console-ui/spec.md:2263/2270` 与 PRD 都规定「正文、标题、输入框和主时间线滚动位置不变」「不推动正文重排」——即**覆盖式展开**才是产品意图，design-refs 的窄容器让位规则与 PRD 冲突。
5. composer（`conversation-bottom-dock`）完全没有接入 clearance，窄容器下固定 32px，与消息列错位 74px，违反 L316 规则。
6. 宽容器（`conversationPaneWidth` ≥ 952px）下已实测正确（内容左缘由 `mx-auto` 居中，不随 hover 变化，composer 与 timeline 天然重合），本次不动。
7. 用户 2026-08-06 拍板（时间线 #28）：左侧 rail 是独立的两态组件，默认只占收起宽度；hover 展开的是另一个组件，用类似 absolute 的布局、更高层级**覆盖**在正文上方，遮挡部分正文左侧没有问题。理由：长正文让位会导致大量 DOM 重排的性能风险（时间线是虚拟滚动长列表）。这与 PRD 覆盖式原则一致。
8. 用户 2026-08-06 同时拍板（时间线 #24）：去掉 agent 正文的 68ch 限宽，正文占满内容列。

## 提案

**缺陷修复（回归 PRD 覆盖式原则）**：

- `planConversationRelayClearance(paneWidth)`：去掉 `relayExpandedWidth` 参数（展开宽度不再参与留白计算）；窄分支固定返回收起态预留 56px（= 12 内缩 + 44 收起视口），宽分支固定 32px。分支判定阈值从旧的 `12+w+12` 改为 `12+44=56`（"自然居中列是否已让开收起态 rail"），并重新推导分支归属位移（见 design.md）。
- `ConversationRelayRail` **保持内部 `expanded` 状态不上抛**——覆盖式方案下父组件不需要知道展开状态，上一版方案里 `onExpandedChange` 回调的设想作废；只验证展开面板 z-index 高于正文列、盖得住、点得到（现状 slot `z-20` + nav `overflow-visible` 已满足，实测确认）。
- `conversation-bottom-dock`（composer）接入同一个 clearance 值（窄 56 / 宽 32），消除与消息列的错位；宽分支不变。
- 不再需要 padding 过渡：留白与展开状态脱钩后，hover 不再引起内容位移，200ms padding 过渡、过渡中途采样等上一版条目全部作废。

**设计变更（非缺陷，用户产品决定）**：

- 移除 agent / system 正文的 `max-w-[68ch]` 限宽（`operator-console.tsx:3724`），正文占满 840px 内容列（保留 32px 左缩进）。
- `design-refs/app.css:361-363` 的 68ch 注释标注已废止；`DESIGN.md:60` 同步；spec-delta 删改 L3079 / L3085 对应句并写明推翻理由。
- `design-refs/app.css:1078-1093` 窄容器让位规则是**被产品决定推翻的设计稿约定**（设计稿非 spec，不回流，在 change 文档留痕即可；design-refs 整体退役是另一条 change 的事）。

## 影响

- **修改**：
  - `packages/console-ui/src/console/conversation-layout.ts` — `planConversationRelayClearance` 签名（去掉第二参数）与常量
  - `packages/console-ui/src/console/operator-console.tsx` — clearance 调用点简化；composer 接入 clearance；移除 `max-w-[68ch]`
  - `packages/console-ui/src/console/conversation-layout.test.ts` — 重写既有 3 条断言为 5 条（含边界）
  - `packages/console-ui/src/console/operator-console.test.tsx` — L1746 断言去掉 `max-w-[68ch]`
  - `packages/console-ui/design-refs/app.css` — 68ch 注释标注已废止
  - `packages/console-ui/DESIGN.md` — 68ch 语句删改 + 目录轨覆盖式留白数值
  - `docs/product/pages/main-conversation.md` — L3 状态行订正
  - `openspec/changes/fix-conversation-relay-clearance-state/spec-delta/console-ui/spec.md` — 新 Requirement + 两条既有 Requirement 的删改
- **不动**：
  - `conversation-relay-rail.tsx` 本身（触发逻辑、内部 state、z-index 布局）——只做真实运行验证
  - 宽分支（`conversationPaneWidth` ≥ 952px）的留白数值与机制
  - 760px 移动响应式档位（`app.css:1149-1155`，理由见 design.md「已知未覆盖」）
  - `openspec/specs/console-ui/spec.md:2263/2270`（「正文、标题、输入框位置不变」与覆盖式方案一致，无需改动）
- **验收**：main-conversation.md L316 规则首次在窄容器下被真正满足；L3 状态行订正后如实描述。

## 缘由锚

- 本地对话时间线 #3-#15（用户原始反馈 → 三轮诊断 → 用户两个 story 实测 106px → dev-manager 四条约束核验）
- 本地对话时间线 #26-#28（spec 2263/2270 冲突暴露 → 用户拍板覆盖式方案 + 理由）
- 本地对话时间线 #24（用户拍板去掉 68ch）
