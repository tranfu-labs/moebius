# 任务：sidebar-project-conversation-load-more

- [x] 增加项目会话渐进加载的纯逻辑边界与测试
- [x] 在 ConversationSidebar 接入默认 5 条、每次追加 10 条和可取消加载态
- [x] 增加英文 `Show More`、中文“显示更多”及辅助加载文案
- [x] 补齐侧栏组件测试与必要的长列表 Story
- [x] 执行真实 Electron 侧栏验收

## 真机验收记录

执行命令：`pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts --case project-conversation-load-more`

证据文件：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-console-dashboard-ui-mpj7Q4/project-conversation-load-more-evidence.json`

- environment：真机；入口：真实 Electron 左侧项目列表中的分页验收项目；操作：打开项目并观察会话列表底部；屏幕观察：项目展开后显示 5 条最新未置顶对话，底部显示 Show More；与承诺一致：是。
- environment：真机；入口：真实 Electron 项目会话列表底部的 Show More；操作：使用真实鼠标按下并释放 Show More；屏幕观察：按钮先进入 disabled/aria-busy 加载态，完成后列表显示 15 条对话；与承诺一致：是。
- environment：真机；入口：真实 Electron 项目行 disclosure；操作：第二次加载尚未完成时用真实鼠标折叠项目，再重新展开；屏幕观察：折叠后加载态消失，重新展开显示 5 条对话且 Show More 可用；与承诺一致：是。
- environment：真机；入口：真实 Electron 项目会话列表底部的 Show More；操作：连续使用真实鼠标加载剩余批次；屏幕观察：列表最终显示 26 条对话，已无更多时 Show More 隐藏；与承诺一致：是。

## 有意偏离清单

- `packages/console-ui/src/console/conversation-sidebar.tsx` 的本地加载提交边界采用可取消 120ms 延迟；相对方案中“下一帧再追加 10 条”的未量化默认时序，理由是首次真实 Electron 验收观察到 0ms 边界无法让用户观察到 loading，120ms 验证可见且不改变分页数量、排序或折叠重置语义。【实现层】

## 步骤 4：边界与回归记录

- 边界矩阵：[boundary-matrix.md](boundary-matrix.md)。空输入、非法/超限、并发/重入、无权限、失败恢复五类情形均已逐格落位处理与测试/复用点。
- 基线对比：console-ui build 基线 9.31s，本次 11.24s；console-ui 侧栏定向测试基线 36 通过，本次 43 通过（新增 7 项，失败均为 0）；typecheck 基线与本次均退出码 0。
- 步骤 1 的完整 `pnpm test` 当时未执行，因此没有可比较的全量基线；本次 change 唯一一次 `pnpm test` 退出码 0，4 组结果合计 2521 通过、4 跳过、0 失败：根套件 961 通过/4 跳过，local-console execution 67 通过，desktop 810 通过，console-ui 683 通过。跳过项为既有 `tests/claude-real.acceptance.test.ts` 的 4 项真实 Claude 验收，不由本 change 引入。

## 遗留事项终稿

- 不采纳的评审提醒及理由：无。
- 无本项目依据条目及风险判定结果：无；步骤 2 已判定无方向性风险，所有方向选择均有需求、仓库惯例、方案或真实验证依据。
- 待核实与未验证项：Storybook 大 chunk warning 待核实是否为既有基线问题；完整测试中既有 `tests/claude-real.acceptance.test.ts` 的 4 项真实 Claude 验收未执行。
