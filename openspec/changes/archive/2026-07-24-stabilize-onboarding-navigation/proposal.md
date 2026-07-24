# 提案：stabilize-onboarding-navigation

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | 页面结构 / 主体区 / 步骤操作行 / 指标与验收 | 将四步导航从全窗口底部 footer 改为 780px 对齐框架外下方的右对齐操作行，并删除重复的底部圆点与 `n / 4` | 已写入 |

## 背景

当前 onboarding 的普通步骤使用约 512px 内容列，宽版步骤使用约 780px 内容列，但底部 footer 内部另用 640px 宽度。步骤切换时，内容与导航没有共同的右边缘，按钮位置缺少稳定锚点；底部圆点和 `n / 4` 还与标题区的“第 n 步，共 4 步”重复表达进度。

## 提案

1. 四步共用最大 780px 的响应式对齐框架，普通内容继续在框架内以约 512px 居中，AI 团队设计器与接力舞台可使用完整宽度。
2. 全局步骤操作行成为内容区的同级元素，位于内容区外下方 16px，宽度与 780px 对齐框架一致，按钮右对齐且间距为 8px。
3. 删除全窗口底部 footer、顶部分割线、四个步骤圆点及 `n / 4`；标题区“第 n 步，共 4 步”成为唯一进度提示。
4. AI 团队设计器子流程打开时隐藏全局步骤操作行，保留子流程自己的操作。
5. 同步正式 `OnboardingShell` 与隔离高保真原型，确保 PRD、原型和正式实现的可见结构一致。

## 影响

- 产品事实：`docs/product/pages/onboarding.md`
- 行为规格：`openspec/specs/desktop-shell/spec.md`、`openspec/specs/console-ui/spec.md`
- 正式 UI：`packages/console-ui/src/onboarding/onboarding-shell.tsx`
- 高保真原型：`prototypes/src/main.tsx`、`prototypes/src/styles.css` 及发布后的单 HTML
- 测试：onboarding shell 组件测试、原型完整门禁与视觉截图验证
