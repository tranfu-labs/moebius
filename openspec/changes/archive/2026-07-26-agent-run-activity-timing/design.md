# 设计：agent-run-activity-timing

## 方案

### 1. 运行事实与计时

每个 run 以 `run_lifecycle` 事实记录 `created / started / paused / resumed / terminal` 变化。运行中的内存投影保存：

- `createdAt`：run 已被认领并完成排队的时刻；
- `startedAt`：执行适配器确认外部进程或传输已启动的时刻，可为空；
- `accumulatedMs` 与当前执行段起点；
- `completedAt` 与终态；
- `stepId / attempt`：同一步的稳定聚合键和尝试序号；
- `engine` 与过程记录能力。

首版现有恢复机制仍可能创建新的 Moebius run；本 change 不反向扩大恢复协议。新 UI 与事实模型允许同一 run 的多执行段累计，但只有既有恢复路径明确复用同一 run 时才使用。

### 2. 最新活动投影

执行适配器新增结构化事件回调。纯函数 projector 把事件清洗为：

```text
{ cursor, phase, kind, action, object }
```

`cursor` 由当前 run 内的递增序号产生。runtime 只接受大于或等于当前游标的事件；同游标按工具/命令、文件、Agent 进度优先级裁决。完成事件会成为新的当前活动并保持，直到更晚事件替换，绝不回看未完成事件栈。

安全对象只保留命令程序与最多一个非选项参数、路径 basename、工具显示名或已清洗进度首行；不下发参数全集、输出、绝对路径、cwd、run id 或原始协议类型。

### 3. DTO 与展示

`activeRuns` 增加结构化 `activity`、`engine`、`processOutputAvailable`、`startedAt|null`、`elapsedMs|null`、`stepId` 和 `attempt`。排队/未启动时 `elapsedMs=null`。

消息 DTO 通过 JSONL lifecycle facts 按 `runId` 装饰 `runTiming`，终态组件只在 `startedAt` 存在时显示「耗时」。Agent 成功消息与系统异常事实都复用同一时间组件；完成时刻不作为裸文本常驻。

RunBlock 保持一条记录原地更新，角色行右侧显示 `已进行 mm:ss|h:mm:ss`，下一行显示安全活动。专业成员的停止动作留在记录上；主 Agent 仍只由 composer 停止。

### 4. 步骤与尝试

初次 run 的 `stepId` 使用原始 source message id；用户重试沿用原 `stepId` 并增加 attempt；改一改重发产生新 message id，因此产生新 step。过程读取先按 lifecycle 的 stepId 分组，旧会话无 lifecycle 时回退现有 source message id 分组。

过程标签的尝试头显示：

- 运行中：`第 N 次 · 已进行 01:24`
- 已终止且启动过：`第 N 次 · 耗时 01:24`
- 未启动：`第 N 次 · 未开始`

完成时刻通过同一个可访问时间组件提供。单次 rollout 缺失只让该次尝试显示不可用，不使整个步骤不可用；本 change 先实现尝试元数据与聚合键，既有分页读取继续保持兼容。

### 5. CLI 能力

Codex run 在建立 thread link 后具备完整输出入口。Kimi 仍投影活动和计时，但 `processOutputAvailable=false`，时间线原位显示不可用说明，不创建无去向标签。

## 测试设计

### 单元测试

- 时长边界：0、59:59、1:00:00、超过 24 小时。
- 时间完成格式：今天、本年内非今天、跨年；可访问文本与视觉文本一致。
- Codex 命令、搜索、读取、修改、工具开始/完成事件投影与脱敏。
- 并发工具完成后活动游标不回退。
- 未启动失败没有 `00:00`，已启动终态只有一次耗时。
- 重试沿用 stepId、attempt 递增；改一改重发产生新 step。
- Kimi 活动可见但完整输出不可点击。
- 多 Agent active run 的时钟、活动和停止目标互不覆盖。

### AI 验证

- 用原型/Storybook 状态与真实 Electron 本地数据分别检查运行、完成、停下、失败、多成员并行。
- 通过 DOM 文本断言确认明暗主题、窄窗、键盘、reduced-motion 与无绝对路径泄露；仅在文本断言无法覆盖布局时截图落盘。
- 跑定向 Vitest、全量测试、类型检查与桌面构建。

## 权衡

- 不显示百分比，避免不可验证的进度承诺。
- 不循环轮播历史活动；用户看到的是最后一个真实事件，而非制造的动感。
- 不把 rollout 全量过程复制进 session JSONL；只记录有界、安全的最新活动事实。
- 首版不新增自动重试、卡住机器判据、排队取消、时区重排和文件副作用回滚。

## 风险

- Codex/Kimi 协议事件可能新增类型；未知事件不得泄露原始内容，回退为中性活动或只进入完整输出。
- 生命周期事实写入失败不能阻断 Agent 最终回复；API 应降级为无计时，而不是伪造时间。
- 旧会话缺少 lifecycle/step 事实；读取必须回退既有 source message 与 thread link，不做破坏性迁移。
