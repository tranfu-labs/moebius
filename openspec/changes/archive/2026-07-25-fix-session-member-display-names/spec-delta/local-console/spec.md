# local-console spec delta：会话成员可见身份投影

## Requirement: 会话只投影 effective 团队的最小可见成员身份

Source: `docs/product/pages/main-conversation.md#上下文`

local-console state 与 session view MUST 从目标会话自己的 effective 团队快照投影有序成员 slug 与可读显示名，供展示层把 message / run role 映射为真实成员身份。投影 MUST NOT 包含 `AGENT.md` 正文、persona、职责、协作规则或其他 prompt 内容；单个成员的显示名缺失或无法解析时 MUST 有限降级，MUST NOT 让整段会话状态读取失败。团队目录后续修改、删除或需修复 MUST NOT 改变已持久化会话快照的历史身份投影。读取和投影 MUST NOT 重写会话 JSONL、effective snapshot 或既有 message / run role。

### Scenario: 自定义团队返回最小身份

- GIVEN 会话 effective 快照含 `plan-supervisor` 与 `plan-executor`，两者 frontmatter 各有不同显示名
- WHEN 客户端读取主 state 或该会话 view
- THEN 响应按快照顺序返回两个 slug 及对应显示名
- AND 响应不包含任一成员的 Markdown 正文或职责规则

### Scenario: 团队目录删除后历史身份仍可读

- GIVEN 会话已持久化有效团队快照
- WHEN 对应磁盘团队之后被删除且客户端读取历史会话
- THEN 历史成员身份仍从会话快照投影
- AND 会话能否继续仍服从既有团队健康门禁

### Scenario: 子会话身份不跟随父会话改选

- GIVEN 子会话已继承并持久化团队 A 的 effective 快照
- WHEN 父会话之后改选团队 B
- THEN 子会话 view 仍投影团队 A 的成员身份
- AND 不使用父会话当前团队或磁盘团队列表覆盖子会话历史身份

### Scenario: 存量会话只读投影没有持久化副作用

- GIVEN 存量会话的 JSONL、effective snapshot 与既有 message role 已持久化
- WHEN 客户端读取 state 或 session view 并据此显示成员名称
- THEN JSONL 内容、effective snapshot 与既有 message / run role 保持逐项不变
- AND 系统不需要迁移、回填或重写该会话
