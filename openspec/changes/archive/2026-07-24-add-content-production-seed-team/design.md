# 设计：add-content-production-seed-team

## 方案

### 团队结构

新增目录：

```text
seeds/teams/content-production/
├── team.json
├── onboarding-orchestration.json
└── members/
    ├── content-production-orchestrator/AGENT.md
    ├── evidence-research/AGENT.md
    ├── editorial-production/AGENT.md
    ├── visual-production/AGENT.md
    └── publishing-delivery/AGENT.md
```

`team.json` 只保存名称、单行描述、主 Agent slug 和成员顺序。五名成员的显示身份只写在各自 `AGENT.md` 的 `display_name` 与 `description` frontmatter 中。原稿列出的 Skill 依赖继续保留；缺失依赖时按原稿要求阻断，不静默替换能力。

### 本地协作适配

总控是默认接单者、阶段门禁和最终可见收尾者。它一次只使用一个合法成员 mention 派发明确任务；成员完成后不跨角色直接推进，而是把结果交回总控。成员的独立调用能力仍保留，但不得让局部结果冒充完整流水线交付。

总控保持原稿中的状态与验收责任，不替代业务成员产出内容。成员保持原有职责边界，不通过交棒扩大自己的调研、写作、视觉或发布权限。

### 引导编排

独立编排采用 6 拍：

1. 总控拆解目标并派发证据调研。
2. 证据 Agent 返回选题与证据包。
3. 编辑 Agent 形成终稿和标题。
4. 视觉 Agent 完成配图与封面。
5. 发布 Agent 完成媒体优化和 HTML 包装。
6. 总控核对血缘与风险后收尾。

这条编排只用于 onboarding RelayDemo。真实任务仍由总控根据当前输入、门禁与局部需求灵活调度。

## 单元测试用例

1. 从完整 `seeds/teams/` 播种后，既有 `development` 团队仍保持原定义与 6 拍编排。
2. `content-production` 团队状态为 `usable`，主 Agent 和五名成员顺序与 manifest 一致。
3. 五份成员文件均能解析规范 frontmatter，显示名称和单行描述准确。
4. 内容生产团队独立 onboarding 编排状态为 `ready`，共 6 拍且每个 `speakerSlug` 都属于当前成员。

## AI 验证流程

1. 运行 `pnpm exec vitest run desktop/tests/team-seed.test.ts`，验证两支内置团队的播种、读取和升级路径。
2. 运行 `pnpm typecheck`，确认测试与现有 TypeScript 契约一致。
3. 运行 `pnpm test`，确认新增 seed 内容没有影响其他桌面与本地运行行为。

## 权衡

- 选择新增独立团队而不是扩展开发团队：内容生产角色与软件研发职责完全不同，独立团队能保持成员清单和主 Agent 语义清晰。
- 保留原 Skill 名称而不改成通用能力描述：这些名称是角色稿既有的明确执行契约；擅自替换会改变职责和失败语义。
- 使用完整 6 拍而不是每个角色只写静态说明：接力示例能展示主 Agent 收发控制权，并覆盖全部五名成员，同时仍与真实调度隔离。

## 风险

- 用户环境若没有角色指定的 Skill，相关任务会按角色契约阻断；这是显式依赖行为，不做静默降级。
- 成员较多时 onboarding 图宽度增加；现有 RelayDemo 已按成员数计算等宽轨道并支持响应式滚动，本变更不新增布局规则。
- seed 内容指纹会变化，桌面下次启动将按既有规则整体替换 `.system/` 内置团队；用户团队不受影响。
