# completion-handoff 交付包（待用户验收）

状态：M1/M2、步骤 4 本地边界与全量回归已完成；六件套已整理；M3 外部事实仍未验证，等待用户验收

日期：2026-08-27

## 1. 变更摘要

本轮实现 Claude Code 与 Codex 的 Moebius `completion-handoff` Skill 分发；Kimi/Pi 原生 Skill 投影按用户确认保留为 TODO，并继续使用 prompt fallback。

- 新增 `.agents/skills/completion-handoff/SKILL.md` 作为仓库源 Skill，使用运行环境已经公开的既有表单能力，不定义新的 MCP 工具名。
- 新增 `src/local-console/moebius-skill-registry.ts`：启动时把源 Skill 复制到 `dataRoot/skills/moebius`，并在 Claude Code/Codex 标准用户 Skill 根建立不覆盖冲突项的 `moebius-*` 软链接。
- CLI 与 Desktop 启动入口接入注册表；Desktop 打包把 `.agents/skills` 纳入只读 seed。
- Claude/Codex 使用原生 Skill 加载边界；Kimi/Pi 保留现有 prompt fallback。
- 移除误实现的 closeout MCP、SQLite 状态协议、local-console 路由、专属 UI 与对应镜像测试；现有 `moebius_managed` MCP 不变。

运行入口沿用仓库命令：`pnpm start` 或 `pnpm desktop`。生产启动默认使用真实用户 home 的标准 Skill 根；隔离测试可设置 `MOEBIUS_SKILL_PROJECTION_HOME`。本轮不修改 provider 设置、凭据、hooks 或项目配置。

## 2. 测试报告

- `python3 /Users/wing/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/completion-handoff`：退出码 0，输出 `Skill is valid!`。
- `pnpm test tests/moebius-skill-registry.test.ts`：退出码 0；1 个测试文件通过，6 个测试通过，0 失败，0 跳过；Vitest 报告耗时 437ms。原始输出保存在 `/tmp/moebius-skill-registry.log`。
- `pnpm test tests/moebius-skill-registry.test.ts tests/local-console.test.ts tests/local-console-codex-resume.test.ts tests/local-console-run-invocation-plan.test.ts tests/runtime-start.test.ts tests/local-console-execution-driver.test.ts`：退出码 0；6 个测试文件通过，114 个测试通过，0 失败，0 跳过；Vitest 报告耗时 51.67s。原始输出保存在 `/tmp/moebius-completion-handoff-module.log`。
- `git diff --check`：退出码 0，无输出。
- `pnpm typecheck`：退出码 0；根、Desktop、console-ui 三段 TypeScript 检查均无错误。
- `pnpm check:boundaries`：退出码 0；`ok: 852 source files, 699 production files, 3 roots`。
- `pnpm --filter @moebius/desktop build`：退出码 0；console bundle `✓ built in 12.64s`，native permission bridge 构建完成。
- 上述三项的实际输出分别保存在 `/tmp/moebius-completion-handoff-typecheck.log`、`/tmp/moebius-completion-handoff-boundaries.log`、`/tmp/moebius-completion-handoff-desktop-build.log`。
- `pnpm test`：退出码 0；root 非慢测为 145 文件通过、1 跳过，1036 测试通过、5 跳过，167.04s；root 慢测为 1 文件、68 测试通过，33.40s；Desktop 为 176 文件、945 测试通过，77.63s；console-ui 为 69 文件、698 测试通过，18.55s。全量原始输出保存在 `/tmp/moebius-completion-handoff-full.log`。
- 全量输出中的 `claude-real.acceptance.test.ts` 仍为 5 个跳过；若干 `processing-failed` 日志是测试注入的失败路径，Vitest 汇总为 0 失败。
- `managed_process_start(executable=pnpm, args=[desktop], cwd=., kind=service)`：托管进程 `cadb7ff6-a36d-459a-912f-36bff1924343` 状态为 `running`；日志确认 Desktop build 完成、local console 监听 `127.0.0.1:63971`、DevTools 监听 `127.0.0.1:9222`。
- 单一黄金案例 `pnpm exec tsx -e '<CDP 页面冒烟>'`：退出码 0；输出 `ok: true`、`case: desktop-running-page-smoke`、`title: Moebius`、`settingsVisible: true`、`containsMoebius: true`，原始输出保存在 `/tmp/moebius-desktop-golden-case-retry.log`。首次内联命令因顶层 await 的 CJS 转换错误未进入断言，修正为 async IIFE 后同一案例通过；该失败不属于 Desktop 运行失败。
- 步骤 1 基线：Desktop build 退出码 0（`✓ built in 9.94s`）；`pnpm test` 退出码 1，150 文件通过、1 失败、1 跳过，1052 通过、1 失败、5 跳过；失败为既有 SQLite lock 测试，原因待核实。

