# desktop-shell 规格增量：托管运行项退出与残留清理

## 新增：托管运行项进入统一退出保护

Source: docs/product/pages/main-left-sidebar.md#底部应用操作
Source: docs/product/pages/main-left-sidebar.md#验收标准

Desktop MUST 把 local-console supervisor 的 active managed-process count 纳入普通退出与安装更新共用的单次 running-task snapshot。有 managed process 时普通退出 MUST 使用既有退出保护；用户取消 MUST 保持应用和全部运行项不变，用户确认 MUST 等待全部 managed groups 被停止和 reap 后才允许 `app.quit` 或 `quitAndInstall`。

Desktop MUST 继续让 Agent graceful resume、managed-process stop、AI builder/CLI installer cancel、local console close 与 state worker close 共享唯一 termination intent 和 cleanup promise。managed-process cleanup reject 或超时 MUST 使安全收尾失败，应用保持打开并显示 cleanup blocked；后续 Electron `before-quit`、window close 与 `window-all-closed` MUST NOT 启动第二套清理或绕过失败。

### Scenario: 有运行项时取消退出

- **GIVEN** 真实 Desktop 有一个 ready managed process 且没有其他运行任务
- **WHEN** 用户执行 Command + Q 并选择留在应用
- **THEN** Desktop 保持运行
- **AND** managed process、PID/PGID 与 endpoint 保持可用
- **AND** quit 调用次数为零。

### Scenario: 确认退出先回收全部运行项

- **GIVEN** 真实 Desktop 有多个 managed process
- **WHEN** 用户确认停止任务并退出
- **THEN** 每个 process group 在应用退出前进入 exited 并被 reap
- **AND** 所有 endpoint 端口关闭
- **AND** 最终 quit 恰好调用一次
- **AND** 不需要第二次 Command + Q。

### Scenario: 运行项清理失败阻断退出

- **GIVEN** 一个 managed process group 在总清理 deadline 内无法确认退出
- **WHEN** 用户确认普通退出或重启安装
- **THEN** Desktop 不调用 quit 或 quitAndInstall
- **AND** 显示 cleanup blocked
- **AND** 同一 termination intent 不重复弹确认或并发执行第二套 stop。

## 新增：Desktop 启动先清理残留且不自动重启

Source: docs/product/pages/main-conversation.md#退出应用与恢复执行

Desktop MUST 在 local console 对 renderer 发布 running URL 之前完成 managed-process ownership-manifest reconciliation。reconciliation MUST 只清理 HMAC manifest 验证通过并由精确 `launchd` service target 证明归属的残留 job，MUST NOT 使用裸 PID/PGID、同名 executable 或端口猜测，MUST NOT bootstrap/kickstart 或执行旧 start payload，MUST NOT 恢复旧 registry、endpoint 或日志。每个 manifest MUST 独立处理；无法证明归属、plist 缺失或精确清理失败的条目 MUST 保留并记录 cleanup blocked，不得误杀其目标，也不得阻止其他有效项清理或把应用永久锁在启动失败。local console 可在 reconciliation 完成后以空 registry 发布 ready，但 MUST NOT 把 blocked 条目宣称为受托管 running 状态。

### Scenario: 崩溃后启动只清理

- **GIVEN** 上次 Desktop 异常终止留下一个 HMAC 有效 ownership manifest、对应 launchd service 和仍监听的端口
- **WHEN** Desktop 再次启动
- **THEN** renderer 获得 local console URL 前旧组与端口已消失
- **AND** 旧命令执行计数没有增加
- **AND** 新会话运行项列表为空。

### Scenario: 无法证明 service 归属时不误杀

- **GIVEN** manifest HMAC/label/digest 与实际 service identity 冲突且存在一个无关同名进程
- **WHEN** Desktop 启动 reconciliation
- **THEN** 无关进程保持存活
- **AND** local console 记录 cleanup blocked，继续清理其他有效 manifest 并可完成启动
- **AND** 没有向任何裸 PID/PGID 发信号
- **AND** 不发布虚假的 running 状态。

## 新增：项目与会话移除先处理托管运行项

Source: docs/product/pages/main-left-sidebar.md#归档
Source: docs/product/pages/main-left-sidebar.md#移除项目

Desktop renderer orchestration MUST 把目标根会话及分析后代的 active managed process 纳入归档与项目移除保护。普通归档 MUST 在存在运行项时禁用并给出可操作原因；强制移除项目 MUST 先停止范围内全部 Agent run 与 managed process，再放弃待接回结果并提交归档/移除。任一 stop 失败 MUST 保留项目、会话、面板、标签和运行项可见现场，MUST NOT 执行后续 mutation。

### Scenario: 活动运行项阻止普通归档

- **GIVEN** 当前根会话或分析后代有 active managed process
- **WHEN** 用户打开归档菜单
- **THEN** 归档不可执行并说明需要先停止运行项
- **AND** 进程和会话保持不变。

### Scenario: 强制移除先停止运行项

- **GIVEN** 项目移除范围同时有 Agent run、managed process 和待接回结果
- **WHEN** 用户确认强制移除
- **THEN** Desktop 先等待 Agent run 与 managed process 全部停止
- **AND** 再放弃待接回并提交项目移除
- **AND** managed-process stop 失败时后两步均不发生。
