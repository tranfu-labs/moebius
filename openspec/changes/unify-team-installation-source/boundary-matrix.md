# 边界矩阵：统一团队安装来源

本矩阵覆盖本 change 的四个功能单元。每个格子都给出处理方式和对应验证；“复用”表示该异常没有新增分支，沿用已存在的边界处理。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| 官方 seed / 来源 record | 新数据根先把打包团队安装为普通 user team；若没有任何团队，catalog 返回可渲染的空列表，不再要求 legacy system team；`desktop/tests/team-seed.test.ts`、`team-ipc.test.ts` 覆盖。 | 内置 manifest 无效时拒绝安装并清理临时目录，复用 `desktop/tests/team-seed.test.ts` 的 invalid manifest 用例。 | 重复启动或重复 seed 只保留一份普通 user team；已有 user team 与 legacy `.system` 均不覆盖，复用 `team-seed.test.ts` 的 rerun/legacy 用例。 | 文件系统拒绝读写时沿 seed 现有错误边界返回失败，不新增来源状态；复用 seed 的原子写入路径。 | 中途写入失败不留下团队目录、record 或 official state；`team-seed.test.ts` 的 invalid manifest 与保留本地编辑用例覆盖回收和重入结果。 |
| GitHub 预览 / 导入 / 来源 record | 空搜索不访问 GitHub 并返回空结果；`desktop/tests/github-team-ipc.test.ts` 的 empty query 用例覆盖。 | 非法 renderer 请求、仓库快照或成员文件不可读时返回安全错误并阻止安装；复用 `github-team-ipc.test.ts` 的 malformed/unreadable 用例与 `github-team-install-plan.test.ts` 的计划校验。 | 同一仓库重复安装被计划层拦截，安装层把并发请求串行化为一份团队；`github-team-install-plan.test.ts` 与 `github-team-installation.test.ts` 覆盖。 | `gh`/文件系统权限失败沿既有 transport/IPC 错误映射返回可读失败，不写来源 record；复用 GitHub IPC 的安全错误边界。 | 成员绑定写入失败时删除目录、record 和绑定；`github-team-installation.test.ts` 的 atomic rollback 用例覆盖，且不创建 `official-state-v1.json`。 |
| 本地发现 / 启动 / 运行绑定 / legacy 兼容 | 没有 user record 或团队目录时返回空列表；无 legacy system team 不再触发 configuration-error，空态由页面渲染；`desktop/tests/team-ipc.test.ts`、`agent-teams-page.test.tsx` 覆盖。 | record、成员 frontmatter 或路径无效时进入 needs-repair，不把无效团队选入新会话；`team-ipc.test.ts` 的 repair 用例覆盖。 | 列表刷新和启动只读团队目录与 record，不启动来源任务；新 user team 使用显式绑定，legacy system team 才走旧 fallback；`desktop/tests/desktop-startup-runtime.test.ts`、`team-runtime-binding.test.ts` 覆盖。 | 读取目录或 record 被拒绝时沿现有 repair/config-error 边界处理，不删除兼容数据；复用 `team-ipc.test.ts` 的文件异常路径。 | 启动失败或旧状态缺失不迁移、不清理、不覆盖；legacy session 继续使用有效文件，新 user team 不读旧 official state；`team-runtime-binding.test.ts` 与 `desktop-startup-runtime.test.ts` 覆盖。 |
| 已移除的更新操作 / 来源展示 UI | 没有 `installationSource` 时展示普通本地团队，不渲染来源动作；旧 record 仍按兼容解析，复用 `team-record-store.test.ts`。 | 非法来源字段不作为可执行关系，沿 record 解析和 repair 边界处理；`team-record-store.test.ts`、`team-ipc.test.ts` 覆盖来源/修复路径。 | 重复渲染或重复打开来源链接只保持只读展示，不改变团队内容；复用 `agent-team-console-model.test.ts` 与 `agent-teams-page.test.tsx` 的来源映射/链接用例。 | 来源链接打开失败沿桌面外链错误边界处理，页面仍保留本地团队；复用团队详情的外链处理。 | 来源展示失败不回滚本地安装；来源动作不存在，安装/重启后仍依赖本地 record 和目录；`github-team-pages.test.tsx`、`agent-team-detail.test.tsx` 与 GitHub Electron 验收覆盖。 |

## 验收标准落位自查

