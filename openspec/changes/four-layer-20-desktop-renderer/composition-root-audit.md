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
