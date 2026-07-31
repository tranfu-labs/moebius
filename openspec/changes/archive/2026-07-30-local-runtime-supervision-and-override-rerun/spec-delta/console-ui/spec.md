# console-ui 规格增量：运行监督与一次性执行配置重跑

## 新增：运行活动显示真实监督事实

Source: docs/product/pages/agent-conversation.md#最新活动

RunBlock MUST 能呈现 runtime 提供的服务繁忙、观察到的 retry attempt 和长运行报告；这些事实仍原地替换同一 run 的最新活动，不得新增时间线行。次数只有在 DTO 明确提供时才显示；缺失时 MUST 使用不含数字的安全文案。组件 MUST NOT 根据 elapsed、CLI 名称、普通 stderr 文本或活动频率自行推断服务繁忙、额度耗尽或卡住。

### Scenario: 服务繁忙次数可见

- **GIVEN** runtime activity DTO 表示 retryable service busy 且 attempt=3
- **WHEN** 用户查看该活动 run
- **THEN** 活动行显示「对方服务繁忙，正在第 3 次重试」
- **AND** 同一 run 仍只有一条活动记录
- **AND** 停下入口保持可用。

### Scenario: 未提供次数不编造

- **GIVEN** runtime 只确认服务繁忙但没有可靠 attempt
- **WHEN** RunBlock 渲染活动
- **THEN** 它显示「对方服务繁忙，正在重试」
- **AND** 不显示猜测的次数。

## 新增：异常终局保留不完整正文

Source: docs/product/pages/agent-conversation.md#停下
Source: docs/product/pages/agent-conversation.md#页面状态

RunOutcome MUST 在 runtime DTO 提供 partial Markdown 时，使用既有安全 static Markdown renderer 显示该正文，并常驻可读的“内容不完整”说明。partial Markdown、说明和 terminal fact MUST 属于同一条历史记录；组件 MUST NOT 把 partial 渲染成 completed Agent message，也不得在 terminal refresh、父级重渲染或重开会话时丢失。

user-interrupted MUST 显示「你让这一步停下了」且保持中性；quota/rate-limit/auth/crashed/no-complete-result MUST 使用 runtime safe classification 的可理解文案并触发宿主提供的异常语义。只有间接证据时 MUST 说明没有产出完整结果和可能原因，MUST NOT 假称额度已经耗尽。raw provider payload、stderr、路径和内部 reason MUST NOT 出现在普通终局卡片。

### Scenario: Kimi 用户停止不显示失败

- **GIVEN** terminal DTO 为 user-interrupted 且包含 partial Markdown
- **WHEN** RunOutcome 渲染
- **THEN** 用户看到 partial Markdown、「内容不完整」和「你让这一步停下了」
- **AND** 看不到「这一步没跑起来」或成功完成语义。

### Scenario: 无结果不是成功消息

- **GIVEN** terminal DTO 为 no-complete-result
- **WHEN** 主会话和 sidebar status 渲染
- **THEN** 时间线显示需要处理的安全终局
- **AND** 不显示 completed Agent message 或有新结果蓝点。

## 新增：终局原位选择一次性执行配置重跑

Source: docs/product/pages/agent-conversation.md#重试与恢复

user-stopped、timeout、quota/rate-limit、auth 和 no-complete-result 终局 MUST 提供普通重试及「换执行配置重跑」。选择器 MUST 复用宿主传入的团队执行能力 registry 来约束 CLI/model/effort，明确说明“只用于这一次重跑，不会修改团队成员设置”，且首版 MUST NOT 提供默认持久化到团队配置的选项。

console-ui MUST 保持 presentational：它只消费 registry DTO、loading/error/selection/submitting 状态和 callbacks，不得加载 capability、调用 local API、修改团队 store 或导入 runtime 类型。registry 慢返回、失败或为空时，原 terminal content、普通重试和继续说话能力 MUST 保持；迟到响应、父级重渲染与 callback identity 变化 MUST NOT 重置用户较新的选择或重复提交。

所有选择器和确认/取消动作 MUST 可由键盘操作并具有独立可访问名称；提交中 MUST 防止重复激活。窄窗口 MAY 换行或纵向排列，但 MUST NOT 产生页面级横向滚动。

宿主 MUST 为每次用户显式确认生成新的 single-run submission nonce。同一次确认产生的重复网络请求 MUST 复用 nonce 以保持幂等；用户回到终局卡片再次确认同一 profile MUST 使用新 nonce，不得因 profile 相同而静默吞掉。

### Scenario: 临时切换模型提交

- **GIVEN** user-stopped 终局和已加载 capability registry
- **WHEN** 用户选择另一 CLI/model/effort 并确认
- **THEN** 组件恰好调用一次 single-run rerun callback
- **AND** 页面明确说明团队设置不会改变
- **AND** 原 partial Markdown 与 terminal history 保持可见。

### Scenario: registry 慢返回时父级更新

- **GIVEN** override panel 正在加载 registry
- **WHEN** 父级用新 callback identity 重渲染且旧请求随后返回
- **THEN** terminal content 不丢失
- **AND** 旧响应不覆盖较新的受控状态
- **AND** 确认操作只调用当前 callback 一次。

### Scenario: registry 失败可恢复

- **GIVEN** capability registry 加载失败
- **WHEN** 用户查看终局
- **THEN** panel 原位显示可理解失败和重新加载动作
- **AND** 普通重试、继续说话与历史内容仍可用
- **AND** 不提交默认或未经校验的 profile。
