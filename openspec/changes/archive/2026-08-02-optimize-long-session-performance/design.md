# 设计：optimize-long-session-performance

> 本设计是对已落地实现的诚实回溯，描述职责边界和验证方式，不把实现前后顺序改写成流程历史。

## 方案

### 1. 条件状态刷新

服务端以完整状态快照计算 ETag。客户端把当前选择对应的 ETag 保存在刷新通道中，并在下一次轮询发送 `If-None-Match`：

- 快照未变：服务端返回 304 和零响应体，客户端保留现有状态，不提交新的 React state。
- 快照已变：服务端返回 200 和完整状态，客户端更新 ETag 并提交新状态。
- 活动运行的 `elapsedMs`、`liveMarkdown`、活动摘要、失败、选择或终态发生变化时，快照必然变化，不能命中 unchanged 短路。
- 请求失败时沿用原错误和选择回滚语义；条件请求只减少重复传输，不改变错误恢复边界。

服务端职责位于 `src/local-console/server.ts`，桌面刷新决策位于 `desktop/src/console-page/refresh-console-state.ts`，同步调度位于 `desktop/src/console-page/use-console-state-sync.ts`。这样把“快照是否相同”的判断留在状态接口，把“是否提交 UI 状态”的判断留在客户端适配层。

### 2. 主时间线窗口化

窗口化只改变 DOM 挂载集合，不改变逻辑消息集合：

- API 的 143 条公开消息保持完整，68 条内部 `local-worker-run` placeholder 仍只存在于 store 侧，不能进入消息投影、目录轨或 DOM。
- 根据滚动容器视口和已测量的真实消息高度计算前后缓冲区；Markdown 高度变化后重新测量并修正窗口。
- 首条、末条和中段阅读都使用同一套布局状态；Relay 先确保目标消息进入窗口，再执行精确定位，定位失败保留原位置。
- 从其他会话返回时恢复保存的阅读 message id；用户在中段阅读时新消息不强制跳底，用户已经在末尾时继续跟随最新消息。

主要实现位于 `packages/console-ui/src/console/operator-console.tsx`，可复用的纯布局与定位规则位于 `packages/console-ui/src/console/conversation-layout.ts`。纯逻辑测试覆盖窗口计算、未挂载定位和非末尾恢复，真实 Electron 负责验证浏览器实际滚动、动态高度和 DOM 结果。

### 3. 导航失败的完整现场恢复

性能改动触及切换时序后，失败路径必须有一个完整现场快照，而不是分别让多个 store 自行猜测回退。导航入口捕获：

- selection 与 presentation route；
- 右栏开合、visibility preference、host session；
- tabs 文档与 active tab；
- 主内容草稿和阅读位置。

普通、搜索和 hosted 分析入口统一经过场景捕获。目标请求失败或过期时调用整体恢复；成功时只提交一次目标现场，不先恢复再提交成功目标。该职责由 `desktop/src/console-page/use-console-navigation-scene.ts`、`desktop/src/console-page/console-state-plan.ts` 和相关导航 hook 协同完成。

### 4. 诊断与证据边界

性能 Profiler 只在 URL 显式带有 `moebius-timeline-perf=1` 时挂载，正常运行不创建 `window.__MOEBIUS_TIMELINE_PERF__` 或其他公开探针。验收证据只保留计数、枚举、耗时、结果布尔值和脱敏标识，不保留用户正文、会话对象、会话 id 或本机绝对路径。

## 权衡

### 选择 ETag/304，而不是只在 React 层 memo

React memo 只能减少部分渲染，不能消除每秒完整状态的网络传输和上层 state 提交。ETag 在服务端和客户端之间先消除不变快照，变化时仍保留原有完整状态语义。

### 选择 DOM 窗口化，而不是只增加 memo

长会话的主要可见成本是约一万级 DOM 节点及其布局，不是单个消息组件的引用变化。窗口化直接降低挂载、布局和 commit 的规模，同时保留完整逻辑列表和定位能力。

### 本轮否决增量投影缓存

样本的 store 热读约 1 ms，且绝大多数事件不会产生公开消息更新；缓存失效、跨轮询一致性和活动运行边界的复杂度高于当前可证明收益。若后续基线显示 store 投影成为新瓶颈，再单独形成 change，不把未经测量的缓存预先混入本轮。

### 为什么需要真实 Electron

层内单元和 App 测试分别验证 ETag 决策、错误状态、窗口算法和失败回滚；但以下信号只有真实 Chromium/Electron 才存在：

- `304` 的真实请求/响应体积；
- 动态 Markdown 高度、滚动锚点和未挂载消息的实际定位；
- DOM mutation、React commit 和页面点击到稳定可交互的时序；
- 多个 store、路由、preload/renderer 和真实页面之间的接缝。

因此真机验收不是替代分层测试，也不是泛测架构，而是只覆盖 mock 无法观察的跨层契约。分层测试仍是发现局部错误的第一道门。

## 风险与回滚

- ETag 判断错误可能漏掉活动变化；以活动运行定向测试和真实页面状态字段变化作为护栏，任何快照变化都必须回到 200。
- 动态高度估计错误可能造成跳动或错误 Relay；布局纯逻辑测试加首尾、中段、未挂载目标和八类动态高度的真实页面验收覆盖。
- 窗口化可能误删用户现场；逻辑消息列表、阅读位置、草稿、运行状态和失败现场都不依赖 DOM 是否挂载，失败切换另有完整场景回滚。
- 若回归需要收缩范围，可先关闭窗口化并保留完整 DOM，再独立回滚条件刷新；两项机制职责分离，不需要改写会话事实。
