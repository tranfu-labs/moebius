# 设计：fix-onboarding-ai-builder-feedback-layout

## 方案

### 即时用户消息

`TeamBuilderView` 在本地保存当前在途消息的正文与提交前 `state.messages.length`：

- 提交开始时清空 textarea、锁定输入，并立即在对话末尾渲染右侧用户气泡。
- 若父级状态的消息数量已经超过提交前数量，说明服务端公开状态已包含本轮消息，本地气泡停止渲染。
- callback 完成后清理本地在途投影；成功、业务失败或 transport 失败继续使用父级状态与既有错误 UI。

临时投影只解决 renderer 反馈时序，不进入 IPC DTO、草稿文件或 Codex prompt。

### 响应式工作区

`OnboardingShell` 保持普通步骤 `max-w-lg`，仅在 `step === 2 && teamBuilderOpen` 时切换为 `max-w-[780px]`。`TeamBuilderView` 使用 `min(720px, calc(100dvh - 220px))` 的目标高度与既有 460px 最小高度：

- 大窗口获得更宽、更高的阅读区。
- 中等窗口按 viewport 缩小。
- 极窄或极矮窗口沿用外层引导主体滚动，不引入横向溢出。

### 提案完整占位

`TeamProposalCard` 根节点增加 `shrink-0`。提案继续使用 `overflow-hidden` 保持圆角裁边，但卡片高度由全部内容决定；唯一滚动容器仍是 `TeamBuilderView` 的 thread 区。

## 权衡

- 不改 AI 建队 IPC 为“先返回 running、后台再推送结果”。那会引入订阅、过期响应与生命周期协议，远超即时视觉反馈所需范围。
- 不把提案卡改成内部滚动。嵌套滚动会让成员与接力关系难以连续阅读，也会增加键盘和触控板操作负担。
- 不让所有 onboarding 步骤永久变宽。环境、团队选择、接力和完成页仍适合聚焦窄栏；只有对话型设计器需要更大工作区。

## 风险

- 父状态可能在 callback 完成前先包含服务端消息；用提交前消息数作为锚点可避免短暂重复。
- 同文本连续提交不能依赖正文比较去重，因此使用消息位置而不是文本值。
- 设计器高度增加可能在矮窗口超过内容区；既有外层 `overflow-y-auto` 与 460px 最小高度提供确定性降级。

回滚时可分别移除本地临时消息、打开态宽度例外和 `shrink-0`，不影响持久化数据。
