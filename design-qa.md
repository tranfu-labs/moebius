# 三路线视觉与交互 QA

## 验收范围

- 路线 1：`sites/marketeam/style1.html`、`sites/marketeam/index1.html`
- 路线 2：`sites/marketeam/style2.html`、`sites/marketeam/index2.html`
- 路线 3：`sites/marketeam/style3.html`、`sites/marketeam/index3.html`
- 正式 `sites/marketeam/style.html` 与 `sites/marketeam/index.html` 不在本轮候选实现范围内，未被编号候选覆盖。

## 视觉事实源

| 路线 | 方向 | 目标图 |
|---|---|---|
| 1 | 运行中底单 | `/Users/wing/.codex/generated_images/019f70b3-b15a-7f91-b5dd-2b932bef26e6/exec-1138557c-94f9-419b-b5eb-44083aa73a8b.png` |
| 2 | 接棒场 | `/Users/wing/.codex/generated_images/019f70b3-b15a-7f91-b5dd-2b932bef26e6/exec-33315093-d23d-4b31-bcc7-b0c6a410fd8b.png` |
| 3 | 证据织机 | `/Users/wing/.codex/generated_images/019f70b3-b15a-7f91-b5dd-2b932bef26e6/exec-973aad59-ddca-4362-a715-6f038cc415e3.png` |

三条路线的目标图是各自唯一视觉事实源；“概念相似”不能替代对构图、比例、密度和首屏内容的精准还原。共同约束来自 `docs/marketing-site/视觉宪法.md` v0.2 与 `openspec/changes/unify-marketing-visual-v02/candidate-acceptance.md`。

## 比较证据

统一视口：desktop 1440×1000、tablet 1024×768、mobile 390×844。主要冻结状态为流程终态；交互检查另覆盖初始、推进、退回、复核、真人决定与交付。

- 三路线 desktop 样张并排：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/three-route-acceptance/style-desktop-comparison.png`
- 三路线 desktop 正式叙事并排：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/three-route-acceptance/index-desktop-comparison.png`
- 三路线 mobile 样张并排：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/three-route-acceptance/style-mobile-comparison.png`
- 路线 1 目标图与实现：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/three-route-acceptance/route1-target-vs-style.png`
- 路线 2 目标图与实现：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/three-route-acceptance/route2-target-vs-style.png`
- 路线 3 目标图与实现：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/three-route-acceptance/route3-target-vs-style.png`

完整视图用于判断首屏骨架、信息密度、比例、节奏与方向差异。交互细节、焦点状态、no-JS、reduced-motion 与移动端局部状态由三个独立交叉验收报告逐项验证，不以单张静态截图替代：

- `openspec/changes/unify-marketing-visual-v02/reviews/route1-by-route3.md`
- `openspec/changes/unify-marketing-visual-v02/reviews/route2-by-route1.md`
- `openspec/changes/unify-marketing-visual-v02/reviews/route3-by-route2.md`

## 视觉保真结论

### 字体与层级

- 路线 1 用大号衬线标题和高密度底单构成“运行记录”气质。
- 路线 2 用更直接的无衬线编辑式标题和横向站位建立“接棒场”。
- 路线 3 用衬线标题、细线织机和侧栏收据建立“证据织机”。
- 三条路线的首屏标题、中心作品和证据层级均明显不同，不是共享首屏骨架换皮。

### 布局与间距

- 路线 1 以六行底单作为第一视觉主角。
- 路线 2 以五个预存在站位、连续主线、红色回线和真人决策缺口作为第一视觉主角。
- 路线 3 以角色经线、逐条累积的证据纬线、返工回线和交付收据作为第一视觉主角。
- desktop/tablet/mobile 均未出现页面级横向滚动；窄屏顺序阅读成立。

### 颜色与令牌

- 三条路线共同使用纸张底色、深墨主色、红色退回、绿色通过，以及非颜色形状/文字辅助状态识别。
- 未复刻 Kimi 的蓝色双行标题、研究报告封面、芯片爆炸图、胶囊章节导航或点阵画布。

### 图像与资产

