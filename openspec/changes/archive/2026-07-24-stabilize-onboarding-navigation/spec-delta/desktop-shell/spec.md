# desktop-shell delta：stabilize-onboarding-navigation

## Requirement: 标题区是引导唯一的步骤进度提示

Source: docs/product/pages/onboarding.md#顶部标题区每屏
Acceptance ID: `onboarding#10`

引导 MUST 在标题区显示“第 n 步，共 4 步”并与当前步骤同步。引导 MUST NOT 在内容下方或窗口底部重复渲染四个步骤圆点、`n / 4` 文本或其它第二套步骤进度。

### Scenario: 从第 2 步前进

- GIVEN 用户正在第 2 步
- WHEN 用户点击“继续”进入第 3 步
- THEN 标题区由“第 2 步，共 4 步”更新为“第 3 步，共 4 步”
- AND 页面不存在底部步骤圆点或 `3 / 4` 文本。

## Requirement: 四步共享稳定的 780px 对齐框架与外部操作行

Source: docs/product/pages/onboarding.md#步骤操作行每屏
Acceptance ID: `onboarding#11`

四步 MUST 共享最大约 780px 的响应式对齐框架。第 1、2、4 步普通内容 MUST 在框架内保持约 512px 的阅读宽度；第 2 步 AI 团队设计器与第 3 步接力舞台 MAY 使用框架完整宽度。

全局步骤操作行 MUST 位于当前步骤内容外下方 16px，宽度与对齐框架一致，并把操作以 8px 间距右对齐；最右侧主操作的右边缘 MUST 与对齐框架右边缘重合。系统 MUST NOT 用全窗口底部 footer、独立 640px 内层、absolute、fixed 或 sticky 定位承载该操作行。AI 团队设计器子流程打开时 MUST 隐藏全局步骤操作行。

### Scenario: 连续浏览普通步骤与宽版步骤

- GIVEN 用户从第 1 步连续前进到第 4 步
- WHEN 主体在约 512px 普通内容与约 780px 宽版内容之间切换
- THEN 全局步骤操作行始终使用同一个约 780px 右边缘
- AND 操作行与当前步骤内容的垂直间距为 16px
- AND 相邻按钮间距为 8px
- AND 页面没有全窗口底部操作 footer。

### Scenario: 窄窗口响应式降级

- GIVEN 窗口可用宽度小于 780px 加页面边距
- WHEN 用户浏览任一步骤
- THEN 对齐框架与操作行一起缩小到可用宽度
- AND 页面不产生水平滚动
- AND 主操作仍与框架右边缘对齐。
