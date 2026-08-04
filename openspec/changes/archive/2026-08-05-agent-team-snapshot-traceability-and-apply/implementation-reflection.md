# 实施符合度反思

## 已实现

- 完整团队快照贯穿 desktop 解析、SQLite effective/candidate/pending、dispatch generation 与 run execution context；三个 digest 分别覆盖完整 `AGENT.md`、执行配置和团队/成员身份。
- inspect/apply/retry/cancel 使用持久化 intent。首次 apply 冻结 candidate；retry 只重新提交原 pending，后续 candidate 不会漂移；旧代次运行/队列清空前不提升，点击后消息留在 `awaiting-team`。
- run audit 使用历史 execution context 与独立 provider-process-started fact 投影三种证据；info/Markdown 只接受 session/run 路由身份，不接受路径、team 或 member 读取参数。
- `SessionTeamMenu` 与新对话共用团队选项；历史快照身份、分类提示、头像 Popover、只读 Markdown Dialog、保存反馈均由 `packages/console-ui` 提供，desktop 只负责组合 API 与状态。
- 团队保存反馈覆盖团队信息、主 Agent、成员增删/复制、Markdown、profile、save-all 与有效外部载入；只有成功 mutation 才生成反馈。

## 反思中发现并修正

- 原 retry 路径曾复用 begin，会从较新的 candidate 再冻结。已新增独立持久化 retry command，并以“失败后出现更晚 candidate，重试仍提升原 pending”测试锁定。
- 团队页最初只为 Markdown/profile/团队信息显示反馈。已补齐主 Agent 和成员增删/复制，并避免在缺少真实保存 port 时伪造成功。
- 新对话生产菜单替换 `<select>` 后，三处桌面/组件测试仍定位旧控件并造成后续 `act` 超时污染；已改为从新对话区域操作真实 Radix 菜单。
- provider resume 可为同一 run 启动多个真实进程，process-started 事实不能按 run 做单例冲突检查；现按每次真实启动追加事实，审计只判断是否存在启动证明。
- 状态机矩阵补测时发现，已有显式团队切换 pending 的会话仍会进入同团队更新 inspect；已在纯 plan 层 fail closed 为 idle，避免 switch intent 与 apply intent 混写。
- Audit API 的 run/role 不匹配原先可能从底层透出不同 not-found code，且路由会忽略未知 query；现统一为稳定 audit-not-found，并拒绝所有 query 参数，防止调用方误以为可按 path/team/member 读取。
- Storybook 原有 Agent 审计故事只显式覆盖 executed、planned 与 legacy 空字段；已补 bound-start-unknown 完整事实，并在 Component/Block/Page 分层加入亮暗、窄窗、长成员、同名团队和 reduced-motion fixture。
- QA 通过后的第一次完整门禁发现，五个新增 console-ui 组件仍内嵌中英文分支与中文界面字面量，违反 production copy guard。已把全部新增文案迁入中英文 locale resources；production copy guard、i18n 与关联组件定向矩阵 166/166 通过，console-ui typecheck 通过。主 Agent 将该次发现问题的运行作废并批准一次替代完整门禁；替代 `pnpm test` 退出码 0，成为最终完整门禁证据。

## 兼容降级

- 旧快照未知团队名称、来源、成员可读身份、loaded time 与 profile 保持 NULL，不从当前团队目录补历史；UI 显示“此项未记录”。
- 无完整团队绑定的旧会话继续走共享 Agent 兼容解析；没有 execution context 的旧 run 返回稳定的 audit-not-found，而不会拼接当前团队信息。
- 迁移只为尚未完成的 legacy dispatch 在首次 apply 事务中绑定旧 effective key，不回写已完成历史或 JSONL。

## 真实 Electron 验收与可观察信号

功能 QA 与视觉 QA 已完成 H/I，证据均位于系统临时目录，未写入仓库 `artifacts/`。以下每项均从真实 Electron 用户入口执行：

