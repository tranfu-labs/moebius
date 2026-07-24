# 提案：add-content-production-seed-team

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | `软件内置团队` | 新增内容生产团队的产品身份、成员分工和只读边界 | 已写入 |

## 背景

当前安装包只播种开发团队。已有五份内容生产角色稿分别覆盖总控、证据调研、创作编辑、视觉生产和发布包装，但尚未采用 Moebius 团队磁盘结构，也没有本地会话交棒规则或首次引导协作示例，因而不能作为一支内置团队随桌面应用交付。

## 提案

1. 新增稳定 id 为 `content-production` 的内置团队，由 `content-production-orchestrator` 担任主 Agent，并按总控、证据调研、创作编辑、视觉制作、发布包装排列五名成员。
2. 轻量适配五份角色稿：保留原职责、指定 Skill、调用模式和边界，补充规范身份 frontmatter 与 Moebius 本地会话协作约定。
3. 新增独立、版本化的 6 拍 onboarding 编排，用一条完整交付链展示五名成员的职责；该编排不进入真实会话 prompt，也不定义固定执行顺序。
4. 扩展内置团队播种测试，验证开发团队保持不变，并验证内容生产团队的核心定义、成员身份与 onboarding 编排均可读取。

## 影响

- `seeds/teams/content-production/`：新增团队核心、独立引导编排和五名成员定义。
- `desktop/tests/team-seed.test.ts`：增加内容生产团队的播种契约断言。
- `openspec/specs/desktop-shell/spec.md`：归档时新增内容生产内置团队的行为事实。
- 不修改团队播种实现、运行时调度器或 renderer 布局。
