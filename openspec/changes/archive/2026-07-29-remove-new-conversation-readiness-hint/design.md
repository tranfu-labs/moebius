# 设计：remove-new-conversation-readiness-hint

## 方案

### 1. 从新对话组件契约中删除 readiness

`NewConversationPage` 删除 `cliReadiness` prop、`getNewConversationTeamCompatibility`、兼容性提示 DOM、对应图标和两条 console i18n key。组件不再拥有 readiness 的未知/检测中/终态状态规则，因此任意父级重渲染都无法重新推导或插入准备提示。

`OperatorConsole` 同步删除透传 prop。新对话团队选项仍保留成员 `executionProfile`，因为创建会话时需要形成不可变团队快照；本 change 不把“隐藏提示”误做成“删除运行配置”。

### 2. 普通操作台不再为新对话消费 readiness

`desktop/src/console-page/app.tsx` 当前把“新对话 readiness 展示”与“onboarding 安装延续”放在同一个 effect 中，实施时按以下代码边界拆开。

删除的普通操作台展示链：

- `onboardingCliReadiness` state 与 `setOnboardingCliReadiness`；
- effect 内把 `OnboardingCliReadinessState` 压成 `{ codex: boolean; kimi: boolean }` 的 `applyReadiness`；
- 正常操作台调用 `getOnboardingCliReadinessState` 的 `readReadiness`，以及挂载/轮询后只为刷新展示投影而调用它的分支；
- `OperatorConsoleApp → OperatorConsole → NewConversationPage` 的 `cliReadiness` prop；
- 新对话兼容性 helper、DOM 和 console 专用 i18n key。

必须保留的安装延续/成功复检链：

- `activeCliInstallations`、`cliInstallRevisionRef`、`cliInstallStatusRef`；
- `getOnboardingCliInstallState` 驱动的 `pollInstallations` 与 `applyInstallSnapshot`；
- `onOnboardingCliInstallSnapshot` subscription；
- 安装从 running 进入终态时，对目标 CLI 调用 `checkOnboardingCliReadiness(cli)` 的 `recheckAfterInstall`；该函数只删除随后为新对话读取 readiness state 的步骤；
- main 进程 `OnboardingCliInstallManager`、安装成功 callback、退出协调；
- preload/onboarding IPC 的 `getOnboardingCliReadinessState` 与 `checkOnboardingCliReadiness`，因为 `OnboardingRoute`、AI 建队和安装流程仍使用这些契约。

实现后的代码分界是：普通操作台只观察“是否仍有 onboarding 安装任务”并在成功时触发对应 CLI 复检，不再持有或渲染复检结果。正常操作台冷启动、readiness IPC 慢返回/拒绝及父级状态刷新因此都没有可写入新对话的 readiness 展示通道。

自动化证据在 `desktop/tests/onboarding-app-routing.test.tsx` 分成两组：

1. completed onboarding 的正常操作台挂载、shell-ready、进入团队页和新对话时，`getOnboardingCliReadinessState` 与为展示发起的 `checkOnboardingCliReadiness` 调用均为 0，DOM 无准备提示；
2. 安装状态从 running 收敛为 succeeded 时，安装状态仍更新，`checkOnboardingCliReadiness` 只收到完成安装的 CLI 一次，另一 CLI 为 0，且复检结果不进入新对话 DOM。

### 3. 发送与运行时边界保持不变

`NewConversationPage` 的 `canSubmit` 不改：仍要求可用项目、已选团队、正文或 ready 附件、无阻塞附件且当前不在提交/项目变更中。readiness 当前本就不参与该表达式，本 change 用测试锁定这一事实。

提交后继续沿用既有顺序：

1. 静态校验项目、团队结构和附件；
2. 原子创建 session、首条用户消息、附件归属和团队快照；
3. 按主 Agent 快照绑定的 CLI/model/effort 启动真实 driver；
4. 启动或配置失败时保留会话、消息和快照，并显示“这一步没跑起来”。

不新增发送前 capability probe，不把失败退回未发送草稿，也不尝试另一套 CLI。

### 4. 自动化测试

