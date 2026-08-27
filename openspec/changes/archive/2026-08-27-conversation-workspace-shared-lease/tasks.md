# 任务：conversation-workspace-shared-lease

## 设计与产品事实

- [x] 用户确认共享 lease（C）方向
- [x] 更新主会话与右侧栏 PRD
- [x] 建立 proposal、design、spec-delta 与架构前后快照

## M1–M4：workspace binding 与切换运行时

- [x] 定义 workspace identity、共享引用、revision 和临时生命周期模型
- [x] 扩展 Git adapter，解析同项目已有 branch/worktree，并拒绝缺失、歧义、prunable、不可读与跨 Git common dir 目标
- [x] 扩展 session workspace persistence 与旧 `workspaceMode` 兼容
- [x] 实现切换运行时、活动 run 隔离与清理资格判断
- [x] 完成 M1、M2、M3、M4 定向测试；M4 scope 回归通过（根 48 files / 380 tests passed，1 file / 5 tests skipped；desktop 3 files / 19 tests passed）；全量基线既存失败仍待步骤 4 处理

## M5：MCP

- [x] 增加 `moebius_switch_workspace` schema 与 bridge 路由
- [x] 校验 capability、当前 session 和目标输入边界
- [x] 确认 process settlement 不把 workspace tool 当作托管进程
- [x] 完成 MCP 与 Provider wiring 测试；M5 定向测试 6 files / 93 tests passed，scope 回归根 58 files / 516 tests passed / 5 skipped、desktop 10 files / 49 tests passed；全量基线既存失败仍待步骤 4 处理

## M6–M7：状态、UI 与 Trash

- [x] 投影 workspace identity、revision 与真实 branch
- [x] 使上下文分支和右侧文件浏览器跟随 binding 变化
- [x] 使改动标签使用当前工作区基线且不做来源归因
- [x] 接通 Desktop Trash adapter 与 CLI unavailable 降级；活动 Provider/托管进程结束后重判延迟清理
- [x] 完成 UI、HTTP、IPC 定向测试

## M8：集成与收口

- [x] 完成每个功能单元的验收标准落位自查
- [x] 真实 Electron 验证自然语言切换、分支显示、文件浏览器和 Trash（命令：`pnpm exec tsx scripts/acceptance/conversation-workspace-shared-lease.ts`；最新证据：系统临时目录 `moebius-conversation-workspace-shared-lease-HrhmLg/conversation-workspace-shared-lease-evidence.json`；Electron、本地服务、preload、renderer、SQLite、Git 与 MCP bridge 为真实链路，仅 Provider 可执行文件使用临时 fake Codex）
- [x] 生成步骤 4 边界矩阵并补齐空白
- [x] 执行全量回归，与步骤 1 基线对比并处理新增失败（`pnpm test` exit 0；root 149 文件通过/1 跳过、1064 项通过/5 跳过；`tests/local-console.test.ts` 1 文件/68 项通过；Desktop 177 文件/946 项通过；console-ui 69 文件/700 项通过。相对步骤 1 root 基线 143 文件通过/1 失败/1 跳过、1027 项通过/1 失败/5 跳过，本次无新增失败，新增 6 文件/37 项统计差）

## 步骤 4：边界矩阵

