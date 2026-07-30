# 版式：sidebar-conversation-management

基线：

- `docs/product/pages/main-left-sidebar.md#页面结构`
- `docs/product/pages/main-right-sidebar.md#标签条`
- 已确认探索：`docs/product/pages/main-left-sidebar.prototype.html`

## pages/main-left-sidebar.md

```text
┌ Sidebar ────────────────────────┐
│ traffic lights          close  │
│ Moebius                        │
│ ＋ 新建对话                    │
│ ⌕ 搜索                         │
│ ◇ Agent 团队                  │
│ ┌ shared scroll ─────────────┐ │
│ │ 置顶                       │ │
│ │   Conversation A       ●   │─┼──┐
│ │ 项目                       │ │  │ single shared preview
│ │ ▾ Project                  │ │  │ title
│ │   Conversation B       ◌   │─┼──┘ folder · branch
│ └────────────────────────────┘ │
│ ? 重新查看引导                │
│ ⚙ 设置                         │
└────────────────────────────────┘
```

置顶条目不在项目下重复；共享浮层只有一份，沿目标行纵向跟随。

## pages/main-right-sidebar.md

```text
┌ right sidebar tabs ──────────────────────────────┐
│ [同名会话             ][同名会话             ] +│
│  folder · branch · time  folder · branch · time │
└──────────────────────────────────────────────────┘
```

唯一标题不显示第二行；同名或“标题更新中”显示稳定第二行。标题变宽时只保证选中或聚焦标签完整可见，不裁决精确滚动动画。
