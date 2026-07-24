# desktop-shell delta：restore-onboarding-action-footer

## Requirement: 四步共享稳定的 780px 对齐框架与固定底部操作 footer

Source: docs/product/pages/onboarding.md#步骤操作行每屏
Acceptance ID: `onboarding#11`

四步 MUST 共享最大约 780px 的响应式内容对齐框架。第 1、2、4 步普通内容 MUST 在框架内保持约 512px 的阅读宽度；第 2 步 AI 团队设计器与第 3 步接力舞台 MAY 使用框架完整宽度。

全局步骤操作 MUST 位于独立的全宽 footer 中；该 footer MUST 稳定占据窗口底部、与可滚动步骤主体分离且不得覆盖主体。footer 内部 MUST 使用最大约 780px 的响应式对齐边界，把操作以 8px 间距右对齐，并让最右侧主操作与内容框架共用右边缘。footer MUST NOT 渲染步骤圆点、`n / 4` 或其它第二套进度。AI 团队设计器子流程打开时 MUST 隐藏全局 footer。

### Scenario: 连续浏览普通步骤与宽版步骤

- GIVEN 用户从第 1 步连续前进到第 4 步
- WHEN 主体在约 512px 普通内容与约 780px 宽版内容之间切换
- THEN 全局步骤 footer 始终占据窗口底部且不随主体滚动
- AND 操作按钮保持 8px 间距并与约 780px 框架共用右边缘
- AND footer 中不存在步骤圆点或 `n / 4` 文本。

### Scenario: 低窗口响应式降级

- GIVEN 窗口高度不足以完整显示当前步骤内容
- WHEN 用户滚动步骤主体
- THEN 主体可独立滚动且不被 footer 覆盖
- AND footer 及其操作保持可见。

### Scenario: AI 团队设计器打开

- GIVEN 用户位于第 2 步
- WHEN 用户打开 AI 团队设计器
- THEN 全局步骤 footer 不渲染
- AND 设计器自己的返回、调整和创建操作保持可达。
