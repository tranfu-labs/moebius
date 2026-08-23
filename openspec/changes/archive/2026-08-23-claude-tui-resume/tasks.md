# 任务：claude-tui-resume

## 基础 transport

- [x] 增加 `node-pty` 运行时依赖与可注入的 Claude PTY adapter
- [x] 实现单 PTY generation、原始字节转发、原样人类输入、resize、idle 收束与有限退出
- [x] 用 fake PTY 覆盖输入、输出顺序、并发重入、空输入、idle 与异常退出

## Claude lifecycle 与结果

- [x] 创建私有 lifecycle hook settings/receiver，验证 capability、事件顺序与 payload 丢弃
- [x] 接入 `claude.ts`：interactive full、存活期间复用、idle 后精确 `--resume`
- [x] 将 transcript resolver 限制为 Stop 后的最终正文与 usage；移除 Claude stream-json 正文投影
- [x] 处理 Claude 原生工作区信任提示：显式人类选择、同 PTY 回写与原始任务保留

## 托管运行项与运行态

- [x] 为 Claude TUI bridge 实现每轮 managed-process capability lease 与撤销
- [x] 为 runtime 增加 Claude terminal byte trace/delta，保持 JSONL 正文事实源不变

## 界面与打包

- [x] 增加只读 Claude terminal surface、重连回放和 ANSI 安全边界
- [x] 将 `node-pty` 外置/解包进 Electron macOS arm64 产物并验证 helper 可执行

## 验证与事实源

- [x] 运行模块定向测试、类型检查与 import-boundary 检查
- [x] 在真实 Claude CLI 中验收显式信任、两轮同 PTY、完整终端流、hooks、idle、精确 resume 与 cache-read usage
- [x] 在真实 Electron 主页面验收同一路径的信任决策、终端显示与恢复
- [x] 完成 Claude TUI 异常边界矩阵与步骤 1 基线回归对比
- [x] 完成 spec delta 回流、模块地图和产品事实核对
