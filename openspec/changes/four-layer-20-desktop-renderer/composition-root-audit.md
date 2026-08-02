# Composition root 条件分类审计

口径与系列 design §3.3 一致：TypeScript AST 的 `if` / ternary / loop condition / case / `&&` / `||` /
`??` 全量逐行分类，wiring + timing + business 必须等于 AST 条件总数。

## `desktop/src/onboarding/register.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 22 | `input.readiness ?? new OnboardingCliReadinessService()` | wiring | 可选注入或创建默认 readiness adapter |
| 23 | `input.installer ?? new OnboardingCliInstallManager(...)` | wiring | 可选注入或创建默认 installer adapter |
| 42 | `onboardingChannel === undefined` | wiring | 内部 channel map 完整性 guard，不读取业务字段 |
| 48 | `input.teamBuilder ?? new AiTeamBuilder(...)` | wiring | 可选注入或创建默认 builder application |

复算：wiring 4 + timing 0 + business 0 = AST 控制分支 4。文件只组装依赖和 channel adapter；没有
业务判据留在 composition root。

## `desktop/src/console-page/desktop-application-root.tsx`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 58 | `useContext(DesktopLanguageContext) ?? FALLBACK_DESKTOP_LANGUAGE` | wiring | Context 消费者脱离 Provider 时注入静态 fallback bundle；不读取业务字段，不改变路由或持久化决策 |

复算：wiring 1 + timing 0 + business 0 = AST 控制分支 1。语言持久化与重试由
`useDesktopLanguageController` 调度并委托 `language-state.ts` 的 `plan*` 决策；首次启动、完成与 replay
路由由 `DesktopRoutesController` / `OperatorConsoleRoute` 调度并委托 `desktop-routing-model.ts`。root
仅装配具名 `languageBundle`、i18n Provider、HashRouter 与 route controller。

## `desktop/src/console-page/use-agent-team-console.ts`

该 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 + business 0 = AST
控制分支 0。文件包含 9 次具名 team hook 装配和一次 memo 化透传；不持有业务状态、不注册 effect，
团队列表的 `ready` 状态形状由 `useAgentTeamCatalog` 内部的 `replaceTeams` 能力负责，builder 草稿
storage key 由 domain constants 提供。