| 行为 | 位置 | 用例 |
| --- | --- | --- |
| 新对话没有准备提示契约 | `packages/console-ui/src/console/new-conversation-page.test.tsx` | 删除旧兼容性提示用例；在 zh-CN 与 en 下断言旧 test id、人数、CLI setup/准备及调整文案均不存在，发送使能保持原值 |
| 父级重渲染不复现提示 | `packages/console-ui/src/console/operator-console.test.tsx` | 反复重渲染含不同团队成员运行配置并切换 zh-CN/en 的 OperatorConsole，DOM 始终无准备提示 |
| 冷启动和任意 readiness 状态 | `desktop/tests/onboarding-app-routing.test.tsx` | 通过既有 `installApi` fixture 参数化 checking/ready/missing/needs-login/unavailable 返回值；completed onboarding 的正常操作台不调用 readiness state API，进入新对话均无提示 |
| IPC 慢返回或失败 | `desktop/tests/onboarding-app-routing.test.tsx` | `installApi` 提供 deferred/rejected readiness state mock；正常操作台断言调用为 0，因此没有生产 promise、迟到回调或未处理 rejection 能改变新对话 |
| 安装延续不受影响 | `desktop/tests/onboarding-app-routing.test.tsx`、既有 onboarding installer/readiness 测试 | 安装 fixture 从 running 收敛为 succeeded 后状态仍更新且只复检对应 CLI；onboarding 的 missing、needs-login、ready 显示继续通过 |
| 发送条件不变 | `packages/console-ui/src/console/new-conversation-page.test.tsx` | 项目/团队/正文/附件组合的 enable/disable 结果与 readiness 删除前一致 |
| 首次真实启动失败不变 | `tests/local-console-execution-runtime.test.ts` 或既有相邻用例 | 绑定 CLI 缺失/拒绝时 session、首条消息和快照已存在，run failed，另一 CLI 调用为 0 |
| 旧实现引用归零 | 全仓静态检查 | `rg` 断言 `new-conversation-team-compatibility`、`console.newConversation.compatibilityHint`、`console.newConversation.membersNeedCli`、`getNewConversationTeamCompatibility` 和 `cliReadiness` 的新对话透传均无残留；onboarding readiness key/contract 仍存在 |

异步测试必须让父级发生等价重渲染并使用会延迟、失败和迟到完成的 readiness/install promise，不能只覆盖引用稳定的同步 happy path。

### 5. 真实运行验收

证据写入系统临时目录，例如 `/tmp/moebius-remove-new-conversation-readiness-hint-<timestamp>/`，不写入仓库 `artifacts/`。

状态矩阵不通过生产桌面注入。checking、ready、missing、needs-login、unavailable、IPC 延迟/失败只由 `desktop/tests/onboarding-app-routing.test.tsx` 的既有 `installApi` 测试 fixture 覆盖；fixture 直接替换 renderer 可见的 `window.moebius` 契约，不新增生产调试 IPC、持久化字段、CLI 探针或打包代码。实现删除正常操作台读取后，这些 mock 的核心断言是“API 调用为 0”，而不是伪装成真实桌面状态切换。

真实开发态桌面只验证生产 main/preload/renderer 在本机实际状态下的页面结果和运行边界：

1. 启动已完成 onboarding 的开发态桌面，进入「新建对话」，选择包含 Codex/Kimi 混合配置的团队。
   - DOM：不存在 `[data-testid="new-conversation-team-compatibility"]`。
   - zh-CN 文本：页面不包含“名成员仍需”“Codex 准备”“Kimi 准备”“可在 Agent 团队页调整”。
   - 切换 en 后文本：页面不包含“members still need”“Codex setup”“Kimi setup”“adjust this on the Agent teams page”。
   - 导航到已有会话、Agent 团队页再返回新对话并改选团队，以上 DOM/文本断言保持成立，作为真实父级重渲染/导航证据。
2. 选择项目和团队并输入正文。
   - DOM：发送按钮按既有条件可用；无项目、附件 pending/failed 或提交中时仍按既有条件禁用。
3. 用只让绑定 CLI 真实启动失败的受控 shim 启动开发态桌面并发送首条消息。
   - DOM：侧边栏出现新会话，首条用户消息存在，运行记录显示“这一步没跑起来”；不出现准备提示。
   - API/SQLite/进程：session、消息和团队快照存在，run 为 failed，另一 CLI 调用为 0，发送前无 capability probe。
4. 从开发态桌面进入回看 onboarding。
   - DOM：当前本机真实 readiness 对应的检测、安装/登录或可用界面仍存在；完成/退出后返回操作台。
   - missing、needs-login 与安装成功只复检目标 CLI 的完整状态矩阵由上述自动化 fixture 和既有 onboarding service/installer 测试证明，不在真实桌面伪造。

evidence JSON 记录每条入口、断言选择器/文本、时间戳、进程计数与相关命令退出码。截图只作版式补充，不替代 DOM/文本和运行事实。

## 权衡

- 选择删除整个展示链，而不是把 readiness 改成三态：这直接兑现“新对话不需要准备概念”，也消除未知状态误报、状态过期和跨页解释成本。
- 保留 onboarding 内的 readiness：首次引导仍需帮助用户安装或登录至少一套 CLI，且 AI 建队依赖已确认可用的 CLI；删除新对话提示不等于删除这些明确流程。
- 不在新对话增加“发送后可能失败”的替代说明：运行失败已经在实际会话中有可恢复反馈，提前增加泛化警告会以另一种措辞重建同一认知负担。

## 风险

- 删除普通操作台 readiness state 时可能误删后台安装完成复检。通过把安装任务状态/复检与新对话展示投影分开，并保留 onboarding 集成测试控制。
- i18n key 可能仍被 Story 或测试 fixture 引用。用 zh-CN/en 组件断言、全仓 `rg` 与 typecheck 清除 console 专用 key、兼容性 helper、旧 test id 和透传 prop；onboarding 命名空间与 readiness contract 保持不动。
- 用户在发送前不再看到绑定 CLI 的环境问题。这是已确认的产品取舍；真实 driver 失败必须继续明确、可恢复且不跨 CLI 降级。
- 回滚可以恢复 UI prop 与提示区块，但不得恢复把初始 `checking` 当成未就绪的错误投影。
