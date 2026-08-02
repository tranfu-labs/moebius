# desktop-shell spec delta：console-error-visibility

## ADDED Requirements

### Requirement: 控制台客户端错误按操作来源拥有生命周期

Source: docs/product/pages/main-conversation.md#操作与反馈

desktop renderer MUST 为共享客户端错误记录产生它的用例来源和该来源内的操作代次。操作成功 MUST 只消解
同来源当前操作的错误；周期性状态刷新或其他来源成功 MUST NOT 清除它们没有产生的错误。页面 MAY 继续只显示
一个当前错误，但 MUST NOT 使用 TTL、固定延时或附件专属状态代替来源所有权。

同来源较旧操作的迟到成功或失败 MUST NOT 清除、替换或恢复较新操作已经提交的错误状态。不同草稿、会话、
项目或标签允许并发时，来源 MUST 包含足以区分对应实体的 scope；scope MUST NOT 进入用户文案、DOM、日志或持久化。

#### Scenario: 周期性刷新不清除用户操作错误

- GIVEN 项目操作失败已产生可见客户端错误
- WHEN state refresh 连续成功三个轮询周期
- THEN 项目错误保持可见
- AND refresh 不提交针对该项目错误的清除

#### Scenario: 无关成功不清除现有错误

- GIVEN 来源 A 的错误当前可见
- WHEN 来源 B 的操作成功
- THEN 来源 A 的错误保持可见
- AND B 只 settle 自己的错误所有权

#### Scenario: 同源恢复清除且 stale 结果无效

- GIVEN 来源 A 的旧错误可见且 A2 是该来源最新操作
- WHEN A2 成功
- THEN A 的错误被清除
- WHEN 更早的 A1 随后成功或失败
- THEN 当前错误状态保持不变

#### Scenario: 并发实体互不清除

- GIVEN 两个不同 draft 或 session 的操作具有同一来源 family 但不同 scope
- WHEN 其中一个操作成功而另一个已经失败
- THEN 失败实体的错误保持可见
- AND scope 不出现在页面或持久化数据中