| 用户可见行为 | 真实运行可观察信号 | 证据 |
| --- | --- | --- |
| 丰富团队菜单与完整成员 | 新对话团队菜单显示名称、官方来源、用途、主 Agent 和 `5 名成员`；键盘展开 `+2` 后出现全部成员且菜单保持打开 | `moebius-agent-team-functional-qa-BKRhRv/evidence.json` |
| 三类变化与完整应用 | composer 上方同时出现 Agent 定义、运行配置、团队信息三条提示；点击任一「应用」后，新 run 卡片显示新版身份与 `gpt-5.4-mini`，旧 run 仍显示 `gpt-5.6-sol` | `moebius-agent-team-functional-qa-BKRhRv/evidence.json` |
| 身份 frontmatter 双分类 | 只保存 `display_name` / `description` 后同时出现 Agent 定义与团队信息提示，未出现运行配置提示 | `moebius-agent-team-functional-qa-BKRhRv/evidence.json` |
| waiting、崩溃恢复与单次释放 | 点击后消息显示「新团队生效后决定」及编辑/移除；崩溃重启后不可恢复旧 run 时显示 failed、重试、取消并保留消息；重试只提升冻结 V1 且响应一次 | `moebius-team-crash-retry-evidence-OXLrlB/evidence.json` |
| 失败重试与取消 | 重试后立即提交的消息使用原冻结 V1、不吸收 V2；取消后恢复候选提示，继续使用当前有效 V1 | `moebius-team-recovery-rerun-evidence-EWxn12/evidence.json` |
| 历史 run 与三层审计 | 应用前 run 卡片持续显示历史团队/profile；成功 run 显示「实际执行配置」，`spawn codex ENOENT` 显示「计划尝试 · 未开始执行」，legacy 缺字段显示未记录 | `moebius-agent-team-functional-qa-BKRhRv/evidence.json`、`moebius-startup-failure-rerun-evidence-zhB7o6/evidence.json` |
| Popover/Dialog 与响应式版式 | 宽屏菜单完整可滚动，390×844 团队入口可见且无横向滚动；Popover 锚定并可上翻；两次 Escape 使可见 dialog `2 → 1 → 0`，焦点依次返回 Markdown 按钮和头像 | `moebius-visual-qa-rerun-uMWVQmDi/evidence.json`、`moebius-visual-qa-dialog-rerun-panBwAjJ/evidence.json` |
| 亮暗、reduced-motion 与视觉令牌 | 亮暗主题均无阴影/渐变；reduced-motion 下可见元素不存在大于 `0.01ms` 的动画或过渡 | `moebius-visual-qa-a86hWYBL/evidence.json`、`moebius-visual-qa-rerun-uMWVQmDi/evidence.json` |
| 团队页保存反馈 | 单项保存显示「已保存 1 项，无需重启」；部分失败留在详情并保留失败草稿；全部成功返回团队首页且列表上方显示团队与保存数量 | `moebius-agent-team-functional-qa-BKRhRv/evidence.json`、`moebius-team-save-all-evidence-u4sHaC/evidence.json` |
| 无需重启生效 | 保存后旧会话出现可应用提示；应用后下一次普通 run 的信息卡显示最新已保存身份、Markdown 与 profile | `moebius-agent-team-functional-qa-BKRhRv/evidence.json` |

功能 QA 与视觉 QA 最终均无阻断项。第一次完整门禁退出码 1，仅发现新增组件触发两条 production copy guard；修复后对应 guard 与关联组件定向矩阵 166/166 通过。经主 Agent 明确批准的替代完整 `pnpm test` 退出码 0：root 110 个文件通过、1 个跳过（782 passed / 4 skipped），附加根套件 64/64，desktop 136/136 文件（627/627），console-ui 51/51 文件（502/502）。最终完整日志为系统临时文件 `moebius-agent-team-snapshot-replacement-full-test.log`。

## 验证证据

- scope 基线：`e026f9976706d38680fb54581fbd846091ba5201`。
- `pnpm run test --scope e026f9976706d38680fb54581fbd846091ba5201`：根、desktop、console-ui 三段均通过。
- 迁移/状态机/Audit API 定向矩阵：6 个文件、24 条测试通过；迁移包含五类降级数据库双次初始化与事务回滚，API 通过真实 loopback server 验证。
- console-ui 定向矩阵：4 个文件、139 条测试通过；异步 Popover、更新提示、新会话菜单和 OperatorConsole 组合路径均通过。
- `pnpm check:boundaries`、`pnpm typecheck`、`pnpm --filter @moebius/console-ui check:storybook`、`pnpm --filter @moebius/desktop build`：均通过。
- 最新 Storybook 临时输出：系统临时目录 `moebius-console-ui-storybook-Z4hGdS`。
- 生产目录检索无 `prototypes/` import/read；原型文件只作为已确认产品输入保留在其隔离目录。
