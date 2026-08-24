# 任务：claude-tui-native-prompt-gate

## 前置验证（决定后续两项是否落地）

- [ ] 在能复现恢复模式菜单的真实 Claude CLI 版本上，确认 `--settings` 附加文件中 `enabledMcpjsonServers: ["moebius_managed"]` 能免除 MCP 授权确认；记录实际版本与观察结果
- [ ] 同一版本上确认「不再询问恢复模式」对应的 settings 键名与生效性；无法验证时明确记录「不可用」，不写入未经验证的键

## 原生确认门（local-console）

- [x] 新增 `src/claude-tui-native-prompt.ts`：四态判定（`waiting` / `native-prompt` / `terminal-ready` / `stalled`），保留任务写入后立即停止检测的既有边界
- [x] 结构层：`waiting` 下终端静默超阈值且未就绪判为 `stalled`；阈值可配置，判定前先确认 PTY 仍存活
- [x] 语义层：已知确认表三条（工作区信任、恢复模式、MCP 授权），命中即产出处置
- [x] 通用候选项抽取：从归一化终端文本中识别 `<数字>. <文本>` 连续行组，产出 `unknown-choice` 与候选项原文；抽取结果永不自动应答
- [x] 删除 `src/claude-tui-workspace-trust.ts`，信任规则并入已知确认表
- [x] `src/claude.ts`：`awaiting-terminal` 分支改接新判定；自动应答按确认类型写入对应按键，每类至多一次
- [x] 新增稳定失败原因 `claude-native-prompt-unresolved`，接入既有安全失败分类；终端原文只进诊断，不进正文

## 上游消除（local-console）

- [x] 临时 settings 写入 Moebius 自己的运行偏好键（仅限前置验证通过的键）
- [x] 断言 argv 仍不含 `--strict-mcp-config`、`--dangerously-skip-permissions`、`--permission-mode`，且不读取或改写用户／项目 Claude 配置

## 测试

- [x] 单元：假 PTY 喂入三种已知确认，各自自动应答恰好一次，且任务在正常输入提示返回后才写入
- [x] 单元：假 PTY 喂入一段未知菜单，断言在阈值内产出 `unknown-choice` 与候选项原文，且不写入任何按键
- [x] 单元：假 PTY 喂入一段无候选项的未知等待态，断言在阈值内进入 `claude-native-prompt-unresolved` 而非挂起
- [x] 单元：任务写入后再喂入形似确认的文本，断言不触发按键、lifecycle、正文或 usage
- [x] 单元：PTY 在等待期退出，断言归入既有非正常退出分类而非确认未解决
- [ ] 扩展 `scripts/acceptance/claude-tui-electron.ts`：全新目录首轮、idle 后 `--resume` 轮次、带 relay 的轮次三种场景全程无人介入完成，且页面不出现三种确认
