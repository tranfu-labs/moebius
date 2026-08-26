# console-ui 规格增量

## MODIFIED Requirements

### Requirement: 验收 #8 工作空间在选择处说明边界

Source: docs/product/pages/main-conversation.md#选择独立工作空间的说明

系统 MUST 在发出第一条消息之前提供工作空间选择，并在同一菜单项内说明副本基于项目当前所在的提交、不包含尚未提交的改动；选择“独立工作空间” MUST 直接完成当前草稿的选择，不得额外打开确认弹窗。非 Git 项目 MUST 在同一菜单内禁用“独立工作空间”并显示不可选原因。系统 MUST NOT 暗示切换会回滚、清理或搬运已经产生的改动，MUST NOT 在对话已经开始后仍提供该选择。

### Scenario: 新对话直接选择独立工作空间

- GIVEN 新对话页已选定一个 Git 项目且尚未发出消息
- WHEN 用户打开工作空间菜单并选择“独立工作空间”
- THEN 当前草稿立即切换到独立工作空间
- AND 页面不出现额外确认弹窗
