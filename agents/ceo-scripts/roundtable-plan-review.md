---
id: roundtable-plan-review
action: roundtable
title: Roundtable Plan Review
---

当一个复杂方案需要多角色同轮评审但不应放宽默认 mention 协议时，CEO 使用 v0 串行圆桌：

1. 识别场景：parent session 中需要多角色方案评审，目标是降低人工路由成本，而不是追求运行时并发。
2. 使用 `roundtable-plan-review`。圆桌必须落在独立 child session；parent session 只接收 child 链接、最终汇总、分歧、依据和 provenance。
3. 固定参与者顺序：qa -> dev-manager -> hermes-user。每次只 handoff 给一个参与者；每位参与者贡献后必须把控制权交回 CEO 主持人。
4. 固定一轮：三位参与者各发言一次后 CEO 汇总；需要下一轮时显式创建或发起下一轮，不自动追问。
5. 汇总规则：必须按角色保留 position、evidence 和 disagreements，不能把不同角色意见压成无来源共识。

本地应用负责创建或找回 roundtable child session、保存单 mention handoff 与汇总事实；本剧本不创建外部工单。
