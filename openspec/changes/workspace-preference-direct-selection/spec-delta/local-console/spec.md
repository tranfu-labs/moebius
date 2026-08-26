# local-console 规格增量

## MODIFIED Requirements

### Requirement: 新对话草稿跨导航保持同一上下文

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

用户在新对话中明确改选项目时，工作空间 MUST 按目标项目当前保存的缺省模式重新选择；用户在工作空间菜单中显式选择后，当前草稿 MUST 立即切换，并 MUST 立即更新目标项目的缺省模式。恢复已有新对话草稿或切换已有会话时，草稿中的工作空间 MUST NOT 自动提升为全局或项目级偏好。

### Scenario: 显式选择只更新当前项目偏好

- GIVEN 项目 A 的缺省模式为 direct、项目 B 的缺省模式为 worktree，且当前新对话已选择项目 A
- WHEN 用户在首条消息发送前选择 worktree
- THEN 当前新对话草稿立即使用 worktree
- AND 项目 A 的缺省模式立即更新为 worktree
- AND 项目 B 的缺省模式与已有会话保持不变
