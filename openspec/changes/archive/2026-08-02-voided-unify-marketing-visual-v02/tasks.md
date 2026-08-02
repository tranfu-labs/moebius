# 任务：unify-marketing-visual-v02

## 三路线候选实验
- [x] 路线 1：实现 `style1.html` 与 `index1.html`（运行中底单）。
- [x] 路线 2：实现 `style2.html` 与 `index2.html`（接棒场）。
- [x] 路线 3：实现 `style3.html` 与 `index3.html`（证据织机）。
- [x] 循环交叉验收：路线 1 审路线 2、路线 2 审路线 3、路线 3 审路线 1。
- [x] 所有 P0/P1/P2 问题均已打回原作者修复，并由原审查者复验通过。
- [x] 生成三组 desktop/tablet/mobile、交互、reduced-motion、no-JS 和控制台证据并向用户并排展示。
- [ ] 用户选择或组合候选路线后，再继续正式 `style.html` 的收敛；编号候选不得直接覆盖正式文件。

## 阶段一：style.html
- [ ] 将 marketing-site 的视觉规则与视觉宪法 v0.2 对齐，消除旧新野兽派冲突。
- [x] 完成 `style.html` 的潜台词、基础令牌、三声部和版式语法样本。
- [ ] 生成并展示检查点 A（基础与版式）证据，收敛反馈后再继续。
- [ ] 完成唯一中心作品的点阵、套准标、轨道、底单与反差层级。
- [ ] 将中心作品时间状态收敛为可单测的纯 `frameAt(t)` 模型并补齐单元测试。
- [ ] 完成底单行 ↔ 轨道站点的 hover/focus 联动、底单下钻和播放/暂停/拖动控制。
- [ ] 生成并展示检查点 B（中心作品与关系交互）证据，收敛反馈后再继续。
- [ ] 补齐展开控件的 `aria-expanded` / `aria-controls` 与清晰键盘焦点。
- [ ] 完成 desktop/tablet/mobile、reduced-motion 和 no-JS 降级。
- [ ] 运行样张单元测试、类型检查与浏览器验收脚本，生成多视口/固定帧证据。
- [ ] 生成并展示检查点 C（响应式、降级与可访问性）最终证据。
- [ ] 向用户展示 `style.html` 验收结果并等待明确的“style.html 验收通过”。

## 人工闸门
- [ ] 用户已明确确认 `style.html` 验收通过；未勾选时 MUST NOT 修改 `sites/marketeam/index.html`。

## 阶段二：index.html
- [ ] 将已通过的令牌、三声部、版式节奏和中心作品迁移到正式六板块页面。
- [ ] 为六板块逐屏落实反差锚点和关系型交互，不引入样张说明文案。
- [ ] 保留并复核 skip link、语义结构、锚点、移动端顺序阅读和 reduced-motion 降级。
- [ ] 补齐正式页交互控件的 ARIA 状态与 no-JS 可读性。
- [ ] 运行正式页单元/契约测试、类型检查与三视口浏览器验收。
- [ ] 对照 proposal、design、spec delta 和 wireframes 逐项复核实现，无偏差后进入项目级归档流程。
