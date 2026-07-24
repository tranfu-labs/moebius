# desktop-shell spec delta：add-content-production-seed-team

## Requirement: 安装包提供开发与内容生产内置团队

Source: docs/product/pages/agent-teams.md#软件内置团队

安装包 MUST 在 `seeds/teams/` 中提供 `development` 与 `content-production` 两支结构有效的内置团队。`content-production` MUST 由内容生产总控担任主 Agent，并包含证据调研、创作编辑、视觉制作和发布包装成员；其成员身份 MUST 来自各自 `AGENT.md`，首次引导协作示例 MUST 保存在独立 `onboarding-orchestration.json` 中。

### Scenario: 首次播种内容生产团队

- **GIVEN** 新数据根尚未播种内置团队
- **WHEN** 桌面应用从安装包执行团队播种
- **THEN** `content-production` 团队状态为 usable
- **AND** 主 Agent 是 `content-production-orchestrator`
- **AND** 五名成员身份均可从各自 `AGENT.md` 读取
- **AND** 独立 onboarding 编排只引用当前团队成员。