### 基线对比

| 项目 | 步骤 1 基线 | 当前回归 | 对比 |
| --- | --- | --- | --- |
| root 非慢测 | 150 文件通过、1 跳过；1052 测试通过、5 跳过；200.68s | 145 文件通过、1 跳过；1036 测试通过、5 跳过；167.04s | 减少 5 文件、16 测试；减少项对应此前误实现 closeout MCP 的测试清理 |
| root 慢测 | 1 文件失败、67 测试通过、1 失败；41.44s | 1 文件通过、68 测试通过；33.40s | 基线失败已消失，测试总数不变 |
| Desktop | 因 root 慢测失败未执行 | 176 文件、945 测试通过；77.63s | 本次实际执行并通过 |
| console-ui | 因前序失败未执行 | 69 文件、698 测试通过；18.55s | 本次实际执行并通过 |
| 新增测试用例 | — | 8 个（registry 6、启动 1、invocation plan 1） | 已纳入当前回归 |

步骤 1 全量命令退出码为 1（root 慢测中的既有 SQLite lock 失败）；当前同一 `pnpm test` 退出码为 0。边界矩阵见 `boundary-matrix.md`。

## 3. 与需求差异清单终稿

无。用户 #64 明确要求不修改 MCP；本实现移除此前误接入的自建 MCP，并只保留 Skill + 运行环境已有表单能力。外部表单实际发布与可见性尚未验证，不改变需求语义。

## 4. 建议回退需求的问题清单

无。外部表单发布路径与真实 provider 演练是待核实/未验证事实，不是建议改变的需求。

## 5. 有意偏离清单汇总

1. 【实现层】provider 标准 Skill 根使用单层 `moebius-completion-handoff` 入口，中心注册表保留 `skills/moebius/completion-handoff`；理由是 Claude Code/Codex 的个人 Skill 根按 Skill 目录直接发现 `SKILL.md`，中心目录承担 Moebius 命名隔离而不把未确认的嵌套目录协议暴露给 provider。

## 6. 遗留事项终稿 + 对账清单

- 不采纳的评审提醒：无。
- “无本项目依据，仅为惯例”项：无；provider 标准目录来自本地安装布局与官方 Skill 文档核对，既有表单协议仍待核实。
- `origin/claude/agent-form-ui` 的最终发布/部署路径和调用协议：待核实。
- 本模块 Codex 标准目录修正后的 registry 回归：已由上述 6 文件定向回归覆盖，退出码 0。
- 真实 Claude/Codex provider 端到端发现本地投影 Skill：未验证。
- 当前 session 未公开可调用的既有表单工具名；真实 Moebius 运行时发现、展示和回流既有表单：未验证。
- Kimi/Pi 原生 Skill 投影：用户确认的 TODO。
- 步骤 1 基线中的既有 SQLite lock 失败原因：待核实。
- 尚未执行 commit、push、merge、Trash 或发布动作，等待终验收。

### 对账清单

- [x] 自建 closeout MCP 运行时接入已移除；既有 `moebius_managed` MCP 保留。
- [x] Skill 源、注册表和 Claude/Codex 投影路径已实现。
- [x] 本模块测试命令与输出已补齐：6 个测试文件、114 个测试通过，0 失败，0 跳过。
- [x] 仓库可验证验收标准落位自查全部通过：错误自建 MCP 名称、server/schema/bridge/preflight 与专属状态/UI 接入均已清除；Skill 分发、native/fallback prompt 边界与四类选项/无副作用规则已落到源 Skill 和 prompt；相关定向测试已覆盖。
- [ ] 目标 Moebius 运行时既有表单的发现、展示和选择回流：未验证；当前 session 未公开可调用工具名，不能宣称外部演练通过。
- [x] 边界矩阵五类异常均有处理说明，无空白；步骤 4 全量回归已完成，基线失败未复现。

用户验收通过后，才视为授权执行后续 push、merge 或其他外发动作；当前未执行任何外发或破坏性操作。
