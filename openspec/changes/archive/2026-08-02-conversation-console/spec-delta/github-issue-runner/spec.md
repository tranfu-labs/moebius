# github-issue-runner spec delta：conversation-console

## 移除（对话操作台实施归档时生效）
- 移除观察页呈现类规格：「本地只读观察页」小节中关于页面渲染内容与形态的条目（ledger 树视图、诊断展示、legacy issue/run 区、unlinked runs、`pnpm observer` 呈现行为），以及场景 60、61——呈现职责整体移交新业务域 `local-console`。

## 保持不动（本 delta 不修改）
- observer 进程独立于 runner、runner MUST NOT 依赖 `src/observer/`、只读红线（不写 `.state`、不调 GitHub / Codex / artifact publisher）等架构与边界条目本次不动：本 change 零行为变化，这些红线在对话操作台下的取舍（操作台必然引入写通道）由后续对接设计 change 的 delta 显式裁决。
