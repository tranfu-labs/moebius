# 提案：align-onboarding-prototype-with-desktop

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | 页面结构、区域与信息、操作与反馈、页面状态、指标与验收 | 以 desktop 已实现的四步标题、副本、团队选择、AI 建队、接力演示及按钮文案为最终产品口径 | 已写入 |

## 背景

正式 desktop 引导页已经完成，但 onboarding PRD 与独立高保真原型仍保留上一版结构和文案。当前同一旅程存在三套可见口径：desktop 使用“环境准备”“选择一支团队”“AI 团队设计器”等新表达，PRD 与 prototype 仍使用“设置 Codex”“选择团队”“创建团队”等旧表达，导致产品评审打开单 HTML 时看到的不是实际产品。

## 提案

- 把 desktop 当前可见文案与信息层级确认为 onboarding 的产品事实，并更新页面 PRD。
- 在保持 prototype 与正式代码双向隔离的前提下，将 `prototypes/` 内的静态夹具、四步骨架、团队卡、AI 建队子流程、接力演示和完成去向投影到 desktop 当前呈现。
- 重新构建并发布自包含 `docs/product/pages/onboarding.prototype.html`。
- 扩展 prototype 验收，直接断言关键 desktop 文案和结构，防止后续再次漂移。

## 影响

- 产品事实源：`docs/product/pages/onboarding.md`
- 原型源码与验证：`prototypes/src/`、`prototypes/scripts/verify-onboarding.mjs`
- 行为规格：`openspec/specs/design-prototypes/spec.md`
- 生成交付物：`docs/product/pages/onboarding.prototype.html`
