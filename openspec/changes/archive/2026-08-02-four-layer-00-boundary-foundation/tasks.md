# 任务：four-layer-00-boundary-foundation

## A · 护栏

- [x] 为 layer assignment、matrix、domain closure、application use-case shape、adapter branch total、composition root、legacy debt 定义稳定 `[IB:*]`
- [x] 补未归属、多归属、非法方向、两跳 IO、type-only、application 业务字段/第 13 分支/use-case LOC/composition-root LOC/多 runtime export、adapter 内联业务过滤、exact permit/debt、stale permit/debt 红绿测试；四个 application shape 阈值各有只触发自身规则的 fixture
- [x] 先让当前仓库生成完整归属清单，再人工复核 exact debt；不得用 broad prefix 掩盖违规

## B · 实现与文档

- [x] 扩展现有 import boundary analyzer 和命令，不新建第二套 CLI
- [x] 把 10,301 行已知纯模块纳入 domain 传递闭包
- [x] 更新 `module-map.md` 的四层 `[IB:*]` 登记与剩余 `[NI:view-intent-only]` 验证责任
- [x] 保留现有 25 条 IB，记录新增后的真实 rule/file/debt 计数

## C · 验证

- [x] `pnpm run test --scope <base>`、checker 定向测试、typecheck 全绿
- [x] 报告 checker 单独耗时、纯模块保护率和 debt 初始清单
- [x] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`
- [x] 确认无生产行为、测试选择和用户页面变化；无需真机动作
