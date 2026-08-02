# 40 批 composition root 条件分类审计

口径沿用系列 design：TypeScript AST 的 `if` / ternary / loop condition / case / `&&` / `||` / `??`
全量计数；wiring + timing + business 必须等于 AST 条件总数。本簇没有新增 root，只复核被收薄的既有
`desktop/src/ai-team-builder/index.ts`。

## `desktop/src/ai-team-builder/index.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 50 | `options.codex ?? new AiTeamBuilderCodexSpawner()` | wiring | 可选注入或创建默认 Codex driver adapter |
| 51 | `options.claude ?? new AiTeamBuilderClaudeSpawner()` | wiring | 可选注入或创建默认 Claude driver adapter |
| 52 | `options.kimi ?? new AiTeamBuilderKimiSpawner()` | wiring | 可选注入或创建默认 Kimi driver adapter |
| 58 | `options.writer ?? new AiTeamWriter(...)` | wiring | 可选注入或装配 writer application 与 storage/record ports |
| 68 | `options.resolveExecutionProfile ?? resolveAiTeamBuilderExecutionProfile` | wiring | 可选注入或装配默认 capability resolver |

复算：wiring 5 + timing 0 + business 0 = AST 条件 5。root 为 84 逻辑行，只创建 file store、draft
repository、turn runtime、service、writer 与三家 provider adapter，再把六个公开方法转发给 service；draft
migration、action legality、repair、session identity 和 atomic team write 判据均位于纯 `plan*` 模块。

`builder-service.ts`、`turn-runtime.ts`、`draft-repository.ts` 与 `team-writer.ts` 均登记为受
`[IB:application-use-case-shape]` 约束的 application，不进入 composition-root allowlist。
