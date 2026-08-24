# 任务：claude-terminal-demotion

## 主时间线（console-ui / desktop）

- [ ] `run-block.tsx` 去掉 `claudeTerminal` 分支及其 props
- [ ] 新增「等待确认」形态：候选项原样单选列表 + 终端原文折叠区，不显示为正在工作
- [ ] 新增「已停下」形态：沿用既有安全失败块，附终端原文折叠区与显式重试
- [ ] 两种形态都不出现可输入控件；候选项与终端原文按纯文本渲染，不解释 HTML / Markdown / 脚本 / 终端控制序列
- [ ] `operator-console.tsx`、`subtask-tab.tsx`、`app.tsx`、`operator-console-view.tsx`、`sidebar-conversation-view.tsx` 随之调整接线
- [ ] 补 Story 与组件测试：等待确认、已停下、无终端诊断三种状态

## 终端诊断区（console-ui / desktop）

- [ ] 右侧栏过程标签的每次尝试下新增默认收起的终端诊断区，复用 `ClaudeTerminalSurface` 的只读约束
- [ ] `use-claude-terminal-traces.ts` 与 `console-api-client.ts` 的取数改为按尝试维度
- [ ] 定义按尝试保留的字节上限与清理时机；超限显示「该次执行的终端诊断已不完整」，不静默截断
- [ ] 终端已不存在时显示该次执行的终端诊断不可用，其余原生记录仍完整可读

## 反向控制通道（local-console）

- [ ] 新增待决策选择控制路由：只接受会话、待决策标识与候选项序号
- [ ] 越界序号、已消费标识、已离开等待态一律拒绝并说明；重复提交幂等
- [ ] 按序号生成的按键在后端写入 PTY，renderer 不接触按键值
- [ ] 补契约测试：任意按键 / 文本 / 命令请求被拒绝

## 测试

- [ ] 组件：等待确认形态渲染候选项原文顺序与数量，不改写文案
- [ ] 单元：选择第 N 项写入对应按键恰好一次；重复提交不重复写入
- [ ] 单元：本轮已离开等待态时选择请求被拒绝且不写 PTY
- [ ] 扩展 `scripts/acceptance/claude-tui-electron.ts`：真实页面断言主时间线无终端、诊断区可展开看到原始字节、待决策卡片选择后本轮继续
