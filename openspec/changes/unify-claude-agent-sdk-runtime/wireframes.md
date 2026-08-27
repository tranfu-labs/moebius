# wireframes：unify-claude-agent-sdk-runtime

> 基线：`docs/wireframes/pages/console.md` 与页面事实源 `docs/product/pages/main-conversation.md`。本文件只记录本次移除 Claude raw-terminal 表面的版式变化，不替代页面 PRD。

## pages/console.md

### Claude 运行块（改造后）

```text
┌ 开发 · Claude Code · 运行中                         [停下] ┐
│ 正在读取工作区 · Claude                                  │
│ 已产生 3 个工具活动 · 运行 00:12                         │
│                                            [完整输出 →] │
└───────────────────────────────────────────────────────────┘

┌ Claude Code · 已完成 · 00:18                              ┐
│ 最终回复正文                                               │
│                                            [完整输出 →] │
└───────────────────────────────────────────────────────────┘
```

- 不出现 `Claude terminal`、PTY 原始字节、登录/信任/MCP 确认输入框或终端滚动区域。
- 运行中只显示结构化最新活动与状态；完整过程、thinking、工具、错误和 usage 仍从右侧栏唯一过程标签打开。
- 历史过程记录不可用时，在「完整输出」原位置显示局部不可用说明；最终回复卡片不被清空或改称完整输出。
- Codex、Kimi、Pi 的既有运行块和右侧栏布局不因本 change 改变。
