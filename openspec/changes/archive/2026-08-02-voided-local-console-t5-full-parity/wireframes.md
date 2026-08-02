# Wireframes：local-console-t5-full-parity

Baseline: `docs/wireframes/pages/console.md`.

## pages/console.md

### Parent session with child session tree

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Moebius                         1 运行中 · 1 等你      [打开文件夹] [诊断] │
├──────────────────────┬──────────────────────────────────────┬──────────────┤
│ Projects             │ 目标:本地全功能对等                  │ 目标验收     │
│ ▾ moebius      │                                      │ 子任务 2/3   │
│   worktree 开        │ ┌ 你 · 10:12 ─────────────────────┐ │ 1 通过       │
│  ▾ 目标:T5 对等      │ │ 我想本地完成多子任务协作        │ │ 2 运行中     │
│    ✓ T1 路由兜底     │ └──────────────────────────────────┘ │ 3 等你       │
│    ⣾ T2 worktree     │                                      │              │
│    ✋ T3 验收回流     │ ── 进展 ─────────────────────────── │ worktree     │
│      ↳ 修复:T3       │ ✓ 已创建 3 个子会话                 │ branch       │
│                      │ ✓ T1 路由兜底验收通过               │ local/t5...  │
│                      │ ⣾ T2 worktree diff 正在生成         │ diff         │
│                      │ ✋ T3 等 product-manager 验收        │ t5.patch     │
│                      │                                      │ [回流 diff]  │
│                      ├──────────────────────────────────────┤              │
│                      │ [ 输入本地对话消息，例如 @dev ... ][发送]│          │
└──────────────────────┴──────────────────────────────────────┴──────────────┘
```

Requirements:
- Sidebar renders project -> parent session -> child session tree.
- Child sessions show compact status only; parent progress events provide the scan path.
- Repair sessions are visibly nested under the failed child.
- Worktree diff actions live in the right details panel, not inside nested cards.

### Acceptance card submitted through local protocol

```text
┌ 轮到你了 · product-manager 请你验收 ──────────────────────────┐
│ 改了什么: 子会话 T3 修复完成                                 │
│ 已自测:   t5-evidence.json 记录 6 条验收全部通过              │
│                                                              │
│ 1. 子会话树正确渲染                         [通过] [不通过] │
│    证据: artifact/t5-tree.png                                │
│ 2. 验收走查回流到父会话                     [通过] [不通过] │
│    证据: parent integration event                            │
│                                                              │
│ 依据:[______________________________]                        │
│        [提交验收结果]      [先不验,回复别的]                 │
└──────────────────────────────────────────────────────────────┘
```

Requirements:
- Submit generates strict walkthrough text, one line per acceptance statement plus `验收结论`.
- The user can still reply manually, but the default path is protocol-correct.

### Dead-letter and recovery

```text
┌ 系统 · dead-letter ──────────────────────────────────────────┐
│ 本地处理连续失败 5 次: workspace-diff-apply-timeout          │
│ 追加新消息可恢复；原失败消息不会自动重复执行。               │
└──────────────────────────────────────────────────────────────┘

[ 输入本地对话消息，例如 @dev 继续处理 T2 ... ][发送]
```

Requirements:
- Dead-letter is visible, neutral, and does not contain a legal agent mention.
- Recovery is represented by a new timeline message, not by hidden background retry.

## flow.md delta

```text
本地多子任务目标
  user message
    -> local no-mention CEO route or explicit mention
    -> CEO goal-intake / child-session spawn
    -> parent session progress event
    -> child sessions drain independently
    -> acceptance pre-pass records child pass facts
    -> all child passed triggers parent integration request
    -> integration fail creates/recovers repair child session
    -> integration pass updates parent goal state

worktree diff 回流
  dev run in temporary worktree branch
    -> code-verified
    -> generate patch + affected files summary
    -> user clicks 回流 diff
    -> bounded apply into original folder
    -> visible success or visible local error
```
