# local-console delta：analysis-conversation-tree

## Requirement: 分析会话持久化直接父归属
Source: docs/product/flows/session-analysis.md#5-分析并确认方案

local-console MUST 为已创建分析会话持久化直接父会话标识；该关系 MUST NOT 进入团队子任务投影，具有直接分析父关系的会话 MUST NOT 进入根会话列表。

### Scenario: 分析会话首次发送成功

- Given 分析草稿从会话 A 创建
- When 首条消息与分析会话 B 创建成功
- Then B 的直接分析父会话为 A
- And 根会话列表不包含 B
- And A 的直接分析子项只包含 B，不包含 B 的后代

### Scenario: 旧分析会话安全迁移

- Given 旧会话具有有效 `entryTemplate=session-analysis` 与现存 `originSessionId`
- When store 执行幂等迁移
- Then 直接分析父关系回填为该来源会话
- And 缺失、自指或非法来源不得导致会话从所有入口消失

## Requirement: 来源引用在新 run 前读取最新可访问内容
Source: docs/product/flows/session-analysis.md#收集来源引用

任意用户消息中位于可导航 Markdown link 的合法 `moebius-ref:` MUST 在新 run 创建前读取目标当时最新的只读来源；Agent 消息中的引用 MUST NOT 触发来源交付。

### Scenario: 消息引用启动新 run

- Given 用户消息包含可访问的消息引用
- When runtime 准备创建新 run
- Then run 上下文包含目标消息及其关联运行记录
- And 不授予读取来源项目文件或其他对象的能力

### Scenario: 同一 run 恢复

- Given run 已经取得来源上下文后中断
- When 用户继续该 run
- Then runtime 复用该 run 的既有来源上下文
- And 不重新读取引用目标

### Scenario: 新 run 读取更新

- Given 引用目标在上一次 run 后产生新内容
- When 用户重试、重新运行或重发并创建新 run
- Then runtime 重新读取引用目标的最新可访问内容

## Requirement: 来源读取失败不创建新消息或 run
Source: docs/product/flows/session-analysis.md#来源引用不可用

来源读取 MUST 先于新用户消息提交、分析会话创建和新 run 创建。读取失败 MUST 返回可恢复错误，并保持原草稿、既有消息或 pending 项。

### Scenario: 分析首条消息来源失败

- Given 分析草稿的来源目标不可读
- When 用户发送首条消息
- Then 不创建用户消息、分析会话、父面板入口或 run

### Scenario: pending 队首来源失败

- Given 主理人忙碌且队首 pending 项包含不可读引用
- When 该项准备发射
- Then 该项保持队首并记录失败原因
- And 不 claim 该项、不创建 run、后续项不发射

## Requirement: 归档和项目移除按分析后代闭包提交
Source: docs/product/pages/main-left-sidebar.md#归档

归档根会话或因项目移除归档任一会话时，local-console MUST 递归处理其全部分析后代；普通操作遇到范围内运行中或待接回控制工作 MUST 被拒绝。

### Scenario: 根会话归档

- Given 根会话具有多层分析后代且全部静止
- When 归档提交成功
- Then 根会话与全部分析后代在同一提交结果中隐藏

### Scenario: 项目移除命中中间分析会话

- Given 分析会话 B 使用待移除项目且 B 有使用其他项目的后代 C
- When 项目移除提交成功
- Then B 与 C 均隐藏
- And B 的父会话及子树外兄弟保持可见

### Scenario: 强制移除前置步骤失败

- Given 待隐藏范围存在运行中或待接回工作
- When 停止或放弃待接回任一步失败
- Then 项目移除事务不提交
- And 会话归档状态保持不变
