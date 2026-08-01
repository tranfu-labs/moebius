# 任务：four-layer-10-local-console

## A · 护栏与对账

- [ ] 冻结项目/会话、primary、worker、terminal/recovery 外部行为矩阵
- [ ] 从系列 design 复制 10 批四条精确 test-name 映射，建立 ledger；补齐 duration、最终替代纯测试、等价分支、保留接缝和删除/保留结论
- [ ] 生产迁移前先补缺失纯测试；不得读取源码文本做镜像断言

## B · 纵切实现

- [ ] 提取项目/会话 command/query application flows 与 domain policy
- [ ] 提取 primary execution application flow，消费现有 planners
- [ ] 提取 worker execution application flow，保持两种 origin 与 role lane 语义
- [ ] 提取 terminal/recovery transition；保留 fact/store/provider adapter
- [ ] 把 `runtime.ts` 收为 façade/composition + active runtime state，删除本 change 对应 layer debt

## C · 测试剪枝

- [ ] 每个被删/合并 test name 先取得 duration 样本并填写 ledger
- [ ] 保留 HTTP+SQLite、restart、provider facts、failure 和并发唯一接缝
- [ ] 对比迁移前后定向稳定集合；无法归因的速度变化记零

## D · 验证与真机

- [ ] `pnpm run test --scope <base>`、定向测试、typecheck、desktop build 全绿
- [ ] 执行 RA-01～RA-04，按真机协议记录页面入口和可见信号
- [ ] 报告纯比例、定向/完整闸门预期与实际、集成测试净变化
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`
