# 任务：fix-conversation-draft-switch-race

- [x] 护栏提交：加入显式 owner 状态转换、submission guard 与稳定 session-view transition FIFO；在现有 `desktop/tests/draft-store.test.ts` / `console-state-sync.test.ts` 覆盖归属、可见阻断原因、单次 `arm→viewed` 基线、跨请求串行、失败后继续和 pending generation。本提交不接入页面。
- [x] 接入 `console-ui` 前先读 `packages/console-ui/DESIGN.md`；只增加 host 提供的窄 submission-block reason 并复用 `RoleComposer.submitDisabled`，组件库不得解释 owner、未读事实或 transition 队列。
- [x] 产品修复提交：把主 composer 正文、附件 draft key、清理与发送绑定到同一个显式 owner；普通会话与 sidebar-conversation 点击同步提交各自明确的主 selection / owner，把阅读 mutation 按点击顺序入队；transition pending 期间保持输入可编辑、单独禁用发送并显示草稿保留说明，handler 二次 fail closed 且不得静默。
- [x] Renderer 回归：复用既有 App 内存 harness，覆盖慢成功、失败、refresh / 重渲染、owner mismatch、A→B→A 对抗性逆序、未读徽标最终状态及 sidebar-conversation 的 origin / target 映射，断言草稿只写目标 session、阻断原因可见、无越界请求且旧异步完成不回写 selection；不新增真实 I/O 测试。
- [x] 脚本修复提交：`local-console-direct-member-mention.ts` 在填写前等待主内容区目标会话标题，不用固定 sleep，不把脚本等待当成产品竞态护栏。
- [x] 定向验证：运行草稿 owner / submission guard、session-view FIFO、承载 renderer 回归的既有 App 测试与生产 Electron direct-member 验收脚本；确认脚本所有断言可达并输出临时 evidence。
- [x] 真机复核：按 `design.md` 三条语句记录“入口 / 操作 / 屏幕观察 / 与承诺一致否 / 环境”，包含切换阻断提示、A/B 未读徽标最终状态与重启保持；语句 4 必须无 shim、从 UI 产生状态，真实 runtime evidence 包含同 `runId`、`resume`、同 provider external id 和无 replacement session；shim 脚本明确记为替身辅助证据。
- [x] 收口验证：运行 `pnpm run test --scope a21d4de`、`pnpm typecheck`、Desktop build，并只在交付收尾运行一次完整 `pnpm test`；记录 lint 未配置，不以构建替代真机行为。
- [x] 符合度反思：逐条核对 PRD / console-ui spec，确认没有修改 direct-member 路由、local-console API、SQLite / JSONL 或 provider resume 规则，并清点无意义、镜像或重复测试是否需要剪枝。
- [x] Git 杂务：再次确认 `moebius/o4VmtqDfP2O3` worktree 干净且与 `main` 树无差异后移除该 worktree，再删除分支；报告删除目标及可恢复方式。

## 交付记录

### 真机行为证据

#### 1. 极快切换时草稿不串会话且保护分支可见

- **环境**：真机。当前构建的真实 Electron 窗口连接真实 local service、SQLite、JSONL 与 IPC；使用开发数据根中的两个既有会话，状态全部由侧边栏点击、输入和正常重启产生，没有 mock、stub、网络拦截或 API 预置。
- **入口**：主对话页已有会话 A、B；两者验收前的正文草稿都为空。
- **操作**：在 A 输入唯一草稿，点击 B 后不等待页面稳定立即输入另一唯一草稿；切换提示出现时尝试发送，再在 A/B 间往返并重启应用。
- **屏幕观察**：输入框始终可编辑；切换期间出现“正在切换对话，草稿已保留，完成后即可发送”的可见状态且发送按钮禁用，尝试发送前后消息数不变；提示约可见 **105 ms**，是短暂但可测的窗口，没有观察到需要用户等待的明显卡顿。落定后提示消失、发送恢复；A/B 各自只恢复自己的草稿，重启后仍保持。
- **与承诺一致否**：一致。归属保护、fail-closed 可见反馈和跨重启隔离均成立。

#### 2. 快速往返后未读徽标仍正确

- **环境**：真机。同一真实 Electron / local service 环境，无替身；未读状态通过真实右键菜单产生。
- **入口**：主侧边栏选中 A；先把非当前 B 标记未读，再把当前 A 标记未读，操作前两行都显示蓝点。
- **操作**：快速依次点击 B、A，等待阅读状态请求收口后正常重启应用。
- **屏幕观察**：A 保持唯一当前会话，A/B 两行蓝点都消失；没有被旧异步请求拉回 B；重启后 A 仍选中且两个蓝点都没有重新出现。
- **与承诺一致否**：一致。FIFO 的最终阅读状态与既有“离开后再次成功展示才清当前手动未读”规则一致。

#### 3. 语句 4：优雅重启保持同 run、同线程 resume

