# 任务：conversation-console

- [x] 交互与信息架构设计在对话中采访收敛（侧栏三态与排序、树进账本、查收点、协议控件化）
- [x] 落盘 proposal / design / wireframes / spec-delta
- [ ] 对接设计（实现前置，另起补充或独立 change）：数据来源与读取通道、用户消息写入与触发通道、中断传导、进程边界与只读红线取舍、自由会话持久化形态、GitHub issue 总线并存或退役
- [ ] 按 `wireframes.md` 实现对话操作台页面（等用户明确「开始写代码」后进行）
- [ ] 实现后 AI 验证：打开页面逐视图与 `wireframes.md` 对照（侧栏排序与冒泡、渐进披露折叠、运行中块、验收卡片生成文本、事件流跳转、账本视图），截图留档

测试说明：本 change 交付物为设计文档，无可测逻辑，豁免单元测试。实现阶段的单测范围（侧栏排序纯函数、事件回流映射、验收走查文本生成等）在对接设计时定义。

---

## 30 批处置（归档：目标已达成）

本 change 的提案目标是「把人机交互主战场从 GitHub issue 评论区迁到本地操作台」。该目标已由 `four-layer-10-local-console`、`four-layer-20-desktop-renderer` 与 `four-layer-30-github-runner` 共同达成：本地对话操作台已是产品唯一形态，GitHub issue 总线按本 change 提出的「并存或退役」选项**退役**。归档为已达成，剩余未勾项是迁移期的过渡设计问题，随 GitHub 形态消失而失去对象。
