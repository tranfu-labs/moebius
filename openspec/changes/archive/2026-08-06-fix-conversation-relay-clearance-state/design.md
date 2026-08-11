# 设计:fix-conversation-relay-clearance-state

## 覆盖的验收落点

- main-conversation.md「会话目录轨」：展开层向右覆盖、正文/标题/输入框位置不变——本次让实现回归这条 PRD 规则
- main-conversation.md L316「主会话输入框…左右边界都与正文列一致」——composer 首次在窄容器下真正满足
- main-conversation.md L3 状态行：订正「响应式已对齐 dashboard.html」的表述（见 proposal.md 需求基线）
- spec.md L3079 / L3085 的 68ch 语句：按产品决定删改（spec-delta）

## 方案

### 1. `planConversationRelayClearance` 新签名与常量

```
planConversationRelayClearance(paneWidth: number): number
```

- `naturalColumnLeft = max(32, floor((paneWidth - 840) / 2))`（不变）
- `requiredColumnLeft = 12 + 44 = 56`（收起态目录轨占地：12px 左内缩 + 44px 收起视口宽；44 与 `conversation-relay-rail-model.ts` 的 `CONVERSATION_RELAY_COLLAPSED_WIDTH` 共用同一常量）
- 宽分支（`naturalColumnLeft >= 56`）：返回固定 `32`
- 窄分支：返回固定 `56`
- **`relayExpandedWidth` 参数删除**：覆盖式方案下展开宽度不再参与留白计算；调用点（`operator-console.tsx:1051-1056`）同步简化，`deriveConversationRelayLayout` 在该文件不再被引用（import 一并删除）

### 2. 分支阈值一致性与分支归属位移

**选择**：`requiredColumnLeft`（宽/窄判定）与窄分支返回值使用**同一个** `12 + 44` 常量。语义：宽分支 =「自然居中列已经让开收起态 rail」，只要不压到收起态的 rail 就不需要额外留白——展开面板是覆盖层，不要求留白。

**旧边界**（改前）：`requiredColumnLeft = 12 + w + 12 = 24 + w`，首个宽分支 `paneWidth = 840 + 2*(24+w) = 888 + 2w`（`w = relayExpandedWidth`）。

**新边界**：`naturalColumnLeft >= 56`。`paneWidth ≥ 904` 时 `naturalColumnLeft = floor((paneWidth-840)/2)`，首个宽分支 `paneWidth = 840 + 2*56 = 952`；`paneWidth ≤ 903` 时 `naturalColumnLeft` 被钳制在 32，恒为窄分支。

**分支归属位移**：`paneWidth ∈ [952, 887+2w]` 由旧「窄」变为新「宽」。以验收用 story（`w=82`）为例是 `[952, 1051]`；`w=224` 时是 `[952, 1335]`。这段位移是**覆盖式设计的必然结果而非回归**：旧公式要为展开面板预留空间，所以面板能放下的窗口都判窄；新设计展开面板直接覆盖内容，只要自然列让开收起态 rail（56px）就无需预留，这段区间内的 32px 留白是正确的新行为（展开时面板会覆盖正文左缘，用户已明确接受）。

**边界单测**：见下方「单测」，`951 → 56`、`952 → 32` 夹住边界。

### 3. rail 组件：内部状态保持私有

**不改 `conversation-relay-rail.tsx`**。`expanded` 仍是组件内部 `useState`，不新增 `onExpandedChange` 回调——覆盖式方案下父组件无需感知展开状态，这是相对上一版方案的红利。

需要真实运行验证的既有事实（现状已具备，见「真实运行验收」A2）：
- 展开面板（`<nav>`）位于 slot 内，slot `absolute left-3 z-20`，`nav` 自身 `overflow-visible`，展开宽度 `layout.expandedWidth` 向右延伸——z-index 高于正文列（timeline section 无 z-index，z-auto），盖得住；
- `nav` 是 `pointer-events-auto`，展开面板整行可点击（既有 `data-hit-target="row"` 行为），点得到。

### 4. composer 对齐