- 中心作品是界面原生的信息结构与控件，不依赖远程插图、Kimi 资产、D3 或外部 SDK。
- 页面无缺失图片、拉伸图片或占位资产；所有关键证据均以真实文字和可操作状态表达。

### 文案与内容

- 三个 `indexN.html` 均使用正式 Moebius 叙事，覆盖目标对齐、角色接棒、带原因退回、复核通过、真人决策边界与交付证据。
- 未把“视觉令牌、样张、设计方向”等设计说明泄漏到正式叙事中。

## 功能、响应式与可访问性

- 路线 1：播放、暂停、拖动与行选择会同步更新当前记录、未来记录、关系条和状态读数。
- 路线 2：推进、回退、播放与站位焦点会同步更新持有者、任务片段、双线主段、证据卡、红色回线与绿色交付线。
- 路线 3：证据选择会同步更新织机步骤、角色、收据定位与原位 live 反馈；底单定位不强制滚走用户。
- 核心控件均可键盘操作并有可见焦点；展开控件同步 ARIA 状态。
- reduced-motion 下关闭非必要过渡且不强制循环播放。
- no-JS 下三条路线都保留完整角色、退回、复核、真人边界与稳定终态。
- 六个页面的内联脚本均通过语法检查，无重复 ID；页面自身控制台无 error，关键资源无 404。
- 路线 2 的统一验收追加发现并修复了 landmark P2：`style2.html` 现为独立 header/main/footer，skip link 指向可聚焦的 main，视觉与交互无回归。

## 打回与复验历史

1. 路线 1 第一轮通过，无 P0/P1/P2。
2. 路线 2 第一轮因 no-JS 终态矛盾、站位/任务/主线/证据联动不完整被打回；原作者修复，原审查者第二轮通过。统一验收又发现 landmark 语义 P2，再次退回并复验。
3. 路线 3 第一轮因正式页底单不能反查流程段被打回；首版修复造成强制滚动、未通过复验；第二版改为原位反馈、持久定位和非颜色提示后通过。

## 非阻断 P3

- 路线 1：reduced-motion 下播放按钮反馈可更明确；移动端退回双向关系可更强；路径连续感可继续提升。
- 路线 2：移动端控制按钮高度仍为 36/38px，后续可统一到至少 44px。
- 路线 3：移动端织机需要局部横向查看，但没有扩散为页面级横向滚动。

## 精准还原复审 · 2026-07-18

用户指出路线 1 与路线 3 没有精准还原最初图片。以目标原生 1487×1058 尺寸重新捕获后，原先“通过”结论作废。

### 同尺寸证据

- 路线 1 当前实现：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/precision-rework/style1-before-exact.png`
- 路线 1 并排比较：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/precision-rework/style1-before-comparison.png`
- 路线 3 当前实现：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/precision-rework/style3-before-exact.png`
- 路线 3 并排比较：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/precision-rework/style3-before-comparison.png`
- 视口与状态：1487×1058 可见内容尺寸；流程初始状态；无浏览器外框。

### 当前阻断发现

- [P1] 路线 1 首屏骨架错误：实现新增了目标图不存在的大号营销 Hero 和右侧宣言，任务底单由目标的约 y=105 下移到约 y=292（旧 1440 截图中约 y=424），导致完整六行、时间轴和 Visual Tokens 无法同时出现在目标首屏。
- [P1] 路线 1 中心作品结构错误：目标是紧凑六行表格、贯穿行间的垂直状态轨、局部退回线与底部时间轴；实现增加整行深色关系条，并改变了列宽、行高和信息密度。
- [P1] 路线 3 首屏比例错误：标题与导语明显放大，织机开始位置过低；目标在一屏内完整展示织机、右侧交付收据、人类决策和底部“三种声音”，实现只显示被截断的织机与右栏。
- [P1] 路线 3 织机语言被简化：目标有高密度经纬线、连续弯折主线、局部退回段与紧凑证据条；实现更接近普通网格上的大卡片流程图，证据织物的密度与比例不足。
- [P2] 两条路线的字体尺寸、顶栏边距、段落行距、边线重量和首屏纵向节奏均未按原图校准。

