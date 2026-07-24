# 任务：add-content-production-seed-team

- [x] 新增内容生产团队核心定义与独立 onboarding 编排。
- [x] 将五份原始角色稿适配为带规范身份和本地交棒约定的成员 `AGENT.md`。
- [x] 扩展团队播种测试，覆盖内容生产团队定义、成员身份和编排。
- [x] 运行定向测试、类型检查和完整测试。

## 验证记录

- `pnpm --filter @moebius/desktop exec vitest run tests/team-seed.test.ts`：通过，6 项测试全部通过。
- `pnpm typecheck`：通过，根、desktop 与 console-ui TypeScript 检查均通过。
- `pnpm test`：582 项中 580 项通过；未改动的 `local-console.test.ts` 有 1 项固定 10 秒超时，`local-console-workspace-diff.test.ts` 有 1 项因本机 Codex rollout 返回 `unreadable` 而非预期 `not-found`。两项单独复跑仍失败，调用链均不经过 seed team 内容或播种测试。
- `git diff --check`：通过。
