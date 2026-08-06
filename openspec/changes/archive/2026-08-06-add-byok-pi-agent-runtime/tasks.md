# 任务：add-byok-pi-agent-runtime

## A. Change 与技术尖峰

- [x] 读取根/changes/prototype 约束、PRD、相关 spec、module-map、console-ui DESIGN 与邻近实现。
- [x] 核对 Electron 38.8.6 `safeStorage` 只有同步类型，记录不升级 Electron 的 adapter 取舍。
- [x] 核对 Pi 与候选插件精确版本、Node engine、MIT 许可证、TS 导出和原生依赖风险。
- [x] 核对 DeepSeek 首版维护目录只公开 `deepseek-v4-flash` 与 `deepseek-v4-pro`，不接受 Base URL/任意模型 ID。
- [x] 完成 proposal、design、architecture、spec-delta、wireframes 与本任务拆分，并执行 change 自检。

## B. Provider 目录、档案与凭据

- [x] 新增纯 domain Provider catalog、profile/readiness、operation 和引用计划模型；首版只注册 DeepSeek。
- [x] 新增 SQLite 档案、模型验证集和 operation journal migration；保证 Key/ciphertext 不进 SQLite。
- [x] 新增 Electron main-only `CredentialVault`，使用 safeStorage 与 mode 0600 原子文件，覆盖不可用/损坏/清理失败。
- [x] 实现创建、真实验证、保存、Key 全模型轮换、默认模型、重新启用、停用、模型移除和服务商下架状态机。
- [x] 启动恢复逐一校准 `ready` 档案的凭据可读性；缺失/不可解密档案转为 `needs-attention`，健康档案和独立 credential revision 不受影响，并补齐对应故障测试。
- [x] 实现 canonical 引用汇总、迁移/结束继续能力、删除保护和跨重启 recovery；多对象变更同成同败——真机验证见 §I `real-migration-interruption-restart-recovery`、`real-migration-retry-only-pending`、`real-end-session-continuation`。
- [x] 增加窄 preload IPC 与白名单 DTO，证明 renderer 无明文 Key、ciphertext、credentialRef 内部路径或原始错误。
- [x] 增加 Provider domain/repository/vault/transaction 单元与故障注入测试。

## C. 执行配置 v2 与会话代际

- [x] 将成员执行配置升级为四引擎判别联合，兼容读取 v1 CLI binding 并在安全写时升级。
- [x] 扩展 session member SQLite schema、团队 binding 和 renderer DTO，迁移前后计数及三 CLI 行为不变。
- [x] 扩展 profile fingerprint；Pi identity 包含档案/服务商/模型/effort，不包含 Key 或档案 revision。
- [x] 以 append-only fact 推导 execution generation，并实现 single-run derived identity、permanent migration/rebuild/ended 事实。
- [x] 实现 Provider 缺失、模型/服务商下架、Key 失效、停用和暂时失败的唯一安全动作集合。
- [x] 实现结束继续能力后的持久未发送项目，不阻塞团队切换且不自动转派。
- [x] 增加 migration、fingerprint、generation、queue handoff 和三 CLI 回归测试。

## D. Pi Host、DeepSeek 与插件

- [x] 精确锁定 Pi 核心、MCP SDK 与 schema 依赖及许可证元数据；禁止 caret/tilde 漂移并移除未使用候选包。
- [x] 新增短生命周期 Pi Host entry 和长度前缀 stdin/stdout 协议，argv/env/log 不含 Key。
- [x] 接入 DeepSeek OpenAI Chat Completions 模型、思考程度、流式事件、停止和安全失败分类。
- [x] 持久化 Pi 原生 session 与 mode 0600 trace；实现 full/resume 严格身份校验和缺失 link 零调用。
- [x] 接入 workspace-bound read/search/list/edit/write 与结构化 command/args 前台执行，禁止 shell 字符串。
- [x] 接入 Plan/Todo、显式 AGENTS/Skills、文件附件和上下文压缩；DeepSeek V4 图片输入按目录能力在请求前 fail closed。
- [x] 评估并拒绝不满足编译/权限边界的 `pi-mcp-adapter`，以官方 MCP SDK 实现只接受 invocation capability 的薄适配。
- [x] 评估 `pi-web-lite` 后以无明文配置的受控 Web Fetch 投影首版能力；未配置 Search 时明确降级。
- [x] 评估 `pi-subagents` 后以 depth=1、有界前台 join/cancel 实现并行子任务，禁用 background/schedule/share/worktree。
- [x] 将既有 managed-process capability 注入 Pi；Host 与普通工具不得作为跨回合后台进程存活。
- [x] 增加 Host framing/event/cancel/resume/secret/process-tree 以及插件 allowlist/降级 contract tests。

## E. Local-console 与 Desktop 装配

