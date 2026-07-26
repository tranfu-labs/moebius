# 线框：enhance-conversation-relay-rail-motion

基线：`docs/wireframes/pages/console.md`。该页面已由 `docs/product/pages/main-conversation.md` 接管；归档时只核对页面 PRD，不向旧 wireframe 写入第二份事实。

## pages/main-conversation.md

```text
收起（共同左端）      展开过程                   展开完成

━                     ━──→ ◆                   ◆
━━━━                  ━──────→ ●               ╰──●
━━                    ━──────────→ ●               ╰──●

↑ 左端 x 不变          ↑ 面板只向右打开           ↑ 真实泳道位置
```

```text
检查事件从上行切换到下行

┌──────── 展开轨迹面板 ────────┐  12px  ┌──────── 预览 ────────┐
│ ◆                            │        │ 产品交付负责人 · 10:21 │
│      ●  ← 原检查事件          │        │ 原回复开头……           │
│            ● ← 新检查事件     │        └──────────────────────┘
└──────────────────────────────┘
                                          ↓ 仅纵向连续跟随
```
