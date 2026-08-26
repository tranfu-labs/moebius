# 交付汇总：workspace-preference-direct-selection

## 1. 变更摘要

- `packages/console-ui`：移除独立工作空间确认弹窗；保留菜单内的提交边界说明，点击后直接切换当前草稿。
- `desktop`：增加项目 workspace preference mutation，接入主新对话与侧栏新对话草稿；复用既有错误控制器、刷新链路和同项目串行队列。
- `src/local-console`：不新增生产数据结构；复用 `projects.worktree_mode`、既有 PATCH API 和会话创建默认逻辑。
- 测试覆盖 UI、desktop mutation、SQLite/API 隔离与重启持久化；产品意图、proposal、design、spec-delta 和边界矩阵均保存在本 change 目录。

运行：`pnpm desktop` 启动桌面开发态；`pnpm start` 启动 local console。

## 2. 测试报告与基线对比

步骤 1 基线 → 步骤 4 最终回归：

| 套件 | 基线 | 最终 | 对比 |
| --- | --- | --- | --- |
| 根套件 | 144 文件通过、1 跳过；1028 测试通过、5 跳过 | 145 文件通过、1 跳过；1031 测试通过、5 跳过 | +1 文件、+3 测试，失败数 0 |
| desktop | 176 文件、945 测试通过 | 178 文件、951 测试通过 | +2 文件、+6 测试，失败数 0 |
| console-ui | 69 文件、698 测试通过 | 69 文件、698 测试通过 | 无变化，失败数 0 |

其他实际命令结果：

- `pnpm check:boundaries`：退出码 0，853 source files、698 production files、3 roots。
- `pnpm typecheck`：退出码 0。
- `pnpm --filter @moebius/desktop build`：退出码 0。
- `pnpm --filter @moebius/console-ui check:storybook`：退出码 0，62 stories 构建完成。
- `git diff --check`：退出码 0。
- 真机命令退出码 0；6 条环境为“真机”的用户动作证据记录在 [tasks.md](./tasks.md)。证据 JSON 与截图写入系统临时目录。

测试输出保留 5 条基线既有跳过项；Storybook 的 CJS/eval 警告和既有 React act 警告未导致失败。

## 3. 与需求差异清单（终稿）

无。用户确认的方案 A 已实现：显式选择立即保存当前项目偏好，当前草稿立即切换，已有会话保持原 workspace mode。

## 4. 建议回退需求的问题清单

无。未改变需求项、验收标准或用户可见行为语义。

## 5. 有意偏离清单（汇总）

无。所有实现决策均可追溯到用户确认方案、产品需求或仓库既有 API/数据模型/错误处理惯例。

## 6. 遗留事项终稿与对账清单

### 遗留事项三类来源

- 不采纳的评审提醒及理由：无；收到的评审提醒均已采纳并处理。
- “无本项目依据，仅为惯例”条目及风险判定：无；方向性风险已由用户确认方案 A 关闭，既有 store 行为由回归测试验证。
- 待核实项：无。
- 未验证项：既有基线中的 5 条 `claude-real.acceptance.test.ts` 跳过项；与本变更无关，最终回归保持原数量。

### 对账

- 验收标准落位自查：全部通过。
- 边界矩阵：3 个功能单元 × 空输入、非法或超限输入、并发或重入、无权限、失败恢复，共 15 格；无空白。
- 真机验收：无弹窗直接选择、项目偏好隔离、重启持久化、已有会话不变均已验证。
- 用户验收、change 归档、spec-delta 回流及 push/merge：待用户验收通过后执行。
