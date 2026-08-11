# 提案:retire-console-ui-design-refs

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-conversation.md | L3（状态行） | 仍引用 `packages/console-ui/design-refs/dashboard.html` 路径与「与 dashboard.html 的窄容器让位规则有意不同」——design-refs 删除后该路径失效，改为引用已合并进 spec 的覆盖式条款（`openspec/specs/console-ui/spec.md`「目录轨展开以覆盖层呈现且窄容器留白固定」），不再提外部稿路径 | 需订正 |
| sites/marketeam/AGENTS.md | L7 / L14 | `home-page.html` 来源锚点路径与「设计参考 HTML 继续留在 `packages/console-ui/design-refs/`」两处 → 改为搬迁后位置 `sites/marketeam/design-refs/home-page.html` | 需改路径 |
| openspec/specs/console-ui/spec.md | L1674（验收 #17 加号 Requirement） | 「参考 HTML 未包含"新会话"时，生产类型与既有普通会话行为仍 MUST 保留」——以外部稿为条件的表述 → 改写为直接行为陈述 | 需改写 |
| packages/console-ui/AGENTS.md | 「修改与门禁」 | 补一句边界：本包不保留静态设计参考稿，设计探索材料在 `docs/design-explorations/`，未解决的设计问题进 `prototypes/` | 需补充 |
| packages/console-ui/DESIGN.md | L5 / L59 | `moebius-desktop-spec.html` v1.1 悬空引用（规范文件不存在）→ 改为自述（规范事实源即 DESIGN.md + tokens.css 本身） | 需改自述 |
| packages/console-ui/src/styles/tokens.css | L3 / L35 | 同上的 `moebius-desktop-spec` 悬空引用 → 改为自述 | 需改自述 |
| openspec/specs/product-identity/spec.md | — | 已核：无 brand-spec / design-refs 引用 | 无需动作 |

## 背景

用户最初提问「design-refs 下的 HTML 是否都不需要、归总到 Storybook」（时间线 #1），当时的盘点结论：62 个文件分四类——退役（dashboard/onboarding/app.css/icons）、官网锚点（home-page.html）、规范文档（brand-spec.md + refs/*.jpeg）、纯重复（preview-center.png、manifesto-ribbon.jpg 与官网同哈希）。原方案一直未执行。

本 change（fix-conversation-relay-clearance-state，commit `4e75eeb2`）改变三处前提：

1. **数字回流前置条件已满足**：clearance 的 56px/覆盖式语义已合并进 `openspec/specs/console-ui/spec.md`（「目录轨展开以覆盖层呈现且窄容器留白固定」Requirement），68ch 废止在 spec 与 DESIGN.md 留痕。「删了 app.css 就丢唯一写目标值的地方」的顾虑解除。
2. **main-conversation.md L3 已订正**（上一条 change 实现时），但仍引用 design-refs 路径，需要再订正一次（见需求基线）。
3. **新增负向事实**：`app.css:1078-1093` 窄容器让位规则已被产品决定推翻（覆盖式方案），spec 已有覆盖式条款接住，删除即可，不迁移。

## 提案

按 #1 原方案三步走：

**第一步 · 切断硬依赖**：`scripts/acceptance/console-dashboard-ui.ts` 删除 `collectReferenceEvidence` 采集段（:1271-1360）、reference 浏览器启动/关闭（:268、:287-289、:309-314）、`referenceScreenshot`（:222、:1235、:1249）、evidence 的 `reference` 字段与 `visualObservation.reference`（:1181、:1184）、`pathToFileURL` import（:5 中仅此处用）、`type Browser` import（:9 中仅 referenceBrowser 用）。`IconMetric`/`iconMetric`/`assertIconMetric`/`SelectionGeometryEvidence`/`selectionEvidence`/`assertSelectionEvidence` 生产侧仍使用，保留。

**第二步 · 按归宿搬迁与删除**：