### 必须修复

1. 只重做 `style1.html` 与 `style3.html`；两个 `indexN.html` 暂停迁移。
2. 以 1487×1058 目标图逐区测量，不再接受“同气质”“概念成立”作为视觉通过条件。
3. 修后必须在相同尺寸、相同状态重新捕获，制作新的并排比较，并由独立审查者关闭全部 P1/P2。

### 修后同尺寸证据

- 路线 1 最终并排：`/Users/wing/.codex/visualizations/2026/07/17/019f70b3-b15a-7f91-b5dd-2b932bef26e6/precision-rework/style1-source-vs-v3.png`
- 路线 3 最终全屏：`/Users/wing/Develop/moebius/.claude/worktrees/website-diff-analysis-11da70/artifacts/acceptance/style3-segmented-curve-1487x1058.png`
- 路线 3 曲线聚焦比较：`/Users/wing/Develop/moebius/.claude/worktrees/website-diff-analysis-11da70/artifacts/acceptance/style3-curve-target-vs-implementation.png`
- 精确独立审计：`openspec/changes/unify-marketing-visual-v02/reviews/precision-fidelity-audit.md`

### 修复与复验历史

1. 路线 1 删除自创 Hero、右侧宣言和深色整行详情条，恢复原图六行底单、中央蓝轨、红色退回、绿色通过、真人菱形、时间轴与 Visual Tokens。六项像素门槛、交互和移动端由独立审查者复验通过。
2. 路线 3 首次重构恢复单行标题、纵向角色织机、完整收据、真人决策与三声部，但因终态卡片双框和常驻推进控件两项 P2 被打回；修后静态态恢复目标单线卡片，控件仅在 hover/focus 时出现。
3. 用户继续指出曲线不对。第一版虽调用 `bezierCurveTo()`，仍用跨层大弧，被独立审查者以 P1 打回。最终将主线拆为近直段与短半径三次贝塞尔转角，红线拆为“水平—短拐—竖直—短拐—水平”，绿色只覆盖对应局部。
4. 路线 3 最终曲线骨架像素复验：中位偏差 0 px，91.9% 在 4 px 内，98.8% 在 6 px 内，最大偏差 10 px；旧曲线仅 52.7% 在 4 px 内。

### 最终视觉表面复核

- 字体：路线 1 任务标题 31px；路线 3 标题 36px 单行，层级与原图一致。
- 布局：路线 1 底单 `x=50, y=201, w=1387`；路线 3 织机 `y=278`、收据 `x=1125, y=138`、真人边界 `y=742`、三声部 `y=849`、页脚 `y=999`。
- 颜色：蓝色推进、红色退回、绿色通过与中性织纹均收敛到原图关系，未扩散语义色。
- 图像与资产：两页无缺失远程资产；核心底单与织机是可操作界面，不以静态图片代替交互。
- 文案：任务编号、角色、证据、退回原因、真人决策与交付收据均与目标叙事一致。
- 响应式与可访问性：1487×1058 与 390×844 无页面级横向溢出；键盘、ARIA、reduced-motion、no-JS 和控制台检查通过。

## 最终裁决

路线 1 与路线 3 已以最初图片为唯一视觉事实源完成重做，并由独立审查者关闭全部 P1/P2；两个 `indexN.html` 仍保持暂停，等待用户先验收 `styleN.html`。

final result: passed

---

# Operator Console Page 共享视觉迁移 QA · 2026-08-14

## 验收范围与视觉事实源

- 范围：Storybook `Page/Console/OperatorConsole` 下全部 20 个 Page Story。
- 参考 Story：`page-console-operatorconsole--dashboard-shell-with-right-sidebar`。
- 参考截图：`/tmp/operator-console-reference-1440x832.png`。
- 迁移后截图：`/tmp/operator-console-after-1440x832.png`。
- 同状态并排比较：`/tmp/operator-console-reference-comparison.png`。
- 全部 Page 联系表：`/tmp/operator-console-qa-contact-sheet.png`。
- 视口配置：Storybook `balancedDesktop`，声明尺寸 1440×832；Codex Desktop 浏览器实际 CSS 可视区及截图尺寸为 1309×756，参考与实现使用同一密度和同一状态，不做跨密度缩放比较。

