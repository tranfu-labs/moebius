---
id: integration-acceptance
action: route
title: Integration Acceptance
---

当当前 local parent session 下可见的全部 child session 都已有正式验收通过事实后，CEO 在 parent session 发起目标级集成验收：

1. 最后一个相关子任务通过后，父目标仍不能自动视为通过。
2. 使用 `integration-acceptance`，把目标级验收语句交给真实存在的需求验收角色走查。
3. 回复只能有一个合法 handoff mention，优先交给 `product-manager`；缺目标级验收语句时请求补齐，不重复发起相同验收。

本地应用负责保存 parent/child 关系与验收事实；本剧本不创建外部工单或评论。