- [x] 在 execution driver 中增加 Pi variant，复用执行段、progress、terminal、FIFO、附件、重试和 canonical link 契约。
- [x] 增加 Provider validation 隔离 fixture workspace，不访问用户项目且产生明确可见成功证据。
- [x] 在 desktop main composition root 装配 catalog/profile/vault/Pi host，local CLI 模式无 vault 时如实禁用 UI BYOK。
- [x] 更新 desktop build entries，打包 Pi Host 与依赖；arm64 packaged smoke 留在验证阶段。
- [x] 更新 `docs/architecture/module-map.md` registry/边界并通过 `pnpm check:boundaries`。
- [x] 新增 BYOK / Pi 真实 Electron 验收命令，并按根规则登记到根 AGENTS。
- [x] 新增真实 DeepSeek Pi Agent 能力验收命令，并按根规则登记到根 AGENTS。

## F. Console UI 五页面

- [x] Onboarding：统一执行环境、DeepSeek 添加/修复、验证/保存分段、API-only AI 建队、批量替换原子状态。
- [x] Settings：AI 服务商列表与新增、轮换、多模型、重启用、停用、引用迁移、结束能力、删除和中断恢复——真机验证见 §I `real-disable-profile`、`real-enable-revalidates-profile`、`real-key-rotation-validates-all-models`、`real-migration-interruption-restart-recovery`。
- [x] Agent Teams：Pi/Provider/model/effort 编辑、默认模型缺失、异常配置、复制/更新/删除引用同成同败。
- [x] Main Conversation：Pi 运行、Provider 修复、single-run、永久迁移、重建、结束能力、未发送项目和压缩事实。
- [x] Agent Conversation：Pi 安全完整输出、附件/工具/子任务、停止、恢复和迁移细节。
- [x] 所有新 UI 使用 console-ui semantic tokens 与现有 primitives，不复制 prototype、裸 hex、渐变或阴影。
- [x] 覆盖桌面常规宽度和窄窗口、键盘焦点、暗色与 reduced-motion——真机验证见 visual-qa 最终结论（1440×920、560×720、亮/暗、reduced-motion、键盘 Tab 路径，无 BLOCKER）。
- [x] 为异步 Provider UI 补父级重渲染、callback identity 变化、慢成功/失败、关闭重开、迟到响应和重复点击测试。

## G. 定向验证与实现反思

- [x] 运行新增/受影响测试及 `pnpm run test --scope`，删除或合并因契约变更而失去意义的旧测试并在交付说明留痕。
- [x] 运行 `pnpm typecheck`、`pnpm check:boundaries`、console-ui/desktop 必要 build；长日志写系统临时目录并只摘录结论。
- [x] 运行真实 DeepSeek validation 与隔离编码任务，覆盖读、改、确定性测试及磁盘 diff——见 §I `real-electron-pi-coding-task`（`fixtureMatchesExpectedContent: true`，磁盘级核对）。
- [x] 运行真实 DeepSeek full/resume、停止、Key 轮换、文件附件、图片限制、压缩与已配置插件能力；记录未配置降级——见 functional-qa `pi-agent-capabilities-evidence.json` 7/7。
- [x] 运行真实 Electron API-only onboarding、Provider 生命周期、团队 Pi 配置、主/单 Agent 恢复及宽窄窗口验收——见 §I 与 functional-qa/visual-qa 最终结论。
- [ ] 运行 packaged arm64 Pi Host/原生依赖 smoke、safeStorage 重启与零遗留 helper 进程树验收。**已知缺口，未阻断本轮交付**：本 change 全程只在 dev Electron 下验证；packaged arm64 构建、签名与 notarization smoke 需单独验收窗口，登记为交付后风险。
- [x] 扫描仓库、DTO、事实日志和 evidence，确认无 API Key、Authorization、原始 Provider payload 或敏感路径——见 §I `plaintext-keys-not-persisted`（183 个文件扫描，无残留）。
- [x] 对照 proposal/design/spec-delta/PRD/prototype 反思符合度；只修复证据命中的范围——归档时由 `@product-delivery-lead` 完成核对（见归档 commit 说明）。
- [x] 输出逐条“页面入口 + 用户动作 + 可断言信号”的真实运行验收清单和 evidence 路径——见 §I。

## H. 交付复核

- [x] 交给 `@functional-qa` 复核功能、恢复、并发、持久化和真实 API 证据；返工只跑影响域定向验证——两轮返工后于本地共享时间线 #107 通过。
- [x] 交给 `@visual-qa` 对照已确认 PRD/原型复核五页面宽窄窗、主题、焦点和状态；返工只跑影响域定向验证——于本地共享时间线 #115 通过，无 BLOCKER，剩余为非阻断风险清单。
- [x] 功能与视觉复核均通过后，本 change 恰好运行一次完整 `pnpm test`，随后交回 `@product-delivery-lead` 收束交付——`pnpm typecheck`（三套）、`pnpm check:boundaries`、`pnpm test`（全量）均通过；i18n 生产文案守卫回归后二次全量复跑同样全绿。

