# console-ui delta：stabilize-onboarding-navigation

## Requirement: 第 3 步使用宽版且高度可降级的接力舞台

Source: docs/product/pages/onboarding.md#主体区每屏

系统 MUST 在宽窗口下让第 3 步接力舞台使用约 780px 对齐框架，同时 MUST 保持第 1、2、4 步普通内容约 512px 的阅读宽度。全局“上一步 / 继续”操作行 MUST 位于接力舞台外下方 16px，并保持可见、右对齐且与约 780px 框架共用右边缘。

当可用高度不足或编排超过标准六棒时，系统 MUST 只让接力时间线内部滚动；接力卡标题、角色表头、重新播放、完成说明和外部步骤操作行 MUST 保持可达。系统 MUST NOT 以强制改变 Electron BrowserWindow 尺寸、裁切消息正文、恢复窗口底部 footer 或隐藏引导操作来获得空间。

### Scenario: 默认桌面窗口显示六棒

- GIVEN Electron 主窗口为默认 `1180 × 760`
- AND 所选开发团队包含标准 6 拍
- WHEN 用户进入第 3 步
- THEN 接力舞台使用约 780px 宽版
- AND 团队名、成员标签与 6 条消息均可读取
- AND “重新播放”“上一步”“继续”保持可见
- AND “上一步 / 继续”位于接力舞台外下方并与舞台右边缘对齐。

### Scenario: 最小高度窗口

- GIVEN 窗口高度缩小到允许的最小高度
- WHEN 第 3 步时间线无法完整容纳所有拍次
- THEN 只有时间线容器产生纵向滚动
- AND 接力卡标题、角色表头、完成说明和外部步骤操作行仍可达。
