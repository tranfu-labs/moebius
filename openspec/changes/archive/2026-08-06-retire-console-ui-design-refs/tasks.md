# 任务:retire-console-ui-design-refs

## 第一步 · 切断硬依赖

- [x] `scripts/acceptance/console-dashboard-ui.ts`：删 `collectReferenceEvidence`（:1271-1360）、reference 浏览器启动/关闭（:268、:287-289、:309-314）、`referenceScreenshot`（:222、:1235、:1249）、evidence `reference` 字段（:1181）与 `visualObservation.reference`（:1184）、`pathToFileURL` import、`type Browser` import
- [x] 保留：`IconMetric`/`iconMetric`/`assertIconMetric`/`SelectionGeometryEvidence`/`selectionEvidence`/`assertSelectionEvidence`（生产侧仍在用）
- [x] 验收：`pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts` 跑通（QA 真实 Electron 环境，退出码 0），evidence JSON 无 `reference` 段

## 第二步 · 按归宿搬迁与删除

- [x] `git mv home-page.html` + `.artifact.json` → `sites/marketeam/design-refs/`
- [x] `sites/marketeam/AGENTS.md` L7 / L14 路径改为 `sites/marketeam/design-refs/home-page.html`
- [x] `git mv brand-spec.md` → `docs/design-explorations/console-ui/`；`refs/*.jpeg` 4 张 → `docs/design-explorations/console-ui/refs/`
- [x] 删 `preview-center.png`、`assets/manifesto-ribbon.jpg`（哈希两侧一致已核）、`dashboard.html`(+artifact)、`onboarding.html`(+artifact)、`app.css`、`assets/icons/`
- [x] 最终 `packages/console-ui/design-refs/` 不存在

## 第三步 · 文档收口

- [x] main-conversation.md L3：去 design-refs 路径引用，改引 spec 覆盖式条款
- [x] spec.md L1674「参考 HTML 未包含…」→ 直接行为陈述（spec-delta 已合并）
- [x] DESIGN.md L5 / L59、tokens.css L3 / L35：`moebius-desktop-spec.html` 悬空引用 → 自述
- [x] `packages/console-ui/AGENTS.md` 补边界句：本包不保留静态设计参考稿，设计探索材料在 `docs/design-explorations/`，未解决设计问题进 `prototypes/`
- [x] `grep -rn "design-refs"`（排除 archive/node_modules）清零；`dashboard.html`/`onboarding.html`/`brand-spec`/`home-page.html` 活引用核查
- [x] 核对 `openspec/specs/product-identity/spec.md` 无 brand-spec 引用（已核，无需动作）

## 脚本断言两批修正（QA 复核发现，并入本 change）

- [x] 第一批（68ch 残留三处）：`:561` 选择器 `.max-w-[68ch].pl-8` → `.relative.pl-8`；`:1638` 断言改 `assertClose(agentBody.width, title.width, 1)`；`:2876` 夹具文案同步
- [x] 第二批（窄几何旧契约两处 + 采集一处）：`collectNarrowGeometry` 增采 `timelineColumn`；`:1663` 左缘断言基准 title → timelineColumn；`:1664-1668` 宽度断言基准同步
- [x] `:586` 之后全量横向扫描：无第三批同类残留（宽几何/动态 dock/短窗口/resize/抽屉/右侧栏/图标几何逐组判定，`106|56px|px-8|paddingLeft|clearance` 常量零残留）
- [x] QA 真实 Electron 全量复跑：退出码 0，`narrowGeometry` timelineColumn{x:308,width:549} / composer{x:308,width:560} / scrollbar 11（549+11=560）

## 验收与交付

- [x] `pnpm run test --scope` 绿（exit 76：无测试受影响，tokens.test.ts 7/7 单独过）
- [x] `pnpm --filter @moebius/console-ui check:storybook` 通过
- [x] dashboard-ui 验收脚本跑通（QA 环境退出码 0，evidence 无 reference 段）
- [x] 交付说明逐条给证据；brand-spec 未回流清单（proposal.md「待裁决」节）报主理人——主理人裁决：只搬迁留档不回流
- [x] 写 `.task-done.json`，phase="implement"