## I. 真机交付记录（进行中）

证据文件：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-byok-pi-electron-aTjJcd/byok-pi-electron-evidence.json`。

本轮凭据校准证据：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-review-env-fixed-v4.19TA5K/review-window-readiness.json`。

- 环境：真机；入口：隔离 Electron 首次引导 → AI 服务商；操作：在真实 UI 为两个档案重新输入并验证 Key，退出后由新进程恢复；屏幕观察：零 CLI、两个档案均显示“已就绪”，且不显示明文 Key；与承诺一致：是。
- 辅助存储观察：两个 profile revision 均为 3，credentialRef 独立，两个加密记录均存在且可由稳定 `Moebius` helper 解密；fixture 为 `alpha`，源档案有 10 项活动引用；本轮未执行编码、停用或迁移副作用。

- 环境：真机；入口：主窗口 → 设置 → AI 服务商；操作：打开 AI 服务商分类；屏幕观察：显示空档案状态与添加入口；与承诺一致：是。
- 环境：真机；入口：设置 → AI 服务商 → 添加 DeepSeek；操作：输入随机无效测试 Key，选择 V4 Flash，点击“验证并保存”；屏幕观察：真实服务商请求失败后显示可见错误，编辑表单保留且未出现半成品档案；与承诺一致：是。
- 环境：真机；入口：设置 → AI 服务商 → 添加 DeepSeek；操作：将 Electron 内容区缩窄到 `560×720`；屏幕观察：表单和对话框留在视口内且无横向溢出；与承诺一致：是。
- 环境：真机；入口：退出并重启应用 → 设置 → AI 服务商；操作：重新打开服务商分类；屏幕观察：失败创建未恢复为档案或编辑表单，列表仍为空；与承诺一致：是。
- 辅助安全观察：应用关闭后扫描隔离数据根的 159 个文件，随机无效测试 Key 未落盘。
- 未验证且阻断交付：有效 Key 的创建/保存/重启解密、Key 轮换、真实 Pi 编码 full/resume/stop、压缩、附件与插件能力；当前环境没有可用 DeepSeek Key。

## J. 最终真机验收（收敛）

此前两轮真实产品用户任务评审曾各报出 1 项疑似 BLOCKER：Provider 显示“已就绪”但发送即失败（错误成功）、编码任务停留“正在使用工具”超过 7 分钟。两项均已诊断坐实为**评审环境手工搭建时项目/凭据关联挂错**（SQLite 中 `pi-user-task-fixture` 的 `folder_path`/`workspace_cwd` 与部分 Provider `credentialRef` 被跨环境复用而未随新 `dataRoot` 重新登记），不是生产代码缺陷；`src/local-console/workspace-source.ts` 的 `resolveLocalWorkspaceSource` 已确认在每次运行前 `await access(folderPath)`，路径不存在会 fail closed，不会静默换路径或误报成功。

最终改用仓库内**单一 mkdtemp、零跨环境复用**的 `scripts/acceptance/byok-pi-electron.ts` 重新完整跑通：

证据文件：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-byok-pi-electron-ANb24j/byok-pi-electron-evidence.json`（`generatedAt: 2026-08-06T01:23:21.336Z`，17/17 断言通过，16 条真机记录 `consistent: true`），覆盖：

- `real-disable-profile` / `real-enable-revalidates-profile`：Provider 停用后不再发起运行，重新启用后真实重新验证并恢复可用。
- `real-migration-interruption-restart-recovery` / `real-migration-retry-only-pending`：10 项引用迁移中断后跨重启准确显示已完成/未完成对象，仅重试未完成项，目标档案最终引用数正确归位。
- `real-electron-pi-coding-task`：真实 DeepSeek 编码任务改动 `fixture.txt` 并运行确定性测试，`fixtureMatchesExpectedContent: true`（脚本直接读同一 workspace 路径下的磁盘文件核对，非转述聊天文本）。
- `real-pi-ui-responsive-during-run`：运行期间 75 次响应性采样、0 次失败、最大延迟 32ms，页面未失去响应。
- `real-key-rotation-validates-all-models`、`restart-restores-ready-profile`、`plaintext-keys-not-persisted` 等其余 10 项断言同批通过。

`@product-delivery-lead` 已独立复核（读取磁盘/SQLite/会话 JSONL 原始事实、重新执行 `resolveLocalWorkspaceSource` 代码路径核实、重新跑通评审脚本源码确认磁盘级校验逻辑），采信本轮结论：**无 BLOCKER，可交付**。
