# 任务：claude-terminal-demotion

## 主时间线（console-ui / desktop）

- [x] `run-block.tsx` 去掉 `claudeTerminal` 分支及其 props
- [x] 新增「等待确认」形态：候选项原样单选列表 + 诊断区入口，不显示为正在工作
- [x] 新增「已停下」形态：沿用既有安全失败块，附诊断区入口与显式重试
- [x] 两种形态都不出现可输入控件；候选项与主时间线内容按纯文本/结构化内容渲染，不解释 HTML / Markdown / 脚本 / 终端控制序列
- [x] `operator-console.tsx`、`subtask-tab.tsx`、`operator-console-view.tsx`、`sidebar-conversation-view.tsx` 与桌面组合根完成接线（`app.tsx` 无需改动）
- [x] 补 Story 与组件测试：等待确认、已停下、无终端诊断三种状态

## 终端诊断区（console-ui / desktop）

- [x] 右侧栏过程标签的每次尝试下新增默认收起的终端诊断区，复用 `ClaudeTerminalSurface` 的只读约束
- [x] `use-claude-terminal-traces.ts` 与 `console-api-client.ts` 的取数改为按尝试维度
- [x] 定义按尝试保留的字节上限与清理时机；超限显示「该次执行的终端诊断已不完整」，不静默截断
- [x] 终端已不存在时显示该次执行的终端诊断不可用，其余原生记录仍完整可读

## 反向控制通道（local-console）

- [x] 将 Claude 待决策事实投影到对应 active run，接受选择后清除投影，快照不包含 PTY 按键值
- [x] runtime 核心按候选项序号派生 PTY 按键，并对同一待决策的重复提交保持幂等
- [x] 新增待决策选择控制路由：只接受会话、待决策标识与候选项序号
- [x] 越界序号、已消费标识、已离开等待态一律拒绝并说明；重复提交幂等
- [x] 按序号生成的按键在后端写入 PTY，renderer 不接触按键值
- [x] 补契约测试：任意按键 / 文本 / 命令请求被拒绝

## 测试

- [x] 组件：等待确认形态渲染候选项原文顺序与数量，不改写文案
- [x] 组件：过程标签按 Claude attempt 展示默认收起诊断，并覆盖诊断不完整与不可用
- [x] 单元：选择第 N 项写入对应按键恰好一次；重复提交不重复写入
- [x] 单元：本轮已离开等待态时选择请求被拒绝且不写 PTY
- [ ] 扩展 `scripts/acceptance/claude-tui-electron.ts`：真实页面断言主时间线无终端、诊断区可展开看到原始字节、待决策卡片选择后本轮继续