`conversation-bottom-dock`（`operator-console.tsx:2488-2497`）外层 class 从静态 `MAIN_CONVERSATION_COLUMN_GUTTER_CLASS` 改为与 `conversation-timeline-gutter`（`operator-console.tsx:2378-2384`）一致的条件写法：`conversationRelayClearance === null` 时保留原 class，否则只留右侧 padding（`pr-8`）+ 内联 `paddingLeft: conversationRelayClearance`。复用同一个变量，不新增函数或抽象层。`analysisPanelReservesSpace` 的 `pr-[312px]` 追加逻辑保持不动（tailwind-merge 里 `pr-[312px]` 覆盖 `pr-8`，右侧行为不变）。

### 5. 不再需要 padding 过渡

留白只由 `conversationPaneWidth` 决定、与展开状态脱钩后，hover 不会引起内容位移，`app.css:1087` 的 `transition: padding-left .2s ease` 与 reduced-motion 降级（`app.css:1098`）在本函数对应处**没有意义**，不实现。窗口 resize 引起的留白跳变沿用既有时间线 resize-anchoring 逻辑（`timelineResizeInProgressRef` 机制），不在本次范围内。

### 6. 68ch 移除（设计变更）

- `operator-console.tsx:3724`：`<div className="relative max-w-[68ch] pl-8">` → `<div className="relative pl-8">`。只删限宽，保留 32px 左缩进（`app.css:361` 的 `.msg-body padding-left: 32px` 对应物）。只影响 agent / system 消息分支；用户气泡（`max-w-[75%]`）、`RunOutcome` 分支、子会话卡片分支在 `TimelineEntry` 里是独立 return 分支，不经这行代码。
- `design-refs/app.css:361-363`：68ch 注释标注「已废止（2026-08-06 产品决定）」，规则保留（静态稿整体即将退役，改渲染不如留痕）。
- `DESIGN.md:60`：删 68ch 表述，补覆盖式目录轨的留白数值（56px 收起预留，供 design-refs 退役后查数）。
- spec-delta：删改 `spec.md:3079` 的 MUST 与 `3085` 的 THEN，写明推翻理由是用户产品决定、不是发现原设计有错。

## 单测（`conversation-layout.test.ts`）

替换现有 3 条断言（`conversation-layout.test.ts:37-41`，签名变化会先编译失败），改为 5 条：

```ts
expect(planConversationRelayClearance(760)).toBe(56);   // 窄:典型桌面窄容器,让出收起态 rail
expect(planConversationRelayClearance(903)).toBe(56);   // 窄:naturalColumnLeft 被钳制在 32,恒窄
expect(planConversationRelayClearance(951)).toBe(56);   // 新边界前一格:floor(111/2)=55 < 56
expect(planConversationRelayClearance(952)).toBe(32);   // 新边界:floor(112/2)=56 → 转宽
expect(planConversationRelayClearance(1_200)).toBe(32); // 宽:自然居中列已让开收起态 rail
```

**既有测试回归影响**（逐个文件核实）：

- `conversation-relay-rail.test.tsx`：不引用 clearance/padding，不受影响。
- `operator-console.test.tsx:2912-2915`、`2968-2971`：松断言 `toBeGreaterThan(32)`，修复后窄分支值是 56（jsdom 下 `conversationPaneWidth` 初始 760），继续通过，不用改。
- `operator-console.test.tsx:1746`：`expect(outputButton.parentElement).toHaveClass("relative", "max-w-[68ch]", "pl-8")` → 去掉 `max-w-[68ch]`（该断言测的是消息级轻操作按钮的宿主 class，随实现同步更新）。

## 真实运行验收

全部为「打开哪个 Storybook 入口 → 什么窗口宽度 → 做什么操作 → 量到什么数」，真实渲染页面（静态 Storybook + Playwright Chromium，非 jsdom），数值 + 截图留证。

**A 组 · 覆盖式 rail**（入口 `Page/Console/OperatorConsole → ConversationRelayReference`，窗口 1400×900，实测 `conversationPaneWidth`≈868 < 952，窄分支）：

