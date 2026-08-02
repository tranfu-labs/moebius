# Console Page Wireframe

> 本文是历史线框参考；新对话入口、页面态、首发创建和草稿行为已由
> `docs/product/pages/main-conversation.md` 接管。与该页面 PRD 冲突时，以页面 PRD 为准。

The console page is the Electron desktop shell's default main window. It is a local operator console backed by the local console server and SQLite. The auxiliary status page remains available for local environment and update diagnostics; the former GitHub-state observer has been retired.

## Running

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  Moebius                                                               │
├──────────────────┬───────────────────────────────────────────────────────────┤
│ ▱ 打开项目        │  你 · 14:02                                               │
│                  │  @dev 帮我验证本地操作台                                  │
│ 项目             │  ──────────────────────────────────────────────────────   │
│ ▱ moebius ＋│  开发 · 正在执行 00:43                         [中断]     │
│   本地 T4 验收   │  running tests...                                         │
│   裂变会话 A     │                                                           │
│   裂变会话 B     │                                                           │
│   失败构造验证   │                                                           │
│   卡住状态验证   │                                                           │
│   空白会话       │                                                           │
│ ▱ demo-project  ＋│                                                           │
│   设计讨论       │                                                           │
│                  │        ┌──────────────────────────────────────┐           │
│                  │        │ moebius  本地  当前分支       │           │
│                  │        ├──────────────────────────────────────┤           │
│ 开发者诊断       │        │ 当前 agent 正在执行…             ↑ │           │
│ 本地引擎运行中   │        └──────────────────────────────────────┘           │
└──────────────────┴───────────────────────────────────────────────────────────┘
```

Requirements:
- The macOS titlebar integrates traffic-light controls with the left rail; Windows/Linux retain native controls.
- The rail renders every persisted project using its real folder title and groups each session under its owning project.
- Each project row owns its `＋` action; there is no ambiguous global new-session action.
- `打开项目` delegates folder selection to the desktop shell and project persistence to the loopback local console API.
- All sessions remain peer rows even when runtime lineage contains `parentSessionId`; no tree connector, indentation, parent breadcrumb, or child count is shown.
- A renderer refresh restores the same flat list and selected session; corrupt lineage cannot duplicate or hide a session.
- The single timeline mixes user, localized agent, and readable system records in chronological order.
- The active run row always displays a non-empty summary, elapsed time, and an interrupt action.
- Project path, SQLite path, runDir, cwd, internal ids, raw output, and worktree diagnostics do not appear on the default surface.
- Workspace mode moves to the composer context row and keeps the existing direct/worktree mutation semantics.
- Tail-read timeout, missing files, or unparseable output display a deterministic human summary, never a blank running row.

## Empty Session Project Selection

```text
┌────────────────────┬───────────────────────────────────────────────────────┐
│ ▱ 打开项目          │                                                       │
│                    │                                                       │
│ 项目               │                    空白新会话                         │
│ ▱ moebius  ＋ │                                                       │
│   新会话            │                                                       │
│   本地 T4 验收      │                                                       │
│ ▱ demo-project   ＋ │       ┌──────────────────────────────────────┐        │
│   设计讨论          │       │ [▱ moebius⌄] [本地] [当前分支] │        │
│                    │       │ 描述你的目标…                    ↑  │        │
│                    │       └──────────────────────────────────────┘        │
└────────────────────┴───────────────────────────────────────────────────────┘
```

Project menu expanded:

```text
                              ┌────────────────────────┐
                              │ ✓ moebius        │
                              │   demo-project         │
                              └────────────────────────┘
       ┌──────────────────────────────────────────────┐
       │ [▱ moebius⌃] [本地] [当前分支]         │
       │ 未发送的输入草稿                         ↑  │
       └──────────────────────────────────────────────┘
```

Locked after history or orchestration relationship:

```text
       ┌──────────────────────────────────────────────┐
       │ ▱ moebius  [本地] [当前分支]           │
       │ 描述你的目标…                            ↑  │
       └──────────────────────────────────────────────┘
```

Requirements:
- Activating a project row's `＋` creates and selects an empty session under that exact project.
- An empty session with no run or parent/child relationship exposes an accessible project menu in the composer context.
- Selecting another project keeps the same session selected and preserves its draft while moving it to the target project group.
- During create/open/rebind, all selection-changing entry points are disabled and handler-guarded; rebind additionally disables first-message submission.
- A session with messages, an active run, or parent/child relationships keeps its project visible as locked text without a menu.

## Interrupted

```text
┌ 开发 · 已中断 · 14:03 ───────────────────────────────┐
│ 用户已中断本轮运行。                                │
│ runDir: /tmp/moebius-local-...                 │
│ 状态: interrupted                                    │
└──────────────────────────────────────────────────────┘

