# 设计：fix-conversation-draft-switch-race

## 现状与失败时序

现有普通会话切换的关键时序是：

1. sidebar click 立即读取目标 session 的持久草稿并调用 `setComposerValue`；
2. `transitionSessionView(previous, next)` 依次等待旧会话 `arm-manual-unread` 与目标会话 `viewed`；
3. promise `finally` 才调用 `actions.selectSession(next)`，更新 `selectionRef` 并刷新页面；
4. composer `onChange` 在第 3 步前仍用 `selectionRef.current.sessionId` 写草稿；
5. selection effect 在第 3 步后再次读取目标 draft key 并覆盖 composer。

因此脚本的 `click → fill` 会把正文写入旧 key，而第 5 步把目标输入框重置为空。阅读状态 mutation 的网络时延越大，窗口越明显；mutation 失败也不改变结论，因为 `transitionSessionView` 捕获错误后仍会进入 `finally`。

## 方案

### 1. 先建立纯草稿归属状态机

在 `desktop/src/console-page/` 的草稿纯模块中定义主 composer 状态：

```ts
interface ConversationComposerDraftState {
  key: ConversationDraftKey;
  value: string;
}
```

状态转换只接受普通数据，不读取 storage，也不调用 React：

- `activate(key, persistedValue)`：key 不同时切到目标并采用其持久值；key 相同时保留当前内存值，阻止迟到 effect 用旧值覆盖新输入。
- `edit(value)`：只修改 value，保持 owner key。
- `clear(key)`：只在清理目标等于当前 owner 时清空可见值；其他会话发送完成不能清空当前 composer。

第一笔实现提交只加入纯逻辑及单元测试，不接入页面：草稿 owner 测试至少覆盖 A→B 后立即编辑写入 B、同一 B 的迟到 activate 不覆盖编辑、非当前会话 clear 不清 B；session-view transition queue 测试用 deferred task 证明第二组不会在第一组前完成、失败后后续任务仍继续、pending generation 只由最新请求落定。这样先冻结草稿归属和未读顺序规则，再改变页面行为。

### 2. renderer 只通过显式 owner 读写草稿

`app.tsx` 用上述状态替代裸 `composerValue`，并保留同步 ref 供同一个离散事件周期内的回调读取。页面投影仍向 `console-ui` 传字符串；组件库只接收一个 host 已经算好的 submission-block reason，复用 `RoleComposer` 既有 `submitDisabled` 能力，不解释 owner 或未读状态。

- composer change 先读取 owner key，再把正文写入该 key 并提交 `edit`。
- `currentAttachmentDraftKey` 在普通已有会话中取同一个 owner key；正文与附件不能分别跟随不同 selection。
- 成功发送、edit-resend、retry 和其他既有草稿清理入口显式携带目标 key；只有当前 owner 被清理时才清空可见输入。
- selection effect 只做 `activate`。owner 已经是目标时保留内存编辑；owner 不同时才读取目标持久草稿。
- 发送前校验 owner 对应的 session 与 `selectionRef` 一致，并校验当前阅读状态 transition 已经落定；任一不满足都不发请求，防止内容进入错误会话或越过既有“成功切换后才可发送”的边界。
- submission guard 只返回 `transition-pending | owner-mismatch | null` 语义码，由 host 翻译成可读说明。正常 transition 在途时 textarea 与附件入口保持可用，发送按钮单独禁用，composer 说明“正在切换对话，草稿已保留，完成后即可发送”；owner 与 selection 在非 transition 状态下意外不一致时，发送仍禁用并说明“草稿归属尚未同步，请重新选择对话”。若旧闭包、Enter 或其他入口仍调用 handler，handler 设置同一语义的可读错误并保留正文与附件，不能静默 return。

### 3. 会话点击同步提交目标，阅读状态按点击顺序串行

普通根会话点击按以下顺序执行：

