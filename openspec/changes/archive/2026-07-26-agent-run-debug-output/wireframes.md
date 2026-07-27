# 线框：agent-run-debug-output

## 基线

页面已建立 PRD，当前版式基线为 `docs/product/pages/main-right-sidebar.md#页面结构`。本文件只表达本 change 的过程标签变化；归档时按项目规则回流该页面 PRD，不写入旧 `docs/wireframes/`。

## pages/main-right-sidebar.md

### Codex attempt · 默认折叠

```text
│ 改动 × │ 开发 × │ ＋                                │
│ ─────────────────────────────────────────────────── │
│ 开发 · 这一步的调试调用链                跟随最新   │
│ ─────────────────────────────────────────────────── │
│             ↑ 向上滚动加载更早过程                  │
│ ── 第 1 次执行 · completed · 耗时 02:18 ───────── │
│ model gpt-5 · effort high · provider openai         │
│ CLI 1.2.3 · run run_01 · thread thread_01           │
│ 2026-07-26T14:30:02.114+08:00                       │
│ → 2026-07-26T14:32:20.602+08:00                     │
│                                                    │
│ ⚠ 本地原始调试信息，可能包含提示词、路径与内部标识 │
│                                                    │
│ ▸ SYSTEM_PROMPT                                     │
│ ▸ DEVELOPER_PROMPT                                  │
│ ▸ USER_INPUT                                        │
│                                                    │
│ ── 调用与输出 ──────────────────────────────────── │
│ 14:30:05.031  response_item · function_call         │
│ call_id: call_01 · exec_command · started           │
│ ▸ arguments（原文）                                 │
│                                                    │
│ 14:30:06.408  response_item · function_call_output  │
│ call_id: call_01 · completed                         │
│ ▸ output（原文）                                    │
│                                                    │
│ 14:32:20.411  response_item · assistant              │
│ ▸ 原始输出                                          │
│                              [↓ 3 条新内容 / 到最新] │
```

### 展开 SYSTEM_PROMPT 与长工具结果

```text
│ ▾ SYSTEM_PROMPT                                     │
│ ┌────────────────────────────────────────────────┐ │
│ │ You are Codex, an agent based on GPT-5…        │ │
│ │ …                                              │ │
│ │ <完整原文；等宽；可选中；内部滚动，不截头尾>  │ │
│ └────────────────────────────────────────────────┘ │
│ ▸ DEVELOPER_PROMPT                                  │
│ ▸ USER_INPUT                                        │
│                                                    │
│ 14:30:06.408  response_item · function_call_output  │
│ call_id: call_01 · completed                         │
│ ▾ output（原文）                                    │
│ ┌────────────────────────────────────────────────┐ │
│ │ /Users/example/project                         │ │
│ │ runId=debug-marker                             │ │
│ │ ...                                            │ │
│ │ 最后一行                                       │ │
│ └────────────────────────────────────────────────┘ │
```

### prompt 惰性读取状态

```text
加载中：
│ ▾ SYSTEM_PROMPT                                     │
│   正在读取这次执行的提示词…                         │

单层缺失：
│ ▾ DEVELOPER_PROMPT                                  │
│   该层未记录。                                      │

读取失败：
│ ▾ SYSTEM_PROMPT                                     │
│   提示词暂时无法读取。                  [重试]       │

```

### 多 attempt 与局部不可用

```text
│ ── 第 1 次执行 · failed · 耗时 00:31 ───────────── │
│ model gpt-5 · …                                     │
│ ▸ SYSTEM_PROMPT  ▸ DEVELOPER_PROMPT  ▸ USER_INPUT  │
│ …第 1 次调用、错误与结束事件…                       │
│                                                    │
│ ── 第 2 次执行 · unavailable ───────────────────── │
│ 这次执行的 Codex 过程记录已不可用。                 │
│ 最终回复仍保留在主对话区。                          │
│                                                    │
│ ── 第 3 次执行 · completed · 耗时 00:22 ───────── │
│ model gpt-5 · …                                     │
│ ▸ SYSTEM_PROMPT  ▸ DEVELOPER_PROMPT  ▸ USER_INPUT  │
│ …第 3 次自己的调用、输出与结束事件…                 │
```