[ 输入消息，选择一个角色交棒... ][发送]
发消息会开启新一轮运行。
```

Requirements:
- Interruption is a neutral fact, not an error failure.
- The composer becomes usable again after interruption.

## Failed

```text
┌ 系统 · 本地错误 · 14:08 ─────────────────────────────┐
│ Codex 运行失败: exit-code-1                          │
│ runDir: /tmp/moebius-local-...                 │
│ stderr: fake codex failed for acceptance             │
└──────────────────────────────────────────────────────┘
```

Requirements:
- Failures appear in the timeline as local system records and remain visible after refresh.
- Fake Codex non-zero exit and spawn errors use the failed path; user interruption does not.

## Stuck

```text
┌ 系统 · 运行卡住 · 14:12 ─────────────────────────────┐
│ Codex 运行卡住: idle-timeout:300000ms                │
│ runDir: /tmp/moebius-local-...                 │
│ 状态: stuck                                          │
└──────────────────────────────────────────────────────┘
```

Requirements:
- Stuck is distinct from failed and interrupted.
- Timeout and stale-running repair records keep reason and runDir visible after refresh or window restart.

## Diagnostics

```text
[诊断]
  打开状态页
  打开数据目录
```

Requirements:
- The status page is reachable as a diagnostic surface, but the operator console is the default main window.

## Retired Read-only Observer Reference

The following sketches are retained only as historical wireframe reference. The observer command, server, navigation entry, and GitHub-state presentation were removed with the GitHub runner and are not reachable product behavior.

Desktop:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Moebius Observer                                      read on load   │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ Goals                        │ Diagnostics                                 │
│                              │  goal-ledger.json          ok               │
│  M3 orchestration            │  run-manifests.jsonl       partial          │
│   active · waiting gates 2   │   line 8 skipped: invalid JSON              │
│                              │  filtered ledger goals     1 not watched    │
│  filtered goals 1 not watched│                                             │
│  Unlinked local runs 3       │ Goal ledger tree                            │
│                              │  Goal M3 orchestration                       │
│ Legacy issue records         │   quality data-correct                       │
│  tranfu-labs/moebius   │   active phase: Build observable orchestration│
│   issue 75 latest plan       │   gate waiting product-manager integration  │
│                              │    basis integration event requested         │
│                              │    next tranfu-labs/moebius issue 75  │
│                              │                                             │
│                              │   Milestone orchestration runtime            │
│                              │    active phase: child execution             │
│                              │    pending/completed phases                  │
│                              │    Task T7 observer ledger UI                │
│                              │     readiness ready · baseline data-correct  │
│                              │     deps T1,T2,T4,T6                         │
│                              │     child issue 81 open                      │
│                              │     latest acceptance failed by qa           │
│                              │     run evidence .state/run-manifests line 12│
│                              │                                             │
│                              │   未归属里程碑任务                           │
│                              │    Task repair follow-up                     │
│                              │     no active phase                          │
│                              │     child issue 83 roundtable child          │
│                              │     other/repo issue 9 not watched/no poll   │
│                              │                                             │
│                              │ Unlinked local runs                          │
│                              │  2026-07-05 dev code-verified issue 70       │
│                              │ Legacy issue/run records                     │
│                              │  issue 75 intake active, role threads, runs  │
└──────────────────────────────┴─────────────────────────────────────────────┘
```

