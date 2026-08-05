# 提案：extend-local-tool-deadline-2h

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-conversation.md` | `运行监督与异常重跑` | 将连续工具在途区间的独立等待上限产品默认改为两小时，并保留本地部署调整能力；区间计时、并行工具行为及其它监督语义不变 | 已写入 |

主页面会话区继续引用本页定义单 Agent 的运行监督与耗时，不在 `main-conversation.md` 重复这一条规则。不存在页面布局、信息架构或模块依赖方向变化，因此不创建 wireframe 或 architecture 制品。

## 背景

上一项缺陷修复解决了超大 Codex JSONL 行丢失完成事件后错误触发工具看门狗的问题，保留了 1 MiB 行上限和真正挂死工具的有限收束。另一个独立的产品问题是，正常的大型构建、全量测试、签名或打包可能合法运行超过 30 分钟；当前连续工具在途区间的默认上限会在这些任务仍有进展时提前终止它们。

本次调整是产品默认值变更，不是上一项超大输出修复的返工，也不改变现有空转窗口或其它运行监督窗口。

## 提案

1. 将连续工具在途区间的独立监督默认值从 30 分钟改为 2 小时（`7_200_000` 毫秒）。
2. 保留 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` 作为本地覆盖；存在有效正整数时按现值使用，缺省时才使用两小时，非法值继续沿用现有 fail-fast 配置校验，不转为无限等待。
3. 保持同一解析后的值沿既有运行链传递到 Codex、Claude、Kimi，覆盖主 Agent、专业成员、分析、full 和 resume 路径，避免只修改某一家 provider 的文档或一条调用分支。
4. 保持连续工具在途区间的计时语义：区间从 open-tool 集合由空变为非空开始，到集合再次清空结束；区间内部分并行工具的开始或结束不重置 deadline。现有空转识别、provider 忙等待、长运行提醒和 managed process 的生命周期语义与配置也保持不变。工具仍有有限上限；真正挂死的工具仍须在该上限内收束。
5. 用短的测试覆盖值完成真实 Electron 验收，不等待两小时。默认两小时由隔离配置进程的精确数值证据单独证明；真实页面只证明这个值能沿真实运行链到达并且覆盖值、idle 与其它监督机制仍按契约工作。

## 影响

- 运行时影响集中在现有本地 console 超时配置的默认 fallback；预期实现只需触及配置解析和新增回归测试，不改变 UI、session 数据结构、provider 协议或 managed-process 实现。
- 现有 runtime wiring 已将 `toolTimeoutMs` 从本地 console 启动配置传入统一 execution driver，再传给 Codex、Claude、Kimi；方案会核对并测试这条实际覆盖链，而不是只更新文案。
- 六个既有未提交修复文件及其真实 Electron/evidence 产物属于工作树基线：其中其余五个文件保持不动；`scripts/acceptance/local-runtime-supervision.ts` 只把 A13 的动态标题断言改为过程完成、无 `running`、run/activity 释放等稳定终态断言。
- 不调整 `MOEBIUS_LOCAL_RUN_IDLE_TIMEOUT_MS`、`MOEBIUS_LOCAL_PROVIDER_BUSY_TIMEOUT_MS`、`MOEBIUS_LOCAL_LONG_RUN_REPORT_MS`，也不调整 Kimi managed-process 工具收束或其它 managed-process 期限。
- 不修改当前运行中活动、完整输出、错误终局或历史数据模型；无页面或架构形状变化。
