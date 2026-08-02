# 四层边界与 Oracle 总账

本账以 `docs/architecture/module-map.md` 为文档侧事实、`FOUR_LAYER_BOUNDARY_RULE_IDS` 为 checker 侧事实。
`tests/import-boundaries.test.ts :: checks marker completeness, NI reasons, uniqueness, and IB registry parity`
机械保证：文档 IB 不缺实现、registry IB 不漏文档、同一禁止项不重复登记、NI 原因非空。

## 1. Import boundary（19 条）

| stable ID | 实现 oracle | 回归 oracle |
| --- | --- | --- |
| `architecture-layer-assignment-total` | exactly-one assignment 扫描 | `requires one layer and follows domain runtime imports while ignoring type-only edges` |
| `architecture-layer-dependency-matrix` | 四层 runtime edge matrix | `reports each prohibited layer direction with its stable rule id` |
| `domain-pure-runtime-closure` | domain 传递闭包到 side effect/adapter | `requires one layer and follows domain runtime imports while ignoring type-only edges` |
| `view-no-side-effect-adapters` | view runtime edge 禁止矩阵 | `reports each prohibited layer direction with its stable rule id` |
| `application-no-view-dependency` | application→view 禁止，root exact 例外 | `reports each prohibited layer direction with its stable rule id` |
| `adapter-no-use-case-reentry` | adapter→application 禁止 | `reports each prohibited layer direction with its stable rule id` |
| `composition-root-narrow-allowlist` | exact root、stale root、单 runtime export | `enforces each application shape budget independently` |
| `application-use-case-shape` | ≤300 logical lines、complexity≤12、domain 委托/exact permit | `enforces each application shape budget independently` |
| `adapter-boundary-branch-total` | codec/transport 分类与 exact permit | `reports application and adapter business conditions with exact source locations` |
| `console-ui-no-runtime-internals` | console-ui import scope | `reports static import, export-from, and literal dynamic import violations` |
| `console-ui-no-side-effect-adapters` | console-ui→provider/process 禁止边 | 同上 + `pnpm check:boundaries` |
| `local-control-planner-pure-closure` | `control-dispatch.ts` 传递闭包 | `checks direct and transitive runtime paths while ignoring type-only edges` |
| `local-invocation-planner-pure-closure` | `run-invocation-plan.ts` 传递闭包 | 同上 |
| `stages-no-side-effect-adapters` | stages exact scope 禁止边 | `reports static import, export-from, and literal dynamic import violations` |
| `ceo-scripts-no-provider-adapters` | ceo-scripts exact scope 禁止边 | 同上 |
| `local-ceo-orchestration-no-side-effect-adapters` | parser exact scope传递闭包 | `checks direct and transitive runtime paths while ignoring type-only edges` |
| `triggers-no-side-effect-adapters` | trigger exact scope 禁止边 | `reports static import, export-from, and literal dynamic import violations` |
| `local-config-no-provider-adapters` | config exact scope 禁止边 | 同上 |
| `conversation-no-side-effect-adapters` | conversation exact scope 禁止边 | 同上 |

exact debt/permit 的棘轮由
`tests/import-boundaries.test.ts :: accepts exact live debt and rejects it after the violating edge disappears` 与
40 批 stale-permit 双向探针共同验证：条件指纹变化同时产生 `<stale-permit>` 与 `<unclassified>`。

## 2. Non-import invariant（17 条）

| stable ID | 可重复 oracle |
| --- | --- |
| `view-intent-only` | 10/20/40 composition-root audit 的 wiring/timing/business 复算；`operator-console.test.tsx` 组件隔离；RA-05a～10 |
| `desktop-no-business-rule-copy` | desktop controller/domain test 对账 + 40 批 composition-root audit（`main.ts` business=0） |
| `desktop-no-shell-concatenation` | `desktop/tests/team-file-manager.test.ts :: replaces missing, inaccessible, and shell errors with a stable error code`；IPC 参数为结构化 DTO |
| `desktop-no-resource-writeback` | `desktop/tests/team-store.test.ts :: moves a user team directory to recoverable trash and rejects built-in teams`；RA-14 Finder/repair |
| `console-ui-no-business-fact-copy` | `operator-console.test.tsx` 只断言 props→显示；对应 decision 由 desktop domain/controller tests 断言 |
| `local-console-local-only` | RA-11R/RA-12R 的真实进程树、端口与页面；无 runner child/observer/`gh` |
| `local-console-legacy-state-nondestructive` | RA-30D 启动前/terminal 后/Desktop 后 SHA-256 与逐表 31 行一致 |
| `local-entry-no-github-runtime` | `runtime-start.test.ts :: accepts no arguments and rejects retired or unknown modes before startup` + RA-11R |
| `agents-static-material-only` | `agent-manifest.test.ts :: returns the persona body without exposing retired runner metadata`；frontmatter parser tests |
| `stages-single-whitelist` | `stages.test.ts :: defines all supported stages` 与 marker parser 共用 `STAGES` |
| `ceo-scripts-data-only` | `ceo-scripts.test.ts :: loads the required script files as data`，无执行入口 |
| `local-ceo-orchestration-pure` | `ceo-orchestration.test.ts :: rejects invalid JSON and does not produce descriptors`；session 创建只在 application |
| `triggers-mention-only` | `triggers.test.ts :: uses only the latest local message as the trigger source` 与代码区 mention 反例 |
| `local-config-no-sensitive-state` | `local-config.test.ts :: loads provider defaults and lets config.local.toml override them`；结果仅 provider/model/runtime paths |
| `conversation-no-shell-content` | `conversation.test.ts :: ignores agent mentions inside fenced code blocks`；provider 进程测试断言 argv/stdin 分离 |
| `provider-adapter-no-business-routing` | `local-console-execution-runtime.test.ts :: freezes the selected member profile and hard-routes Kimi without invoking Codex`；RA-15 原生 session 对账 |
| `sqlite-legacy-github-state-nondestructive` | `sqlite-state.test.ts :: reuses a canonical lane through symlinks and reinitializes schema for each generation` + RA-30D 哈希/逐表对账 |

## 3. 去重结论

19 个 IB 各自保留稳定诊断 ID；即使共享底层 edge oracle，作用域、错误定位或迁移含义不同，删除会降低
诊断可读性。17 个 NI 约束的是 import graph 无法判定的数据流、文件目标或真实进程行为。最终去重删除 **0**。