Ledger read failure fallback:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Moebius Observer                                      read on load   │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ Goals                        │ Diagnostics                                 │
│  ledger unavailable          │  goal-ledger.json          error            │
│                              │   unsupported schemaVersion                 │
│ Legacy issue records         │                                             │
│  tranfu-labs/moebius   │ Goal ledger tree                            │
│   issue 75 latest run        │  账本读取失败，树视图暂不可用。             │
│                              │                                             │
│                              │ Legacy issue/run records                    │
│                              │  issue 75 intake active                     │
│                              │  runs                                       │
│                              │   published artifact link                   │
└──────────────────────────────┴─────────────────────────────────────────────┘
```

Mobile / narrow viewport:

```text
┌────────────────────────────────────┐
│ Moebius Observer             │
│ read on load                       │
├────────────────────────────────────┤
│ Diagnostics                        │
│ goal-ledger.json ok                │
│ filtered goals 1 not watched       │
├────────────────────────────────────┤
│ Goals                              │
│ M3 orchestration active            │
│ waiting gates 2                    │
├────────────────────────────────────┤
│ Goal M3 orchestration              │
│ gate waiting product-manager       │
│ next issue tranfu-labs/... issue 75│
│ Milestone orchestration runtime    │
│  Task T7 observer ledger UI        │
│   readiness ready                  │
│   latest acceptance failed by qa   │
│   run evidence jsonl line 12       │
│ 未归属里程碑任务                   │
│  Task repair follow-up             │
│   child issue 83 roundtable child  │
├────────────────────────────────────┤
│ Unlinked local runs                │
│  dev code-verified issue 70        │
├────────────────────────────────────┤
│ Legacy issue/run records           │
│  issue 75 intake active            │
└────────────────────────────────────┘
```

Historical requirements below this heading are non-operative and must not be used as acceptance criteria for the current application.

## Codex-native Stream Anchor

```text
┌────────────────────┬─────────────────────────────────────────────────────────┐
│ 项目 / 会话列表    │ 官网落地页验收                                          │
│ ◐ 本地 T6 验收     │ 项目 moebius   工作区 隔离   模式 本地            │
│ ○ 截图走查         │ ─────────────────────────────────────────────────────  │
│ ○ 失败构造         │ (开) 开发  方案已写好                       ○ 09:41    │
│                    │ 　  落地页采用单文件自包含结构，不引入构建步骤。        │
│                    │ 　  → 交给「测试」按验收语句审查方案                    │
│                    │ ─────────────────────────────────────────────────────  │
│                    │ (测) 测试  进行中                           ○ 09:44    │
│                    │ 　  方案可测性良好，建议补充空状态验收语句。            │
│                    │ 　  → 交给「开发」补充验收语句                          │
│                    │ ─────────────────────────────────────────────────────  │
│                    │ (产) 产品  代码已验证                       ● 10:02    │
│                    │ 　  三条验收语句全部通过，可进入发布流程。              │
│                    │ 　  → 等你确认发布                                    │
│                    │                                                         │
│                    │      [moebius] [本地] [当前分支]                  │
│                    │      [描述目标，@ 一个角色…                        ↑] │
└────────────────────┴─────────────────────────────────────────────────────────┘
```

Requirements:
- The timeline is a flat chronological stream of hairline-separated Linear-inbox-style rows rather than a stack of floating Card surfaces.
- Each agent row uses a circular localized role avatar with a stage corner badge; the first line holds the role name, inline state metadata, a right-aligned status icon, and a tabular-nums timestamp; conclusion and arrow-prefixed handoff follow as secondary lines.
- The session context header is a property-panel strip (12px muted label above a 13px icon-prefixed value) carrying only project, workspace, and mode facts.
- Waiting and pending remain neutral structural facts; failed and stuck use danger fact text; interrupted stays neutral and distinct from failure.
- Raw output, runDir, cwd, SQLite paths, and internal ids remain in developer diagnostics rather than expandable timeline details.
- The composer is the only floating surface and owns project/workspace context.
- Sidebar project/session rows remain compact navigation controls and all sessions keep the same indentation.

## Status Semantics and Typography

```text
运行态：  ● 运行中(靛蓝)   ◌ 等你(中性空心)   ◌ 排队中(中性空心)
          ● 失败(红)       ● 卡住(红)         ○ 已中断(中性)
          ● 已完成(中性)   ● 已显示(中性)     ○ 空闲(中性)
裁决面：  ● 通过(绿)       ● 不通过(红)
主按钮：  靛蓝 #5E6AD2；hover 亮色加深 #4B57C8 / 暗色变亮 #828FFF；active scale(0.98)
浮层：    细描边 + 多层软投影；focus 为双层靛蓝 ring
```

Requirements:
- Badge's nine runtime status variants (running/failed/waiting/interrupted/idle/pending/completed/displayed/stuck) all render as dot-plus-text markers; semantic variant names and the component API stay unchanged.
- Green/red hues appear only on acceptance verdicts and danger facts; waiting, pending, and interrupted states stay neutral structural signals.
- Sidebar session status dots share the Badge status semantics; the four-tier sidebar ordering is behavior, not visual language.
- Icons are lucide at 16px default size with 1.5px stroke width.
- Latin text uses the self-hosted Inter Variable subset (wght 510 for UI emphasis, 590 for titles, `cv01`/`ss03` features); CJK falls back to system fonts; body text below 16px uses zero letter-spacing.
- Detailed token, elevation, and motion rules live in `packages/console-ui/DESIGN.md` as the design language fact source.