| 验收项 | 实现落位 | 测试/验收落位 | 结果 |
| --- | --- | --- | --- |
| 官方与 GitHub 安装使用同一普通本地团队模型 | `team-seed.ts`、`github-team-installation.ts`、显式 member binding | `team-seed.test.ts`、`github-team-installation.test.ts` | 已覆盖 |
| 只保存描述性 `installationSource` | `team-record-store.ts`、catalog/renderer source projection | `team-record-store.test.ts`、`agent-team-console-model.test.ts` | 已覆盖 |
| 新安装不写 `official-state-v1.json`，团队由目录和 record 发现 | seed/import/startup/catalog | `team-seed.test.ts`、`team-runtime-binding.test.ts`、GitHub Electron 验收 | 已覆盖 |
| 不再执行 team-auto-sync、check、sync、revert、detach | startup、revision wiring、IPC/preload、hooks、UI | `desktop-startup-runtime.test.ts`、IPC/UI targeted tests、静态残留检查 | 已覆盖 |
| 官方与 GitHub 来源使用同一编辑、运行配置、修复、复制、删除 UI | team service、renderer、console-ui | `team-ipc.test.ts`、`agent-teams-page.test.tsx`、`agent-team-detail.test.tsx` | 已覆盖 |
| GitHub 来源仍可识别并打开仓库 | source link projection and callback | `agent-teams-page.test.tsx`、`github-team-pages.test.tsx`、GitHub Electron 验收 | 已覆盖 |
| 旧 `.system`、历史会话、旧路径和旧状态只兼容读取 | catalog/profile/runtime fallback | `team-runtime-binding.test.ts`、`team-record-store.test.ts`、startup test | 已覆盖 |
| 失败不留下半成品，重启后本地内容仍可用 | seed/import atomic boundaries and persisted record | `team-seed.test.ts`、`github-team-installation.test.ts`、GitHub Electron 验收 | 已覆盖 |

## 实际验证记录

- `pnpm run test --scope`：根 3 个文件 / 17 个用例、desktop 55 / 361、console-ui 52 / 609，均通过，退出码 0。
- `pnpm test`：根非慢测套件 151 个文件通过、1 个跳过（1073 个用例通过、5 个跳过，188.31s）；根慢测 1 / 68（38.98s）；desktop 174 / 903（71.60s）；console-ui 69 / 689（21.46s）；四段均退出码 0。跳过项按仓库既有条件跳过，未计为失败。
- `pnpm typecheck`：根、desktop、console-ui 的 `tsc --noEmit` 均完成，退出码 0。
- `pnpm --filter @moebius/desktop build`：`✓ built in 10.63s`，退出码 0。
- `pnpm check:boundaries`：`[import-boundaries] ok: 849 source files, 694 production files, 3 roots`，退出码 0。
- `pnpm exec tsx scripts/acceptance/github-team-electron.ts`：真实 Electron 搜索→预览→安装→打开→重启通过；来源 record、成员本地内容、无 `official-state-v1.json` 和无旧更新控件均已核对，退出码 0。
- `pnpm exec tsx scripts/acceptance/github-team-real-smoke.ts`：真实 `gh` 快照→安装通过，来源为 `github/tranfu-labs/moebius-team-dev-deliver/main`，`official-state-v1.json: absent`，退出码 0。

## 步骤 1 基线对比

步骤 1 的完整基线命令是 `pnpm test`。首次尝试因环境缺少 `tsx` 只得到 `sh: tsx: command not found`，未计入基线；安装依赖后的留存日志为 `/private/tmp/moebius-step1-test.log`，四段测试均实际执行且退出码 0。本次回归使用同一命令，未重复增加完整闸门次数。

| 测试段 | 步骤 1 基线 | 本次回归 | 通过 / 失败对比；测试数变化 |
| --- | --- | --- | --- |
| 根非慢测 | 144 文件通过、1 跳过；1028 用例通过、5 跳过 | 151 文件通过、1 跳过；1073 用例通过、5 跳过 | 失败 0 → 0；净增加 7 文件 / 45 用例 |
| 根慢测 | 1 文件、68 用例通过 | 1 文件、68 用例通过 | 失败 0 → 0；无变化 |
| desktop | 176 文件、945 用例通过 | 174 文件、903 用例通过 | 失败 0 → 0；净减少 2 文件 / 42 用例（移除更新操作测试） |
| console-ui | 69 文件、698 用例通过 | 69 文件、689 用例通过 | 失败 0 → 0；净减少 9 用例（移除更新操作 UI 测试） |
| 合计 | 390 文件通过、1 跳过；2739 用例通过、5 跳过 | 395 文件通过、1 跳过；2733 用例通过、5 跳过 | 失败 0 → 0；净测试数 -6，跳过数不变 |

基线通过而本次失败的测试段为 0；本次四段输出均无失败。删除同步／检查／撤销／解绑行为后，测试总数的净减少是有意的，不把被删除行为的旧断言计作新增覆盖。

步骤 1 其他基线命令也已按原命令复核：`pnpm typecheck` 基线与本次均退出码 0；`pnpm --filter @moebius/desktop build` 从 `✓ built in 10.18s` 变为 `✓ built in 10.63s`，均退出码 0；`pnpm check:boundaries` 从 `851 source files, 698 production files` 变为 `849 source files, 694 production files`，均退出码 0。
