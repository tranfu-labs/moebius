# 线框：local-console-t2-e2e-spike

基线：[docs/wireframes/pages/observer.md](../../../docs/wireframes/pages/observer.md)（现状本地只读观察页）。本 change 不实现 `conversation-console` 的完整三栏操作台，只新增 T2 demo 级极简本地 HTTP 页面；归档时可回流为 `docs/wireframes/pages/local-console-spike.md`，后续 T4 再由完整 `pages/console.md` 取代。

## pages/local-console-spike.md

### 主视图

```text
┌──────────────────────────────────────────────────────────────┐
│ Moebius Local Spike        http://127.0.0.1:<port>      │
├──────────────────────────────────────────────────────────────┤
│ SQLite: .state/local-console.sqlite                          │
│ Session: default                    Status: idle/running      │
├──────────────────────────────────────────────────────────────┤
│ You · pending/running/completed                              │
│ @dev 帮我写个 hello                                           │
│                                                              │
│ dev · completed                                               │
│ <Codex final response shown here>                             │
│                                                              │
│ system · failed                                               │
│ <error summary shown here when Codex fails>                   │
├──────────────────────────────────────────────────────────────┤
│ [@dev 帮我写个 hello                                      ]    │
│                                                [Send]         │
└──────────────────────────────────────────────────────────────┘
```

要点：

- 单页单会话；不做项目侧栏、会话树、多角色可视化、产物面板或验收卡片。
- 页面必须展示 SQLite 路径摘要、session id、整体状态和消息状态，便于验收“本地通道 + SQLite 消息表”。
- 输入框允许手写 mention；本轮不做 @ 补全，合法性由 trigger 复用现有 parser 判定。
- user 消息、agent 回复、system error 在同一时间线顺序显示。
- 页面轮询刷新即可；不要求运行直播或 token 流。

### 运行中状态

```text
┌──────────────────────────────────────────────────────────────┐
│ Moebius Local Spike                         running     │
├──────────────────────────────────────────────────────────────┤
│ You · running                                                │
│ @dev 帮我写个 hello                                           │
│                                                              │
│ system                                                       │
│ Codex is running...                                          │
├──────────────────────────────────────────────────────────────┤
│ [input disabled while current message is running]     [Send] │
└──────────────────────────────────────────────────────────────┘
```

要点：

- 同一 session 串行执行，运行中禁用发送或显示排队提示。
- 不承诺中断按钮；中断属于 T4 完整操作台范围。

### 失败状态

```text
┌──────────────────────────────────────────────────────────────┐
│ Moebius Local Spike                          failed     │
├──────────────────────────────────────────────────────────────┤
│ You · failed                                                 │
│ @dev 帮我写个 hello                                           │
│                                                              │
│ system · displayed                                           │
│ Codex failed: idle-timeout:600000ms                          │
├──────────────────────────────────────────────────────────────┤
│ [@dev 再试一次                                           ]    │
│                                                [Send]         │
└──────────────────────────────────────────────────────────────┘
```

要点：失败必须在页面可见并持久化到 SQLite；不得只写 server 日志。

### Store 故障状态

```text
┌──────────────────────────────────────────────────────────────┐
│ Moebius Local Spike                     store error     │
├──────────────────────────────────────────────────────────────┤
│ system · displayed                                           │
│ SQLite write failed: SQLITE_BUSY after 2000ms                 │
│                                                              │
│ No Codex run was started.                                    │
├──────────────────────────────────────────────────────────────┤
│ [@dev 帮我写个 hello                                    ]      │
│                                                [Send]         │
└──────────────────────────────────────────────────────────────┘
```

要点：POST 写入、claim、sink 写回任一 store failure 都必须在页面或 API 中可见；写入失败不得启动 Codex，也不得显示 completed。
