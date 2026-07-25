# 设计：fix-session-member-display-names

## 根因与数据链路

现状链路：

```text
会话 effective 团队快照
  members[{ name: slug, agentMarkdown(display_name) }]
          │
          ├── runtime 路由：读取首成员与 slug（正确）
          └── renderer state：只返回 message.role / run.role
                                      │
                                      ▼
                              多份内置角色硬编码表
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
                 团队成员           协作者            成员未知
```

目标链路：

```text
会话 effective 团队快照
          │
          ├── runtime 路由：保持现状
          └── 安全身份投影 [{ slug, displayName }]
                                      │
                                      ▼
                              单一纯成员名解析器
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
                 历史消息           活动/终态          过程/子任务
                         均显示同一真实成员名称
```

目标会话中的 `plan-supervisor` 和 `plan-executor` 分别应稳定解析成“方案监督者”和“方案执行者”；消息的 role、run 的 role 与快照 slug 是连接键。

## 方案

### 1. 在 local-console 边界派生最小身份投影

- 新增纯投影逻辑，从 `LocalConsoleAgentTeamSnapshot.members` 读取：
  - `slug = member.name`
  - `displayName = AGENT.md frontmatter.display_name`
- 复用仓库已有 Agent frontmatter 解析器，不在 renderer 复制 YAML / Markdown 解析。
- 解析异常、字段缺失或空白时不让整个 state 请求失败；该成员保留 slug，display name 降级为空，由 UI 执行明确兜底。
- state 与 session view 只返回 `{ slug, displayName }`。绝不返回 `agentMarkdown`、frontmatter 其他字段、正文、persona 或协作规则。
- 子会话沿用自己继承并持久化的 effective 快照，避免父会话之后改选团队时污染子会话身份。

### 2. 用纯函数集中显示名规则

在 console-ui 建立不依赖 React、DOM 或 IO 的成员名解析模块。输入为 `role`、会话成员身份列表与调用方的未知值文案，规则顺序为：

1. `role` 精确匹配会话成员 slug 且 display name 非空：返回快照显示名。
2. 快照成员存在但 display name 不可用：返回可读的 `@<slug>`，不把两个成员合并为同一个泛称。
3. 会话没有身份投影时：为未绑定存量会话保留现有内置角色中文映射。
4. `role` 为空或无法可信映射时：返回调用方约定的“团队成员”或“成员未知”。

同一纯函数还负责生成过程标签的基础成员名；同成员第 2 个及以后标签的序号逻辑继续独立保留。

### 3. 统一消费点

以下面向用户的身份位置必须消费同一个解析结果：

- 主时间线已完成 Agent 消息的头像首字与 who 行名称；
- 主时间线活动 run 的名称、头像与专业成员“停下”可访问名称；
- 没跑起来、卡住、停下、重试耗尽等终态事实中的成员名称；
- “完整输出”打开后过程标签标题及过程内公开输入的成员名称；
- 子会话卡片与子任务标签中的负责成员、历史消息、活动 run、终态事实和停止动作。

Storybook / 旧演示组件如果仍接受单独 role，可保留兼容入口，但生产会话路径不得再直接调用分散的硬编码表。

### 4. 历史数据与团队变化

- 不改 JSONL：报告会话的 create event 已包含正确团队快照，消息与 run event 已包含正确 role。
- 不改 SQLite schema：现有 `session_agent_team_members` 已保存 effective 快照。
- 已有会话在升级后读取同一快照并生成新 DTO，即可修复显示。
- 用户之后修改当前团队的 `display_name`，不改变已开始会话的显示身份；会话展示与运行 prompt 一起服从选择时 effective 快照。
- 团队目录之后删除或进入需修复状态时，只影响能否继续运行；已有会话仍可用持久化快照显示历史成员名称。

## 单元测试用例

### 身份投影

1. 两个自定义成员的有效 frontmatter 分别投影正确 slug 与中文显示名，顺序保持不变。
2. 无 frontmatter、空 `display_name`、非字符串字段及损坏 frontmatter 均有限降级，不泄露 Markdown，不让 state 失败。
3. state 与子会话 view 只含最小身份字段，不含 `agentMarkdown` 或 persona 正文。
4. 父会话改选团队后，已创建子会话仍返回自己的 effective 身份投影。

### 纯解析器

