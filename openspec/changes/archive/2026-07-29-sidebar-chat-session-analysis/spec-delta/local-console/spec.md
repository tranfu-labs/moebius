# local-console delta：sidebar chat 会话事实、文本片段与写入闸门

## ADDED Requirements

## Requirement: sidebar chat 仍是普通根会话
Source: docs/product/flows/session-analysis.md#4-首次发送并创建会话

local-console MUST 把 sidebar chat 保存为普通、可继续、可归档和可恢复的根 session。session MAY 保存可信 `originSessionId`、`entryTemplate` 与 `writePolicy` 导航/入口事实；这些字段 MUST NOT 改变普通团队快照、provider/model/effort、工作空间或消息生命周期，也 MUST NOT 从消息正文、文本片段或来源 run 推断。

### Scenario: 最终上下文创建 session
- GIVEN sidebar chat 草稿在发送瞬间选择项目 P、工作空间 W 和团队 T
- WHEN 创建与首条消息原子成功
- THEN session 属于 P 并使用 W 与 T 的冻结快照
- AND 不继承来源会话运行配置
- AND origin 仅保存为导航元数据。

## Requirement: 文本片段与用户消息原子提交
Source: docs/product/flows/session-analysis.md#2-收集静态文本片段

用户消息 MUST 支持有序静态文本片段。每项 MUST 保存稳定 fragment id、短标签与完整普通文本，并与正文和普通附件在同一个 session fact 中原子提交。prompt builder MUST 把片段作为普通文本上下文按顺序交给 Agent；系统 MUST NOT 把片段当作文件附件、自动读取路径、刷新内容或授予权限。

### Scenario: 删除片段后发送
- GIVEN 草稿原有两个片段且用户删除第一个
- WHEN 首条消息提交成功
- THEN JSONL、SQLite 投影、消息 UI 与 prompt 只包含第二个片段
- AND 被删片段不形成附件或隐藏 prompt。

### Scenario: 重建保留片段顺序
- GIVEN JSONL 用户消息包含三个片段
- WHEN SQLite 索引被删除并从 JSONL 重建
- THEN 三个片段的 id、标签、完整文本和顺序保持。

## Requirement: 会话引用文本由可信事实格式化且不扩张读取能力
Source: docs/product/flows/session-analysis.md#2-收集静态文本片段

local-console MUST 通过窄只读操作按 session 与可选 run locator 返回静态普通文本。文本 MUST 包含 Moebius session JSONL 路径，并在可信 execution link 存在时包含 provider 名称与 external session id。系统 MUST NOT 按时间猜测关联、读取记录内容、复制记录或扩张 Agent read roots。

### Scenario: provider id 不存在
- GIVEN 目标 run 尚未建立可信 external session link
- WHEN renderer 请求引用文本
- THEN 响应只包含 Moebius session 路径
- AND 不制造 provider id 或失败整个入口。

## Requirement: 分析入口策略在确认前强制只读
Source: docs/product/flows/session-analysis.md#5-分析并确认方案

`writePolicy=confirm-current-plan-before-write` 的 session MUST 在当前方案获得匹配确认前，把所有成员 run 限制为 provider 强制只读。提示词声明本身不足以满足此 Requirement。任意非法、模糊、过期或不匹配的确认 MUST fail closed；手动 sidebar chat 与普通会话 MUST 保持 normal policy。

### Scenario: 未确认写入被阻止
- GIVEN session 使用确认前只读策略且没有当前版本 write lease
- WHEN 用户要求修改工作空间、团队文件或其他正常可写本地目标
- THEN Codex/Kimi run 均使用只读能力
- AND 文件与持久本地状态不变
- AND 用户获得可见说明。

### Scenario: 当前方案确认产生一次执行
- GIVEN 主 Agent 已登记方案版本 V
- WHEN 用户自然语言确认且只读控制回合返回匹配 V 的有效控制事实
- THEN runtime 为紧接着的同一 Agent resume 建立一次性 write lease
- AND 该执行使用普通会话正常权限
- AND 终态后 lease 关闭。

### Scenario: 方案变化使旧确认失效
- GIVEN 当前方案从 V1 更新为 V2
- WHEN 用户确认或控制事实仍指向 V1
- THEN runtime 不建立 write lease
- AND 继续以只读能力等待 V2 的确认。

## Requirement: 搜索与恢复活动项目内根会话
Source: docs/product/pages/search.md#操作与反馈

local-console MUST 支持按规范化标题搜索活动项目内的活动或可选归档根用户会话，并返回足以完成普通/组合路由的 project、session、archived 与 origin 状态。空查询 MUST NOT 返回全部会话。恢复 MUST 复用既有 session 事实且保持标题、消息、工作空间、团队、运行历史、origin 和 write policy。

### Scenario: 恢复归档 sidebar chat
- GIVEN 一段归档 sidebar chat 仍属于活动项目
- WHEN 恢复操作成功
- THEN 恰好一个原 session 回到活动列表
- AND 不创建替代 session
- AND origin 与入口策略保持。

## Requirement: 归档与来源失效保持 sidebar chat 独立
Source: docs/product/pages/main-left-sidebar.md#归档

归档 sidebar chat MUST 只归档目标 session；归档或移除来源项目 MUST NOT 自动归档属于其他项目的 sidebar chat。来源可用性变化 MUST 只改变 presentation route，不改变 sidebar chat 历史、团队、工作空间、权限或运行状态。

### Scenario: 来源项目被移除
- GIVEN sidebar chat B 属于项目 P2 且来源 A 属于项目 P1
- WHEN P1 被移除
- THEN A 随 P1 归档
- AND B 保持活动且事实不变
- AND presentation 层可把 B 降级到主内容。
