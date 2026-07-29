# marketing-site 规格增量

## MODIFIED Requirement: 官网页面结构与核心操作

Source: docs/product/pages/home-page.md#页面结构

正式首页 MUST 采用页头、首屏、Leader Agent 宣言、团队/对话/分析三个能力段、最终行动与页脚的连续结构。页头与最终行动 MUST 提供可用的 Apple Silicon macOS 下载和 GitHub 源码入口。

### Scenario: 访客理解产品并采取行动

- GIVEN 访客打开正式首页
- WHEN 从首屏浏览到最终行动
- THEN 能依次理解团队选择、会话推进和对话分析
- AND 能进入公开 GitHub 仓库或下载当前稳定的 Apple Silicon macOS 版本

## ADDED Requirement: 下载链接可用且可降级

Source: docs/product/pages/home-page.md#页面状态

下载按钮 MUST 至少指向 `tranfu-labs/moebius` 的最新稳定 Release 页面。页面成功解析最新稳定 Release 的 `-mac-arm64.dmg` 资产时 SHOULD 将按钮升级为该资产直链；解析失败时 MUST 保留 Releases 后备链接，不得产生空链接或伪造资产地址。

### Scenario: GitHub API 不可用

- GIVEN 页面无法取得最新 Release 数据
- WHEN 访客点击任一下载按钮
- THEN 仍进入 `tranfu-labs/moebius` 的最新稳定 Release 页面

### Scenario: 最新 DMG 可解析

- GIVEN 最新稳定 Release 包含 `-mac-arm64.dmg` 资产
- WHEN 页面完成下载链接解析
- THEN 所有下载按钮统一指向该 DMG 直链
