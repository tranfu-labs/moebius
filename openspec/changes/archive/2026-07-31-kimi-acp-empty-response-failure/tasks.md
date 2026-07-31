# 任务：kimi-acp-empty-response-failure

- [x] 在 `src/kimi.ts` 实现纯 `KimiTerminalEvidence` reducer/decision，覆盖非空文本、
      completed/failed 工具终态以及所有非证据 update。
- [x] 新增 `KIMI_EMPTY_RESPONSE` → `kimi-empty-response` 稳定失败分类、安全文案和
      bounded 本地诊断；禁止把 wire/provider payload 或具体额度猜测写入结果。
- [x] 将 local execution callback 拆为 session observed 与 execution trace ready 两阶段，
      保持 engine/external id 一致性、幂等和 callback 失败时 fail closed。
- [x] 保持 Codex/Claude 在现有核验点同时提交两阶段；让 Kimi 在 id 核验后提交
      observation/canonical，并只在首个非空文本或终态工具结果后提交 execution link。
- [x] 同步修改主 Agent 与 detached worker runtime 路径：empty failure 为 failed，不提交
      Agent response、timeline cursor 或 execution link，但保留 observation/canonical。
- [x] 为合法 Kimi tool-only success 增加显式 completion disposition：完成 lifecycle、
      workspace diff 与 cursor，不写空 Agent response，不触发文本 handoff/control 解析。
- [x] 保证 empty failure 后 retry/re-run/edit-resend 精确 resume canonical Kimi session，
      不执行 replacement `session/new`、Codex/Claude fallback 或按最近 session 猜测。
- [x] 更新 console-ui 安全失败 code/文案，显示「这一步没跑起来」与「重试」，不显示
      空白 Agent 回复、403、路径、session id 或 raw payload；同时引导用户在终端直接
      运行 `kimi` 查看详细错误，不断言具体成因。
- [x] 增加 Kimi adapter 正反单测：bare end_turn、whitespace、thinking/plan/usage/config、
      pending/in-progress tool、非空 stream/result text、completed/failed tool、重复 update、
      “无需回答” prompt、callback failure 与诊断边界。
- [x] 增加 execution-driver/runtime 单测：两阶段顺序、Codex/Claude 回归、direct/detached
      empty failure、canonical resume、无 execution link/response/cursor，以及 tool-only
      success 无空 Agent response但推进 cursor。
- [x] 增加 console-ui 单测，覆盖安全文案、重试、机器信息过滤及父级重渲染/DTO 更新。
- [x] 新增 `scripts/acceptance/kimi-empty-response.ts`，驱动真实 Electron/Kimi CLI，按
      `design.md#7-真实运行验收` 断言两次 attempts、重启、facts、页面和本地诊断边界。
- [x] 同步新验收命令到 `AGENTS.md`，按最终职责核对
      `docs/architecture/module-map.md`；不新增组件模式时保持
      `packages/console-ui/DESIGN.md` 不变。
- [x] 运行 Kimi、execution-driver、local-console runtime、operator-console 定向 Vitest，
      `pnpm typecheck`、console-ui build、desktop build 与 `pnpm test`；SQLite 5s 随机
      timeout 按仓库约定隔离重跑并记录证据。
- [x] 完成真实页面验收并保存系统临时 evidence；若当前额度状态不再复现空 `end_turn`，
      明确记录环境阻塞，不以注入测试替代用户可见验收，不声明 `code-verified`。
- [x] 重跑 `pnpm exec tsx scripts/acceptance/provider-native-process-traces.ts`，以真实
      Electron evidence 确认 Claude `claudeThinkingToolAndResultVisible`、两个 attempts
      facts 与 `restartRetainsNativeTrace` 未受两阶段 execution-link 改造影响。
- [x] 对照 proposal/design/spec-delta 逐条反思，核对 PRD、错误码、link facts 与无 fallback
      不变量；归档前按 `provider-native-process-traces` → 本 change 的顺序重放核对
      Requirement；若前者仍因 Kimi 额度阻塞，则把本 change 已验证事实前移到其开放
      delta 后独立归档本 change。