- `home-page.html` + `home-page.html.artifact.json` → `sites/marketeam/design-refs/`（`git mv` 保历史）；`sites/marketeam/AGENTS.md` 两处路径同步。
- `brand-spec.md` → `docs/design-explorations/console-ui/`；`refs/*.jpeg` 4 张 → `docs/design-explorations/console-ui/refs/`。
- 删（官网侧同哈希已核：preview-center.png `bd9c466e…`、manifesto-ribbon.jpg `c16154e9…` 两侧逐字节一致）：`preview-center.png`、`assets/manifesto-ribbon.jpg`、`dashboard.html` + `.artifact.json`、`onboarding.html` + `.artifact.json`、`app.css`、`assets/icons/`（含 `_icon-symbols.html`）。
- 最终 `packages/console-ui/design-refs/` 不存在。

**第三步 · 文档收口**：

- `grep -rn "design-refs"`（排除 archive/node_modules）清零；`dashboard.html` / `onboarding.html` / `brand-spec` / `home-page.html` 的活引用同步核查。
- main-conversation.md L3、spec.md L1674、marketeam/AGENTS.md、console-ui/AGENTS.md、DESIGN.md、tokens.css 按需求基线改。
- `moebius-desktop-spec.html` 悬空引用 → 自述。

**待裁决（不自行回流，报主理人）**：brand-spec.md 逐节核对后，以下约定未回流进 DESIGN.md / tokens.css / spec，搬迁后 brand-spec.md 仍是唯一出处：

1. **Component metrics 精确表**（品牌 spec「Component metrics(参考图实测)」节）：未读徽标 Ø18、页标题 28/600 -0.02em、药丸 Tab h34 r-full px16、下划线 Tab h44 图标16+gap8、筛选 Chip h34 r12 px14、视图切换 seg（容器 raised r12 p3 / 按钮 h28 r9）、按钮 h36 r10 13.5/510 主=白底黑字、状态药丸 h26 r-full px11 + 内置 12px 状态图标、表格（表头 h38 12.5 / 行 h52 / 复选框 16 r5 / 行分隔 1px）、成员/团队卡 r16 p20 负载条 h4 r2 内嵌 chip h28、指标卡 r14 p20 min-h118 大数字 32/600 tnum、Inbox 行（头像 Ø40 未读 Ø8）、详情面板 w420-480 标题 21/600 标签列 110px。DESIGN.md 只有侧栏 252、头像 24/32、composer 等零散度量。
2. **`--orange #f77342` 语义色**（负载偏低进度条、警示）：生产 tokens 状态相族为 amber/blue/violet/neutral + pass/danger，无独立 orange。
3. **Light theme 的 `--fg-max #000000`**（主按钮 hover 极值）：生产无。
4. **官网专属裁决**（液态玻璃/金属流光预算、组件尺度上调、1120px 版心、叙事手法）：brand-spec 明写「不回流 app」，属于官网约定，随文档迁至 docs 后由 marketeam 侧按需引用。

负向事实（已裁决、无需动作）：accent 薰衣草紫 → 靛蓝 `#5E6AD2`（DESIGN.md:5 已登记裁决）；窄容器让位规则被推翻（spec 覆盖式条款已接住）。

## 影响

- **修改**：`scripts/acceptance/console-dashboard-ui.ts`、`docs/product/pages/main-conversation.md`、`openspec/specs/console-ui/spec.md`、`sites/marketeam/AGENTS.md`、`packages/console-ui/AGENTS.md`、`packages/console-ui/DESIGN.md`、`packages/console-ui/src/styles/tokens.css`
- **搬迁**：`home-page.html`(+artifact) → `sites/marketeam/design-refs/`；`brand-spec.md`、`refs/*.jpeg` → `docs/design-explorations/console-ui/`
- **删除**：`dashboard.html`(+artifact)、`onboarding.html`(+artifact)、`app.css`、`preview-center.png`、`assets/`（manifesto-ribbon.jpg + icons/*）
- **验收**：`pnpm run test --scope` 绿、`check:storybook` 通过、`pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts` 跑通且 evidence 无 `reference` 段、`grep -rn "design-refs"`（排除 archive/node_modules）清零

## 缘由锚

- 本地对话时间线 #1（原方案盘点与四类归宿）、#50（用户「启动清理」）、#51（dev-manager 派工与三条方案更新）