每个格子均给出处理与测试证据，或明确复用已有边界处理；本矩阵不改变需求层语义。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| M1 binding domain / shared lease | 复用 M5 `admitWorkspaceSwitchTarget` 的缺失 target 拒绝；`tests/managed-process-contract.test.ts` | 复用 M5 typed target admission；路径、脚本、空白与 513-byte branch 均拒绝 | 共享引用计数允许多 session；revision stale guard 复用 M3；`tests/local-console-workspace-switch-runtime.test.ts`、`tests/local-console-workspace-binding-persistence.test.ts` | domain 不直接授权；复用 M5 当前 capability/session 绑定 | 目标解析在写入前完成，失败保留旧 binding；`tests/local-console-workspace-switch-runtime.test.ts` |
| M2 bounded Git target resolver | 缺失 target 由 admission 拒绝；缺失 branch 返回 `target-not-found`；`tests/managed-process-contract.test.ts`、`tests/local-console-workspace-target.test.ts` | bounded parser/resolver 拒绝 malformed、ambiguous、prunable、unreadable、outside-project；`tests/local-console-workspace-target.test.ts` | resolver 只读 `git worktree list --porcelain`；binding 写入的重入保护复用 M3 stale revision；`tests/local-console-workspace-target.test.ts`、`tests/local-console-workspace-binding-persistence.test.ts` | outside-project/unreadable 统一拒绝，不接受任意路径；`tests/local-console-workspace-target.test.ts` | non-Git、缺失和解析错误返回稳定 reason，M4 不部分落盘；`tests/local-console-workspace-target.test.ts`、`tests/local-console-workspace-switch-runtime.test.ts` |
| M3 binding persistence / legacy compatibility | 缺失 binding 复用 legacy `workspaceMode` 读取；`tests/local-console-workspace-binding-persistence.test.ts`、`tests/local-console-workspace-migration.test.ts` | stale revision 写入拒绝；输入形状复用 M5 admission；`tests/local-console-workspace-binding-persistence.test.ts` | SQLite revision 防止旧写覆盖新 binding；共享引用按 session 去重；`tests/local-console-workspace-binding-persistence.test.ts`、`tests/local-console-workspace-switch-runtime.test.ts` | store 操作由当前 session runtime 调用，权限边界复用 M5 capability admission；`tests/managed-process-supervisor.test.ts` | 重启恢复当前 binding、baseline、revision，旧会话继续可读；`tests/local-console-workspace-binding-persistence.test.ts` |
| M4 switch runtime / cleanup planning | same binding / project-root 不执行清理；复用 M1 `planWorkspaceCleanup`；`tests/local-console-workspace-binding-plan.test.ts` | 非法 target 在 resolver 前被拒绝，不写 binding；`tests/managed-process-contract.test.ts`、`tests/local-console-workspace-switch-runtime.test.ts` | active provider 与 managed process 保持原 workspace，延期清理在结束后重判；`tests/local-console-workspace-switch-runtime.test.ts`、`tests/managed-process-supervisor.test.ts` | MCP route 只传 capability 所属 session，其他 session 的 process 访问拒绝；`tests/managed-process-supervisor.test.ts` | resolution/persistence/Trash 失败分别保留旧 binding 或结构化 cleanup reason；`tests/local-console-workspace-switch-runtime.test.ts` |
| M5 workspace MCP action | `admitWorkspaceSwitchTarget` 对空对象/缺失 branch 返回 `invalid-workspace-target`；`tests/managed-process-contract.test.ts` | `additionalProperties:false` 与 admission 拒绝绝对路径、shell、空白、缺失及 513-byte branch；`tests/managed-process-contract.test.ts` | bridge 工具完成事件不受 workspace tool 污染；managed stop 重入幂等；`tests/managed-process-supervisor.test.ts` | capability 撤销、伪造 session、跨 session process id 均 fail closed；`tests/managed-process-supervisor.test.ts` | parse error、capability revoke、workspace unavailable 走结构化错误并不产生后台 fallback；`tests/managed-process-supervisor.test.ts` |
| M6 state / branch / right sidebar | 空文件树、无 diff 与不可用内容复用既有 `workspace-query` fallback；`tests/local-console-workspace-diff.test.ts`、`packages/console-ui/src/console/project-files-tab.test.tsx` | 文件路径、line/column 与 workspace 外目标复用既有 file-read 边界；`tests/local-console-workspace-diff.test.ts` | revision/identity 改变时重载，迟到 A 响应不得覆盖 B；`tests/local-console-workspace-state.test.ts`、`packages/console-ui/src/console/change-tab.test.tsx`、`project-files-tab.test.tsx` | HTTP/file query 复用 session-scoped workspace context 与现有 capability 边界；`tests/local-console-workspace-diff.test.ts` | Git/file/read API 失败呈现 unavailable，旧请求丢弃；`tests/local-console-workspace-diff.test.ts`、`packages/console-ui/src/console/project-files-tab.test.tsx` |
| M7 Desktop Trash adapter / deferred cleanup | project-root、same binding 无 Trash；复用 M1 cleanup plan；`tests/local-console-workspace-binding-plan.test.ts` | 不接受调用方路径，Trash 只消费已解析 canonical workspace；M4/M5 admission tests | shared、active provider、active managed process 保留；结束通知触发重判；`tests/local-console-workspace-switch-runtime.test.ts`、`tests/managed-process-supervisor.test.ts` | Trash port 缺失返回 `trash-unavailable` 并保留目录；`tests/local-console-workspace-switch-runtime.test.ts`、`desktop/tests/desktop-local-console-runtime.test.ts` | `shell.trashItem` 失败返回 `trash-failed`，不把清理失败升级为切换失败；`tests/local-console-workspace-switch-runtime.test.ts` |
| M8 real Electron integration | composer 空态与 MCP target admission 复用 M5；真实用户动作脚本只发送合法 target | 非法输入由 M5 admission 覆盖，真实脚本不绕过该入口 | active run frozen workspace、UI revision 与 restart persistence 分别复用 M4/M6；`scripts/acceptance/conversation-workspace-shared-lease.ts` | 真实链路经当前 invocation capability；bridge/跨 session 拒绝复用 M5 tests | Electron/local-console/SQLite/Git/MCP bridge failure 由下层结构化失败处理；真实 acceptance evidence 覆盖切换、Trash 与重启保持 |

## 遗留事项（截至步骤 4）

- 已验证：Git 缺失、歧义、prunable、不可读和跨项目目标的拒绝路径；证据为 `tests/local-console-workspace-target.test.ts`，并保留设计文档中的历史记录供归档核对。
- 已验证：binding persistence 的旧字段兼容、revision 防旧写覆盖与重启恢复；证据为 `tests/local-console-workspace-binding-persistence.test.ts` 和真实 Electron 重启验收。
- 已验证：真实 Electron 的当前 binding、真实 branch、项目文件跟随与 Desktop Trash；改动标签的真实 Electron 用户动作仍未验证。
- 未验证：共享引用与活动 provider/托管进程同时存在时的组合时序；目前分别覆盖共享、provider 忙碌和 managed process 忙碌路径。
- 未验证：所有真实 Provider 对 workspace MCP tool 的发现与路由；本 change 的真机脚本仅使用临时 fake Codex，MCP bridge 本身为真实链路。
- 待核实：CLI 模式下系统 Trash 不可用时的最终用户提示；当前实现保留目录并返回 `trash-unavailable`。
- 需用户翻查：完整闸门 root 输出有 5 项跳过（1 个测试文件），但无失败；跳过原因沿用仓库既有测试环境状态，待后续专项核对。
- 历史基线曾记录 1 个清理失败；本次 `pnpm test` exit 0，未复现该失败，历史记录不回写。
