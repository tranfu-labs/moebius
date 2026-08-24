# 提案：claude-terminal-demotion

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | [#Claude 运行中的呈现与原生确认](../../../docs/product/pages/main-conversation.md) | 新增小节（取代原 #Claude TUI 运行表面）：主时间线与其他引擎同构、原始终端不再进主时间线、等待确认与已停下两种运行块形态及其字符图 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | [#过程标签](../../../docs/product/pages/main-right-sidebar.md) | 新增：Claude 尝试增加默认收起的终端诊断区，只读回放、不接受输入、不作为过程步骤来源 | 已写入 |
| `docs/product/pages/main-conversation.md` | #指标与验收 | 新增验收 121（终端部分）、122 | 已写入 |

字符图已随小节写入页面 PRD，本 change 不建 `wireframes.md`——`main-conversation.md` 与 `main-right-sidebar.md` 都已建页面 PRD，版式事实源以 PRD 为准，另建 wireframes 会制造双源。

## 背景

主时间线上的只读终端是 `claude-tui-resume` 的权宜产物：改用持久 TUI 后运行中没有结构化流可用，于是拿原始终端顶上做实时反馈。`claude-live-process-steps` 补齐了 Claude 的运行中过程步骤之后，这块终端从「唯一手段」退化为冗余的第二表面，并且是负资产：

- 与产品定位冲突。目标用户不是程序员，主时间线里一块 ANSI 重绘的 TUI 只制造噪音。
- 制造「看得见摸不着」的死角。终端硬只读（`disableStdin`、按键处理器恒 false），Claude 停在原生确认上时用户看得见菜单却点不了——这是所有组合里最差的一种。
- 让 PTY 的实现细节泄漏成产品语义。Claude TUI 每改一次外观，页面就跟着变一次。

同时 `claude-tui-native-prompt-gate` 已经能识别出「Claude 停在一个带候选项的未知确认上」并把候选项原样上抛，但没有让用户回答的入口，只能安全失败。

## 提案

- 主时间线运行块不再渲染原始终端，Claude 与其他引擎同构：过程步骤区 + 活动行 + Stop 后最终正文。
- 原始终端字节降级为诊断材料，移入右侧栏过程标签的终端诊断区，默认收起、只读回放。
- 运行块新增「等待确认」形态：把 `claude-tui-native-prompt-gate` 上抛的候选项原样列出，用户选择后由一条窄通道写回同一 PTY；识别不出候选项时仍是「已停下」形态 + 终端原文 + 显式重试。
- 反向通道只接受「哪个 run 的哪个待决策选了第几项」，不接受任意按键、命令或文本。

## 影响

- `console-ui`：运行块去掉终端分支、新增等待确认与已停下形态；终端组件迁至诊断区使用。
- `local-console`：新增待决策的选择控制路由；Claude 终端 trace 的消费位置由活动运行块改为尝试级诊断区。
- `desktop`：操作台页面的终端 trace 接线、右侧栏过程标签接线、控制 API 客户端。
- 依赖：`claude-live-process-steps`（否则拆掉终端后运行中是空白）、`claude-tui-native-prompt-gate`（提供待决策事实）。
- 不影响：Codex、Kimi、Pi 的运行块与过程标签；Claude 的 PTY 生命周期、hooks、resume 语义与最终正文来源。
