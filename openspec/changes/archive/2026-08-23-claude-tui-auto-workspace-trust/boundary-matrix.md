# 边界矩阵：claude-tui-auto-workspace-trust

本矩阵只覆盖本 change 改动的 Claude 原生工作区信任路径；Codex、Kimi 与 Pi 保持既有 transport、权限与恢复语义。OpenSpec spec-delta 在 change 归档时才合并进当前行为规格。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| 预任务原生提示识别与自动 Enter | 空／非匹配 PTY 数据保持 `waiting`，不写 Enter 或保留任务；复用 `claude-tui-workspace-trust.test.ts` 的 ordinary-output 路径。 | ANSI 分片、无可见空格 redraw 与非原生文本仅按已知指纹判定；未识别时不授权输入；`claude-tui-workspace-trust.test.ts`。 | 首次命中后锁定自动确认并切为只等正常输入；重复 redraw 与首任务后的仿冒文本不能追加 Enter；`claude.test.ts`、`claude-tui-workspace-trust.test.ts`。 | 不读取、创建或直接修改 Claude 信任记录，也没有 renderer／HTTP 授权通道；真实 CLI 以临时工作区验证同一 PTY 的原生默认动作。 | Enter 写入或 PTY 在确认前退出时落为既有安全失败；未识别提示不写任务，后续显式重试按既有 PTY generation 路径进行；`claude.test.ts`。 |
| 已删除的人工信任控制面 | 旧 POST 没有 handler，空决策不进入解析或 runtime；复用 retired-route 404 回归。 | 非法、过大或旧版 decision body 同样没有可达端点，不形成状态变更；`local-console-claude-workspace-trust.test.ts`。 | 重复／陈旧客户端请求均只能得到 404，不能向 active PTY 增加输入；同一回归覆盖无 route。 | 无 trust dialog、callback 或 API action，因此没有可被授予的人工权限；复用 console-ui 只读终端测试与 retired-route 404。 | 不存在等待人工选择的中间状态；运行仍通过既有 Claude 安全失败和重试路径收束；`claude.test.ts`、真实 Electron 验收。 |
| 原始 terminal trace 与只读 UI | 初始 cursor 取 0；无 chunk 时保持当前 trace；复用 `local-console-claude-terminal-trace.test.ts` 与轮询组件测试。 | 非法 cursor 返回 409；ANSI、非 UTF-8 与 HTML-like bytes 只作为终端字节显示；`local-console-claude-terminal-trace.test.ts`、`claude-terminal-surface.test.tsx`。 | trace 按 cursor 有序追加，桌面轮询维持 in-flight guard；复用既有 terminal trace 测试。 | 错 session/run 返回 404，不能读取其他 active trace；`local-console-claude-terminal-trace.test.ts`。 | 短暂轮询失败保留已显示 trace 并按既有 reconnecting 状态恢复；复用 terminal-trace hook 测试。 |
| 同一 live PTY、idle 精确 resume 与 transcript usage | 空后续输入复用 transport 的 `claude-tui-empty-human-input` 拒绝，不合成新的 Claude 命令；`claude-tui-transport.test.ts`。 | 缺失、冲突或不匹配 canonical session 时 fail closed，不回退为 full；`claude.test.ts`。 | live PTY 期间只允许同一 generation；第二轮不得新进程或 `--resume`；真实 CLI／Electron 验收。 | 复用 Claude 配置所有权边界：Moebius 不读写用户／项目配置，仍由 Claude Code 处理其原生权限；真实 CLI／Electron 验收。 | idle 后有界终止，下一轮只以同一 S 的 `--resume` 建新 PTY；终端与 transcript usage 不从 trace 推断；`claude.test.ts`、真实 CLI／Electron 验收。 |

## 本步验证与基线对比

- `pnpm --filter @moebius/desktop build`：exit 0；Console UI bundle `built in 4.86s`，两套 native permission bridge 均完成构建。
- `pnpm run test --scope HEAD^`：exit 0；import-boundaries 通过（811 source files／669 production files／3 roots），受影响测试文件 147 个。根套件 60 文件通过、1 文件跳过，564 通过、5 跳过（102.31 秒）；Desktop 39 文件／266 测试通过（20.05 秒）；Console UI 47 文件／578 测试通过（9.45 秒）。

| 指标 | 步骤 1 基线 | 步骤 4 重跑 | 对比 |
| --- | ---: | ---: | --- |
| Desktop build | exit 0；bundle 4.94 秒 | exit 0；bundle 4.86 秒 | 均通过；bundle 时间 -0.08 秒。 |
| import-boundaries | 815 source／671 production／3 roots | 811 source／669 production／3 roots | 均通过；删除旧人工控制面后 source -4、production -2。 |
| 影响测试文件 | 153 | 147 | -6；`--scope HEAD^` 按当前未提交差异重新计算依赖闭包，不等同于全量测试集合。 |
| 根套件文件 | 66（65 通过／1 跳过） | 61（60 通过／1 跳过） | -5 个 scope 文件，无失败。 |
| 根套件测试 | 592（586 通过／6 跳过） | 569（564 通过／5 跳过） | -23；人工 trust dialog／route 的失效覆盖已删除，真机 opt-in 跳过从 6 降至 5；无失败。 |
| 根套件耗时 | 102.78 秒 | 102.31 秒 | -0.47 秒。 |
| Desktop | 39 文件／266 测试通过（20.12 秒） | 39 文件／266 测试通过（20.05 秒） | 数量不变；-0.07 秒。 |
| Console UI | 48 文件／580 测试通过（9.32 秒） | 47 文件／578 测试通过（9.45 秒） | 删除人工 dialog 的测试／story 覆盖后 -1 文件、-2 测试；无失败。 |

真机 Claude CLI 与真实 Electron 的自动确认路径已在步骤 3 单独验证；本次 scope 中 5 条 `claude-real.acceptance.test.ts` 因未启用真机环境变量而跳过，不以跳过代替该真机证据。Console UI 范围回归保留既有 React `act(...)` warning，Vitest 汇总仍全部通过。