1. 快照旧 selection；
2. 同步 `activate` 目标 composer owner；
3. 同步调用 `actions.selectSession(nextSelection)`，让 `selectionRef`、页面选择和后续草稿归属立即一致；
4. 把显式 `(previousSessionId, viewedSessionId)` 加入 session-view transition queue；队列严格按点击顺序逐组执行每一组内部的 `arm-manual-unread(previous)` → `viewed(next)`；
5. 从请求入队到该请求及其前序请求落定期间保持 submission block；最后一个当前请求落定后才允许发送。失败沿用既有可读错误，队列继续处理后续请求，不回滚 selection 或草稿 owner。

队列放在稳定 ref 持有的纯编排对象中，不能跟随 `ConsoleStateActions` 因 composer 值变化而重建。它不读取 React、HTTP 或 session 内容，只保证异步任务的 FIFO 与 pending generation；网络 mutation 仍由 `transitionSessionView` 执行。

快速 A→B→A 时，必须执行 `arm(A) → viewed(B) → arm(B) → viewed(A)`，不允许两组 mutation 逆序返回。若 A 是当前会话标记未读、B 是非当前会话标记未读，最终重新显示 A 后 A 与 B 的手动未读都应按既有规则清除，两个静止会话均无蓝点；若其中一次持久化失败，则保留服务端实际未清除的原提醒并显示错误，不能在 renderer 乐观伪造已读。

### 4. sidebar-conversation 分支一起收口，但不混淆两个 composer

`app.tsx` 当前 `target.originSessionId != null && origin !== undefined` 分支同样使用 `transitionSessionView(...).finally(selectSession)`，而主 composer 展示的是 origin 草稿。如果此前主 selection 不是 origin，立即输入也会按旧 selection 写错，因此它属于同一个缺陷，不能以“独立 composer 不在范围”为由略过。

该分支明确按以下映射接入同一编排：

- 主内容 selection 与主 composer owner 同步切到 `origin.sessionId`；右侧栏继续打开 `target.sessionId`，target 的独立 sidebar composer / draft store 保持原实现。
- 阅读状态队列接收 `previousSessionId → target.sessionId`，保持“用户打开的是 target sidebar conversation，因此清 target 自己的未读，不复制到 origin”的既有事实。
- transition pending 期间只阻止主 composer 发送，不禁用输入；右侧栏 target 的独立发送能力不借用主 composer owner。
- 后续普通会话点击与 sidebar-conversation 点击共享同一个 FIFO，旧请求完成不得再通过 `finally` 把主 selection 拉回旧 origin。

分析草稿、已打开 sidebar conversation 自己的正文/附件状态与右侧标签生命周期不做结构调整；本次只改这条入口对主 selection、主 composer owner 和阅读 transition 的编排。

### 5. 脚本等待用户可观察的目标页面信号

`sendFromMainConversation` 点击带目标 `data-session-id` 的侧边栏会话后，等待主内容区 `conversation-title-header` 中出现与目标 session title 精确匹配的 heading，再执行 `fill`。必要时同时核对目标 sidebar 行 `aria-current="page"`。

选择标题而不是固定 sleep：标题来自目标 `selectedSession` 页面状态，能证明主内容区已切换；固定延迟只会把竞态变成负载相关 flaky。脚本等待不用于证明产品能承受极快输入，后者由纯逻辑、renderer 回归测试和真机复核语句单独覆盖。

## 测试设计

### 纯逻辑护栏

扩充现有 `desktop/tests/draft-store.test.ts`，不新增测试文件：

- A 草稿激活 B 后立即编辑，状态 owner 和持久化目标都是 B；
- B 编辑后收到携带空旧值的同 key activate，正文保持不变；
- 清理 A 不影响当前 B，清理 B 才清空 B；
- submission guard 对 transition pending 返回 `transition-pending`，对 owner / selection mismatch 返回 `owner-mismatch`，两者都拒绝提交但不清草稿；测试断言语义码，不冻结具体文案。

断言状态和写入目标，不读取实现源码或复制文案。

扩充现有 `desktop/tests/console-state-sync.test.ts` 覆盖不依赖 UI / HTTP 的 session-view transition queue：