1. `plan-supervisor` / `plan-executor` 分别解析为“方案监督者”/“方案执行者”。
2. 自定义成员缺少显示名时显示 `@slug`。
3. 无会话投影的 `dev` / `qa` 保持兼容中文名称。
4. 空 role 与不存在于投影的 role 使用调用方指定的未知值。
5. 同成员两个过程标签依次为“方案监督者”“方案监督者 2”；两个不同成员不共享序号。

### 渲染隔离

1. 一段含两个自定义成员的主时间线显示两个不同中文名称，不出现“团队成员”或“协作者”替代它们。
2. 自定义成员活动 run 与对应历史消息显示一致，停止按钮可访问名称包含真实成员名。
3. 自定义成员的终态事实和过程标签使用相同名称。
4. 子会话卡片、子任务标题、子任务历史消息与活动 run 使用子会话身份投影。
5. 团队目录不可用但会话快照仍在时，历史名称继续可见，继续运行门禁维持现状。

## 旧会话 fixture 与零改写证据

报告会话是用户本机事实，不把 6 MiB 完整聊天或其中的 prompt 正文复制进仓库。自动化测试使用去敏的最小持久化 fixture，保留与报告会话相同的关键形状：

- `local-create-session` 已持久化 ordered effective snapshot：`plan-supervisor → 方案监督者`、`plan-executor → 方案执行者`；
- JSONL 的既有 Agent message / run fact 只携带对应 role slug；
- SQLite 的 `session_agent_team_members` 与 `session_messages` 已在服务启动前存在；
- 当前磁盘团队列表为空、已删除或被替换成不同名称，且测试中的 live team loader 若被调用就立即失败。

fixture 先完成数据库初始化，再建立只读基线；随后只请求 state / session view 并渲染 DOM，不发送消息、不切换团队、不恢复或启动 run。证据必须同时断言：

1. state / session view 仅凭持久化 effective snapshot 返回两个身份，并正确映射既有 role；
2. fixture JSONL 的 SHA-256 与字节长度在读取前后完全相同；
3. 用一个跨请求保持打开的 SQLite 观察连接读取 `PRAGMA data_version`，state / session view 请求前后值相同；
4. `session_agent_team_members` 与 `session_messages` 的全列有序查询结果请求前后深相等；
5. 返回 DTO 与序列化 DOM 输入不含 `agentMarkdown`、职责正文或其他 prompt 内容。

`PRAGMA data_version` 的基线必须在 server/store 初始化完成后取得，避免把测试装配所需的 schema 初始化或 message index rebuild 误算成展示读取。相关 SQL 行快照用于给失败提供可诊断证据，不以 SQLite 文件字节哈希代替：WAL / journal 元数据变化不等价于业务行被改写。

对用户给出的具体 JSONL 另做一次只读现场核对：实现前后分别记录 `shasum -a 256`，并用 `jq` 只提取 create snapshot 的 slug / `display_name` 和既有 message role；SQLite 只用 `sqlite3 -readonly` 查询对应 effective 成员与 role 聚合。现场核对不得让开发版 runtime 指向用户真实数据根，自动化行为由上述去敏 fixture 证明。

## 展示入口与测试证据矩阵

| 展示入口 | 直接断言 | 测试落点 |
| --- | --- | --- |
| 主时间线历史消息 | 同一时间线内两个自定义 role 分别显示“方案监督者”“方案执行者”，已知成员不显示泛称 | `packages/console-ui/src/console/operator-console.test.tsx` |
| 活动 run | 活动记录的名称与同 role 历史消息一致 | `packages/console-ui/src/console/operator-console.test.tsx`、`run-block.test.tsx` |
| 停止动作 | 自定义专业成员停止按钮的 accessible name 为“停下方案执行者”，回调仍携带原 sessionId / runId | `packages/console-ui/src/console/operator-console.test.tsx` |
| 终态事实 | 没跑起来、卡住、用户停下、重试耗尽四类事实均显示对应快照成员名 | `packages/console-ui/src/console/run-outcome.test.tsx`、`operator-console.test.tsx` |
| 过程标签 | 两个不同成员各用自己的名称；同一成员重复打开依次得到“方案监督者”“方案监督者 2”；过程公开输入沿用该名称 | `packages/console-ui/src/console/process-tab.test.tsx`、`operator-console.test.tsx` |
| 子会话卡片 | summary 从目标子会话 effective snapshot 解析负责成员，卡片文本与 accessible name 使用该名称 | `tests/local-console-child-session-summary.test.ts`、`operator-console.test.tsx` |
| 子任务标签 | 标题摘要、历史消息、活动 run、四类终态事实与停止动作全部使用子会话自己的身份投影 | `packages/console-ui/src/console/subtask-tab.test.tsx` |

