# 提案：unify-marketing-visual-v02

> **作废归档（2026-08-02）**：本 change 作废，不执行其 19 条未完成任务。它依赖的事实源与对照物已失效：2026-07-29 用户确认正式 `sites/marketeam/index.html` 为深色工作台首页，2026-07-30 又由 `sites/marketeam/rebrand-narrative-plan.md` 建立新的品牌叙事候选链；旧的 v0.2 三路线收敛程序不再代表当前产品决策。候选文件与旧 spec-delta 保留在 archive 作为历史快照，不回流 `openspec/specs/`。未来若继续推进营销方向，必须以当前正式页和 `rebrand-narrative-plan.md` 为事实源另起 change，不得复用本 change。

## 背景
当前 marketing-site 存在四层视觉事实漂移：`openspec/specs/marketing-site/spec.md` 仍要求旧的新野兽派规则，正式 `index.html` 已改为低饱和细线台账，未提交的 `docs/marketing-site/视觉宪法.md` 与 `style.html` 又演进到 v0.2，但 v0.2 的三声部、中心作品、参数化肌理和关系型悬停尚未进入正式页。

外部 Kimi ASIC 页面仅作为编辑部式设计语言的对照，不是 Moebius 的代码、内容或部署目标。本变更不得复制其研究内容、D3/Canvas 数据系统、Kimi SDK 或跨域数据依赖。

## 提案
以视觉宪法 v0.2 为唯一视觉准绳，建立不可跨越的两阶段验收闸门：

1. 阶段一只完善视觉宪法、`style.html` 样张及其测试/验收证据，把样张建设成令牌、版式、中心作品、交互和动效的验收实验室。
   阶段一内部再按“基础与版式 → 中心作品与关系交互 → 响应式与降级”提供三次可见检查点，上一检查点的问题先收敛再推进下一检查点。
2. 在用户明确回复“style.html 验收通过”之前，MUST NOT 修改 `sites/marketeam/index.html`。
3. 阶段二只迁移已经通过样张验收的令牌、组件、版式和交互语义到正式六板块官网，并再次完成响应式、可访问性和降级验收。
4. 归档时将 marketing-site spec、正式页面线框和 flow 统一到已实现的 v0.2 事实。

## 影响
- 业务域：`marketing-site`
- 阶段一：`docs/marketing-site/视觉宪法.md`、`sites/marketeam/style.html`、样张测试与验收脚本
- 阶段二：`sites/marketeam/index.html`
- 事实源：`openspec/specs/marketing-site/spec.md`、`docs/wireframes/pages/marketeam-landing.md`、`docs/wireframes/flow.md`
- 明确不包含：域名/Coolify/Docker 发布链路治理、Kimi 页面复刻、业务叙事重写、多页面或构建系统引入