- 单次 A→B 仍严格调用 `arm(A)` 后才调用 `viewed(B)`，冻结既有未读 gate 基线；
- A→B 与 B→A 连续入队时，即使测试先尝试释放第二组 deferred，第二组也不得在第一组结束前开始；
- 第一组失败后第二组仍执行，pending generation 直到最新请求结束才清除，且旧请求结束不能回写当前 selection。

### renderer wiring 回归

复用已有 App 内存 harness，增加一组行为测试而非真实 I/O：

- 把阅读状态 mutation 挂起，点击 B 后立即输入；断言 localStorage 只写 `draft:B`，A 不变；
- 在挂起期间触发正常 state refresh / 父级重渲染，B 输入不被空持久值覆盖；
- transition pending 时 textarea 仍可编辑、发送按钮禁用、页面存在可访问的切换状态说明，点击或 Enter 都不发消息请求；完成后说明消失且发送恢复；
- 强制形成 owner / selection mismatch 时显示可访问的恢复说明，发送 handler fail closed、正文与附件仍在、没有消息请求，不能静默无反馈；renderer 测试断言状态角色、控件能力与副作用，不镜像具体文案；
- 分别让阅读 mutation 成功和失败，目标 selection 与 B 草稿都保持；失败保留服务端实际未清的徽标并显示既有错误反馈，不乐观改成已读；
- A、B 都预置手动未读，快速 A→B→A，并对抗性尝试让第二组 mutation 先返回；断言队列不提前发第二组，最终请求顺序为 `arm(A), viewed(B), arm(B), viewed(A)`，最终 A 被选中且 A/B 两行均无蓝点；
- sidebar-conversation 从非 origin 会话打开时，主 selection / owner 是 origin、右侧栏是 target、阅读 mutation 的 viewed 目标是 target；随后普通切换不能被旧 `finally` 拉回 origin；
- 往返 A/B 后各自恢复自己的草稿。

这组测试覆盖 React 调度、迟到异步返回和重渲染接缝；相关 callback 由 App 内部创建，不存在可由父 props 替换的 callback identity，故不另造无业务意义的身份测试。

### 验收脚本与回归闸门

- 定向：纯草稿测试、承载 renderer 回归的既有 App 测试、`local-console-direct-member-mention.ts`。
- 迭代收口：`pnpm run test --scope a21d4de`（pnpm 9 下不用 `pnpm test --scope`）。
- 静态与构建：`pnpm typecheck`、`pnpm --filter @moebius/desktop build`；仓库尚无 lint 命令，如实记为未配置。
- 交付收尾只运行一次完整 `pnpm test`。

## 真机验收语句

1. **极快切换时草稿不串会话且保护分支可见**：入口为真实 Electron 主对话，准备已有会话 A、B，A 中保留草稿 A；操作为点击 B 后不等待动画或加载提示立即输入草稿 B，并在切换提示仍可见时尝试发送，再在 A/B 间往返并重启应用；屏幕观察必须是输入始终可编辑、切换落定前发送按钮禁用且显示“草稿已保留”的说明、期间没有新增消息，落定后说明消失且发送恢复；A 只恢复草稿 A、B 只恢复草稿 B，B 输入在会话标题完成切换后不消失。环境记录为“真机”，并写明入口、操作、屏幕观察、与承诺一致否。
2. **快速往返后未读徽标仍正确**：入口为无替身的真实 Electron 主侧边栏；先把非当前 B 标记为未读，再把当前 A 标记为未读，操作为快速点击 B 后立刻点回 A；屏幕观察必须是切换请求落定后 A 仍为当前会话，A 与 B 的蓝色未读点都消失，刷新和重启后不重新出现，页面没有被旧请求拉回 B。若任一持久化明确失败，则原蓝点保持并显示可读失败说明，不得伪装成已读。
3. **语句 4：优雅重启保持同 run、同线程 resume**：入口为无 shim、连接真实 local service 与真实 CLI 的 Electron 主对话，session 和两条消息均从 UI 创建；向 qa 发送一条能保持活动到关闭时刻的消息，在该角色仍忙碌时再发第二条，正常关闭并重新打开应用；屏幕观察必须是 qa 的原活动 run 恢复、第二条仍在同角色待发射区，首条结束后第二条继续执行。真实 runtime 证据必须证明重启前后 `runId` 相同、恢复 invocation 为 `resume`、provider external id 与首次 invocation 相同，且没有 full replacement session。`local-console-direct-member-mention.ts` 使用 Codex shim 且通过 API 预置 session，它输出的同 `threadId` evidence 只作为自动化辅助证据，环境必须记录为“替身＋不算数的理由”，不能冒充本条真机记录。

