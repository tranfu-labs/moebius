# 任务：audit-console-state-composition

- [x] 记录审计基准 commit；确认 `app.tsx` 与邻近状态模块自方案核验后未变化，变化则重建声明坐标，不沿用旧行号。
- [x] 读取相关页面 PRD、`console-ui` / `desktop-shell` specs 和模块边界；只把它们作为用户后果与现有保护的 oracle，不修改事实源。
- [x] 建立 `H-001..H-086` hook 完整性表，核对 49 state / 3 reducer / 34 ref，并按 `App` 0、`DesktopLanguageRoot` 2、`DesktopRoutes` 1、`OperatorConsoleRoute` 3、`OperatorConsoleApp` 80 分项，区分两个 `state` 与两个 `pendingAgentTeamKey`。
- [x] 建立 22 行 effect ledger，逐个登记依赖、写目标、cleanup、异步边界和迟到提交判断。
- [x] 把同目录除 `app.tsx` 外的 22 个邻近文件全部列入模块覆盖附录；对有状态文件建立公开面表，覆盖 owner/key/version/generation/phase、持久化介质及 app 调用坐标，其余逐文件登记排除理由。
- [x] 在 `02c1604^` 历史快照上执行同一读写图方法；独立捞出草稿归属不变量、阅读 transition 窗口、用户后果和“显式化”动作，失败则先修订方法并重跑。
- [x] 逐 hook / effect / 外部状态面追踪声明、全部写点、关键读点和异步边界；将每项映射到开放风险或带机器证据的“登记即可”。
- [x] 生成可独立开 change 的风险条目；逐条写可判定不变量、最短反例时序、带 PRD / spec oracle 坐标的用户后果、三选一判定性质、`W/U/P/S/B`、公式总分、等级和三选一动作类型，不写实现方案或文件拆分建议。
- [x] 按总分与 tie-break 排序，并单列未来可提升进 `docs/architecture/invariants.md` 的候选及理由，不修改该事实源。
- [x] 在审计文档 fenced code block 中原样贴入 hook / effect / 组件作用域 grep 命令及数字输出；机械核对 `H-` 行数为 86、effect 行数为 22、作用域为 0 / 2 / 1 / 3 / 80、每个 `H-` 有且仅有风险 / 登记去向、每个风险有判定性质、五维评分、代码坐标和 oracle 坐标。
- [x] 对照 `design.md#方案验收清单` 逐条自审，记录限制与未验证项；确认 git diff 只有 change 文档与目标审计文档，不运行测试闸门。

## 交付记录

- 审计基准：`cf85d0b`；目标实现文件在审计期间未改动。
- 机械证据：49 `useState`、3 `useReducer`、34 `useRef`、22 `useEffect`；五个组件作用域分别为 0 / 2 / 1 / 3 / 80。
- 产物：`docs/architecture/console-state-composition-audit.md`；共 13 条开放候选、6 类已有保护、86 行 hook ledger、22 行 effect ledger、22 个邻近文件覆盖。
- 符合度反思：已用 `02c1604^` 作为已知答案校准，方法能在读取修复归档前独立捞出 draft owner 缺失；未将静态候选包装成运行时复现，未提出文件机械拆分。
- 验证边界：本 change 只有文档，按任务约定未运行测试、typecheck、构建或完整闸门。