1. 打开页面不做任何操作 → `getComputedStyle('[data-testid="conversation-timeline-gutter"]').paddingLeft` = **56px**（改前 106px）；`[data-testid="conversation-bottom-dock"]` 内层内容左缘 x 坐标 == timeline 内容区（`conversation-timeline-gutter > div`）左缘 x 坐标（两者相等，消除 74px 错位）。
2. 真实鼠标 hover 到 `[data-testid="conversation-relay-rail"]`（`data-expanded` 变 `"true"`）→ `padding-left` **仍为 56px**；timeline 正文与 composer 内容左缘像素坐标**零位移**（与步骤 1 同值，这就是「正文不让位」的断言）；展开面板 `<nav>` 的 bounding box 右缘 ≥ 94px（=12+82）且 `document.elementFromPoint` 在正文左缘内侧的点命中 nav 内部元素（证明面板盖在正文上方、z-index 更高）。
3. 鼠标移出、等待收起（约 120ms 防抖 + 过渡）→ 回到步骤 1 的数值。
4. 宽分支回归（窗口 resize 到 1900×900，实测 `conversationPaneWidth`≈1268 ≥ 952）：timeline / composer 内容左缘相等（实测 ≈466px），hover 展开前后数值不变。

**B 组 · 68ch**（入口 `Page/Console/OperatorConsole → DashboardShellAlignment`，该 story 内置长回复用于此检查）：

5. 窗口 1900×900 → agent 正文 wrapper（原 `.max-w-[68ch]` 元素）`getBoundingClientRect().width` = 内容列宽 **840px**（改前实测 600.6px）。
6. 窗口 1000×800 → 正文宽度 == 列宽本身（约 437px 量级，与改前一致，不产生新差异）。

**C 组 · 回归**：

7. 用户消息气泡：`DashboardShellAlignment` 中用户消息容器的 `max-width` 计算值仍为 **75%**（`max-w-[75%]` 未波及）。
8. `RunOutcome` 与子会话卡片：`component-console-runoutcome--*` / `component-console-subsessioncard--*`（或主会话对应分支）真实渲染后，页面中**不存在**任何携带 `max-w-[68ch]` 的元素，组件自身布局数值与既有断言一致；主会话 `operator-console.test.tsx` 中 outcome / 子会话分支的既有单测全部继续通过。

## 已知未覆盖

- **760px 移动响应式档位不做**：设计稿 `app.css:1149-1155` 在容器 `max-width:760px` 时整条 rail `display:none`、`.timeline`/`.composer` 固定 `padding-left:16px`。Moebius console 是桌面应用，该宽度档位真实使用中基本不会出现，且用户反馈只针对「主对话左侧一直占据」，不涉及移动布局。本次不实现，不在验收范围内；需要时作为独立 change。
- **分支判定机制与设计稿不统一，本次不改**：设计稿用固定 CSS container query 断点 `@container conv (max-width: 1199px)`；生产用「自然居中列左缘 vs 收起态 rail 占地」的几何比较（新阈值固定 952px，不随泳道数浮动）。两者机制不同，但生产判定直接由真实几何推导（840px 列 + 12/44/32 常量），没有证据说它错；统一成 1199px 需要重新论证断点值本身，超出本次范围。
- **design-refs/app.css:1078-1093 不回流**：该规则与 PRD 冲突、被产品决定推翻，design-refs 即将整体退役；只在 change 文档留痕，不回写设计稿。
- **hover 不产生 padding 过渡**：留白与展开状态脱钩，无过渡可做（见「方案 5」）。

## 风险

- composer 与 timeline 共享同一个 clearance 值：右侧栏 `analysisPanelReservesSpace` 的 `pr-[312px]` 只影响右缘，与左缘 clearance 正交，已核实无交叉。
- `conversation-layout.ts` 新增对 `conversation-relay-rail-model.ts` 的 import（复用 `CONVERSATION_RELAY_COLLAPSED_WIDTH`）：两者都是 console 域纯逻辑模块，符合模块地图依赖方向；改动后跑 `pnpm check:boundaries` 确认。
- 68ch 移除后宽窗口长正文行宽变大（840px 列）：这是用户拍板的行为，spec-delta 与 DESIGN.md 已同步，不存在残留反向事实源。