矩阵中的每一行都必须有直接断言；不得用“整个 OperatorConsole 能渲染”或一条宽泛 snapshot 代替入口级证据。

## 必要防回归与范围边界

- **子会话隔离是必要防回归**：根因之一是展示层拿不到目标会话身份；若子任务复用父会话投影，自定义 slug 仍会错名。测试只固定“目标会话使用自己的 effective snapshot”，不新增子会话运行规则。
- **团队删除后的稳定显示是必要防回归**：它区分“持久化会话快照”与被否决的“当前磁盘团队列表”方案，并落实已有会话选择时内容不漂移的产品契约。继续运行仍服从既有团队健康门禁。
- **未知名称降级是必要边界测试**：集中解析器替换多份白名单后仍需覆盖未绑定存量会话、损坏显示名和真正未知 role。已知 snapshot slug 缺显示名只降级为 `@slug`；只有无 role 或无法映射才使用通用未知文案。这里不扩大可用团队规则，也不把损坏团队伪装成健康。
- `plan-executor/AGENT.md` 自称主 Agent 的内容矛盾保持范围外。实现不得读写用户团队文件，不得改变 `primaryAgentSlug`、effective snapshot 顺序、消息 role、run role、路由、交棒、恢复、并发或团队健康语义。
- 新身份投影是只读派生 DTO。投影保持 snapshot 原顺序，但不反向写 snapshot，也不参与“首成员即主 Agent”的 runtime 决策；现有主 Agent 路由测试继续作为回归门禁。

## AI 验证流程

1. 用上述去敏持久化 fixture 恢复包含两个非内置 slug 的旧会话，不通过 live 团队 loader 补数据。
2. 在 store 初始化后记录 JSONL hash / size、SQLite `data_version` 与两张相关表的有序行快照；读取 local-console state / session view，断言身份投影恰好包含两个 `{slug, displayName}`，序列化结果不含 AGENT 正文中的职责文本。
3. 渲染操作台，使用 DOM 文本与可访问名称断言：
   - 历史消息分别显示两个真实名称；
   - 活动 run、停止动作、终态事实与过程标签保持同名；
   - 页面不以“团队成员”“协作者”“成员未知”代替已知成员。
4. 创建子会话后修改或删除磁盘团队，再读取/渲染历史：
   - 主、子会话仍显示各自快照名称；
   - 继续运行仍按既有团队健康门禁阻止；
   - JSONL hash / size、SQLite `data_version` 及两张相关表的有序行快照均与基线相同。
5. 对用户给出的具体 JSONL 执行前后只读 hash 与 slug / display name / role 聚合核对，不启动 runtime 连接真实数据根。
6. 运行 console-ui、desktop state-sync、local-console 定向测试及根 typecheck；长输出重定向到临时日志，只核对退出码与失败摘要。

## 权衡

### 选用会话快照，而不是当前团队列表

当前团队列表在 renderer 已存在，直接查它改动更小，但团队重命名、删除、修复或会话中改选后会让历史身份漂移，也无法可靠服务子会话。会话 effective 快照才与当次运行实际使用的成员内容一致。

### 投影最小身份，而不是暴露完整快照

完整快照实现最省事，但会把 persona、协作规则和其他不应展示的 prompt 内容送到浏览器边界。服务端解析并投影两个可见字段能保持 preload / renderer 边界。

### 保留内置映射作为兼容兜底

直接删除所有内置映射会让没有团队快照的存量未绑定会话退化为 slug。保留单一兼容表可避免回归，但绑定会话必须以快照为准。

## 风险与回滚

- 风险：漏改某个硬编码消费点，导致同一成员仍在局部显示不同名称。用全库搜索硬编码表与跨组件渲染用例双重收口。
- 风险：身份投影解析异常拖垮 state 刷新。投影函数逐成员有限降级，并覆盖损坏输入。
- 风险：错误使用当前团队列表造成历史漂移。用“磁盘团队修改/删除后仍显示快照名”的测试固定语义。
- 风险：DTO 新字段在桌面与 console-ui 类型间不同步。local-console state、desktop adapter 与 UI props 同步修改并以 typecheck 门禁。
- 回滚：移除新增 DTO 字段与集中解析器调用即可恢复旧展示；持久化格式未变，无数据回滚。
