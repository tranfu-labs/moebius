# 提案：restore-onboarding-action-footer

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | 每步共用的内容与操作骨架 / 主体区 / 步骤操作行 / 指标与验收 | 将随内容滚动的操作行恢复为固定占据窗口底部的纯按钮 footer，同时保留顶部唯一进度提示与 780px 对齐边界 | 已写入 |

## 背景

当前四步引导把“上一步 / 继续”放在当前步骤内容之后。操作区会随内容高度改变垂直位置，短窗口中还可能需要滚动到内容末尾才能触达。用户希望恢复此前稳定占据窗口底部的 footer 形态，但不恢复 footer 中已移除的步骤圆点或 `n / 4` 重复进度。

## 提案

1. 在应用标题栏和可滚动步骤主体之外增加全宽底部操作 footer；footer 作为页面 flex 布局的末端区域固定占据窗口底部，不覆盖主体内容。
2. footer 使用顶部分割线，内部沿用最大约 780px 的响应式对齐边界；“上一步 / 继续”等按钮保持右对齐，间距 8px。
3. footer 只承载当前步骤操作，不显示步骤圆点、`n / 4` 或其它进度；标题区“第 n 步，共 4 步”继续作为唯一进度提示。
4. AI 团队设计器子流程打开时隐藏全局 footer，只保留设计器自己的返回、调整和创建操作。
5. 同步正式 `OnboardingShell`、隔离高保真原型、结构测试和视觉验收，使 PRD、原型与正式实现保持一致。

## 影响

- 产品事实：`docs/product/pages/onboarding.md`
- 行为规格：`openspec/specs/desktop-shell/spec.md`、`openspec/specs/console-ui/spec.md`
- 正式 UI：`packages/console-ui/src/onboarding/onboarding-shell.tsx`
- 高保真原型：`prototypes/src/main.tsx`、`prototypes/src/styles.css`、`prototypes/scripts/verify-onboarding.mjs` 及发布后的自包含 HTML
- 测试：onboarding shell 组件测试、原型完整门禁与宽窄窗口视觉截图