完整视图用于判断侧栏、主画布、右侧栏、消息轴、排队区和输入区的共同骨架。此次迁移不更换内容 fixture，因此局部内容长度差异属于 Story 状态差异，不作为视觉漂移。参考与实现截图像素变化占比约 8.52%，平均通道差约 4.08；并排复核未发现结构、层级、边界、圆角或密度的可见退化。

## 共享实现证据

- Story meta 的唯一 Page 组件改为 `ResponsiveOperatorConsole`，并统一注入 `appearance: "focused"`。
- 19 个普通 Story 直接继承共享 meta；唯一带本地交互状态的 `ProjectActions` 也把 Story args 透传到同一个 `ResponsiveOperatorConsole`，未复制页面壳层。
- 20 个 Story 均保留各自消息、运行状态、侧栏开关、深色和窄窗 fixture，只共享布局与视觉实现。
- Storybook 索引中的 20 个具体条目均使用中文显示名；技术标识 `T6.5`、`Pi API` 仅作为不可翻译产品/协议名保留。

## 逐页检查矩阵

对 20 个 Story 各检查 7 项：Page 根节点、主画布颜色、面板边界/圆角/阴影、页面级横向溢出、400 基础字重、侧栏颜色/宽度、项目条目 28px 高度与 6px 圆角。加载态和关闭侧栏态按其预期省略项目条目检查。

- 通过 Story：20/20。
- 通过断言：140/140。
- 通过率：100.0%，高于退出阈值 95%。
- 浅色主画布：`#fff`；浅色侧栏：`#fcfcfc`；深色主画布：`rgb(39, 40, 45)`；深色侧栏：`rgb(29, 30, 34)`。
- 主面板：12px 圆角、约 1px 边界、共享面板阴影。
- 侧栏：桌面约 228px；关闭侧栏 Story 为 0px；项目条目约 28px 高、6px 圆角。
- 全部 Story 页面级横向溢出为 0。

## 响应式与交互证据

- 左侧抽屉窄窗：`/tmp/operator-console-narrow-700x600.png`，实际 636×545；主画布保留，左侧栏作为覆盖抽屉出现，页面无横向溢出。
- 右侧栏窄窗：`/tmp/operator-console-right-sidebar-narrow.png`，实际 636×545；右侧栏自动收起，只保留主窗口和重新打开按钮，页面无横向溢出。
- 团队可追溯窄窗：`/tmp/operator-console-team-traceability-narrow.png`，实际 618×727；上下文工具条未换行，页面无横向溢出。
- `ProjectActions` play Story 在干净浏览器标签页完成新增、重命名、排序和移除流程；反馈为“项目已从侧栏移除，磁盘文件夹保留。”，无 `NotFoundError` 或 play assertion error。

## 打回与复验历史

1. 第一轮视觉迁移后，20 个 Page 的共享外观和响应式指标已一致；无 P0/P1。
2. 第一轮交互复验发现 P2：`ProjectActions` 使用合成 PointerEvent 时，浏览器未建立原生 pointer capture，直接调用释放接口会抛 `NotFoundError`。改为安全捕获/释放 helper 后，在干净浏览器标签页复验通过。
3. 受影响测试随后暴露 P2：Story 切换到响应式共享组件后，jsdom 没有 `window.matchMedia`。补齐该 Story 测试的浏览器能力桩后，165/165 受影响测试通过。
4. 第二轮完整视觉矩阵为 20/20 Story、140/140 检查项，无剩余 P0/P1/P2，因此按用户设定退出循环。

## 自动化验证

- `pnpm --filter @moebius/console-ui typecheck`：通过。
- `pnpm run test --scope`：3 个测试文件、165 个测试通过。
- `pnpm --filter @moebius/console-ui check:storybook`：通过，Storybook 静态构建完成。

final result: passed