## 权衡

### 采用：显式 owner + 同步 selection + 串行阅读 transition

优点是草稿归属成为可单测状态，不依赖 React effect 恰好何时执行；用户可以在点击后立刻输入；发送目标、正文和附件共享同一 owner；快速多次切换不会被旧 promise 回写；阅读 gate 仍按用户点击顺序持久化。影响面局限于 desktop renderer、一个窄 presentational block reason 和既有脚本，不改 local-console API。

接受的代价是 `app.tsx` 多维护一个带 key 的小状态、同步 ref、稳定 FIFO 和短暂 submission block，并需要迁移现有 `setComposerValue` 调用点。该代价换来的是把隐式时序关系与未读顺序变成显式不变量，且可逐调用点回滚。

### 不采用：只在持久草稿“真的变化”时回写

比较新旧字符串可以减少一次覆盖，但无法判断字符串属于哪个 session；相同正文、空正文和 storage 写失败都会让判定失真，也不能阻止发送使用旧 selection。

### 不采用：切换期间禁用整个输入区

冻结整个 composer 能封住竞态，但会把阅读状态网络时延直接变成用户不可输入时间，且违背“点击目标后自然继续输入”的体验。采用方案只禁用发送并给出可见原因，正文与附件仍归目标 owner；它不是静默冻结。

### 不采用：只把 `actions.selectSession` 提前

同步 selection 能修当前调用链，但草稿仍没有独立 owner；后续 effect、edit-resend 或其他异步入口仍可能重新制造覆盖。它不能满足“草稿归属规则可脱离 UI 单测”的架构约束。

### 不采用：只给验收脚本加等待

脚本会稳定，但真实用户仍可能把草稿写入旧会话，属于用测试绕开产品缺陷。

## 风险

- **调用点迁移遗漏**：edit-resend、retry、发送成功清理或分析会话回跳仍可能直接设置字符串。实现时用 `rg` 清点全部 `setComposerValue` / `conversationDraftStoreRef` 调用，并由 owner 测试覆盖当前与非当前 session 清理。
- **正文与附件 owner 分离**：`currentAttachmentDraftKey` 必须与普通 composer owner 同源；构建和 renderer 测试核对切换期间附件不投影到旧会话。
- **阅读状态时序变化**：selection 不再等待 mutation，但发送仍等待当前队列落定。FIFO 必须跨 `ConsoleStateActions` 重建保持稳定，并测试单次基线、慢成功、失败、A→B→A 与 sidebar-conversation；异常仍沿用既有可读错误，不回滚用户选择或乐观清徽标。
- **发送闭包拿到旧正文**：React 重新渲染前不得允许 owner / selection 不一致或 transition pending 的请求越界；同步 ref、submission block 与 handler 二次校验共同 fail closed，并都提供可见反馈。
- **sidebar-conversation 双重现场**：主内容 owner 是 origin、右侧 viewed 目标是 target；测试必须同时断言两者，避免把 target 草稿投影到主 composer 或把未读清到 origin。
- **回滚**：产品集成可回滚到原裸字符串路径，纯 owner、FIFO 和脚本等待可独立保留；若同步 selection 暴露其他回归，可保留 owner 与 FIFO，在 transition 落定前继续只禁用发送而不丢弃已输入草稿。