- **环境**：真机。当前构建的真实 Electron 连接真实 local service，并启动本机真实 Codex CLI `0.146.0`；session、团队选择和两条消息都从 UI 创建，没有 shim、mock、API 预置或直接写状态。
- **入口**：从“新建对话”进入，选择开发团队并向 qa 发送一条保持活动约 25 秒的任务。
- **操作**：qa 首条 run 仍显示活动时，从同一 composer 再发送第二条给 qa；屏幕出现一个待发射项后正常关闭应用，再重新打开。
- **屏幕观察**：重启前首条活动 run 为 `local-2026-08-01T08:45:23.104Z-hzzo9dgq`，第二条显示在 qa 待发射区；重启后仍是同一 session、同一 `runId` 活动，第二条仍在同一角色待发射区。首条随后显示 `QA_RESTART_FIRST`，第二条继续执行并最终显示 `QA_RESTART_SECOND`。
- **运行时一致性**：session JSONL 中，首条初始 invocation 为 `full`；重启后同一 `runId` 记录 `phase: resumed`，恢复 invocation 为 `resume`；requested / observed provider external id 始终同为 `019fbc7f-db73-7132-813a-9ea790e71e19`，终态成功。进程参数也观察到 `codex exec resume ... 019fbc7f-db73-7132-813a-9ea790e71e19`；没有 replacement session 或第二次 `full`。证据位于开发数据根 `sessions/bG9jYWw6MjAyNi0wOC0wMVQwODo0NToyMy4wNjVaLWh3MmJ2dg.jsonl`。
- **与承诺一致否**：一致。同 run、同 provider thread 的 canonical resume 与待发射恢复均成立。

#### 辅助证据与现场清理

- 生产 Electron 验收脚本 `local-console-direct-member-mention.ts` 为 **替身＋不算数的理由**：它使用 Codex shim，并通过 API 预置 session；13/13 自动断言通过，evidence 写入系统临时目录，只证明脚本链路恢复可达，不抵扣上面的真机记录。
- 真机复核后，通过 UI 把 A/B 草稿恢复为验收前的空值并经重启确认；UI 新建的 QA 验收会话已归档而非删除，仍可从已归档会话恢复；测试 Electron 已关闭，打包态正在运行的 Moebius 未被操作。

### 回归保障

- 护栏定向测试：55 项通过。
- 产品接线定向测试：Desktop 75 项、console-ui 114 项通过。
- `pnpm run test --scope a21d4de`：import boundary preflight 通过；机器计算 41 个受影响文件，Desktop 103 项、console-ui 412 项通过。
- `pnpm typecheck`：通过。
- `pnpm --filter @moebius/desktop build`：通过。
- `pnpm test`：初次收口曾执行一次并通过，但遗漏的 renderer 用例使该次收口无效；补测后最终树再次执行完整闸门并通过：root 947 项通过、4 项跳过，slow local-console 63 项通过，Desktop 424 项通过，console-ui 459 项通过。两次完整运行是一次过早收口和一次返工后的必要最终闸门，不把它隐瞒成“只跑一次”；只出现既有 React `act(...)` warning，没有失败。
- lint：仓库未配置 lint 命令，未伪造执行结果。

### 独立复核返工

- 独立 QA 指出原归档缺少 design 已承诺的 owner-mismatch renderer 接线用例；当时只有纯逻辑语义码测试，`tasks.md` 却已把 renderer 条目勾为完成。该结论成立，因此 change 从 archive 重新打开，不能靠改任务措辞豁免。
- 提交 `130e2e6` 在既有 App 内存 harness 中强制保持 `owner=draft:source-a`、`selection=source-b`。测试层只用窄包装捕获 App 已传给 `OperatorConsole` 的 `onSend`，直接调用它以覆盖 handler 二次 fail-closed；没有增加生产 test hook 或修改运行时代码。
- 新用例从附件 API 内存替身恢复一项 ready 附件，并断言 composer 内有非空可访问 `status`、发送禁用；直接调用 host 发送回调后有非空 `alert`，正文、附件及 A 的持久草稿都保留，B 草稿不存在，消息请求数组为空。断言不冻结 owner-mismatch 具体文案。
- 返工定向验证：`console-app-sidebar-conversation-regressions`、`draft-store`、`console-state-sync` 共 76/76 通过；`pnpm run test --scope f741a93` 计算出 1 个受影响测试文件并通过 21/21；`pnpm typecheck` 通过。返工只增加测试与 harness 能力，没有改变用户行为，既有三条真机记录仍覆盖生产实现，无需用测试冒充新的真机证据。

### 符合度反思

- `docs/product/pages/main-conversation.md#输入框`、其验收第 34/35 条、`docs/product/pages/main-left-sidebar.md#标记为已读与未读` 与最终行为一致；`openspec/specs/console-ui/spec.md` 的会话草稿隔离、附件草稿恢复和 selection mutation 禁发判据无需修改。本次修复实现偏差，没有新增产品意图或行为事实，故没有 spec delta、PRD、ADR 或 module-map 更新。
- 没有修改 direct-member 路由、local-console API、SQLite / JSONL schema 或 provider resume 规则；真机 resume 仅用于验证既有规则。
- `console-ui` 继续只承载展示：`RoleComposer.statusText + submitDisabled` 已足够表达状态，但 `app.tsx` 不能越过 `OperatorConsole` 直接触达该组件，因此只新增一个通用可选字符串透传；组件库不知道 owner、FIFO、未读或业务语义，没有新增 `Operator*` 业务类型。
- 新测试只断言状态、可访问控件、请求顺序和外部副作用，不读取源码、文档或配置复述文本；owner-mismatch 用例只要求 `status` / `alert` 非空，不复制具体文案。没有旧测试因本改动失去意义，也没有与新测试重复覆盖同一分支，因此未删除或机械改写旧断言。
- import boundary preflight 通过，没有新增禁用依赖方向。

### Git 杂务

- 删除前确认旧 worktree 工作区干净；其 HEAD `4e11cd8` 的 tree 与 `main` 的 tree 都是 `8e12025a`，内容完全一致。
- 已移除 worktree `o4VmtqDfP2O3` 并删除分支 `moebius/o4VmtqDfP2O3`。目录与分支名已删除；原提交仍可通过对象 `4e11cd8` 或 reflog 恢复。
