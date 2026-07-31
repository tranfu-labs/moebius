# 任务：local-runtime-supervision-and-override-rerun

- [x] 收口共享执行契约
  - [x] 新增纯 `ExecutionTerminal` / `ExecutionProgressEvent` 判别联合和 `assertNever`。
  - [x] 迁移 Codex、Claude、Kimi adapter，移除业务控制流对 reason 前缀和任意 stdout 活动的依赖。
  - [x] 保留 Kimi ACP JSON-RPC error code/message/data 到受信任诊断并检查 `stopReason` 与最终回复有效性。
  - [x] 迁移 GitHub runner 等共享调用方，保持既有 max-duration、retry 和 dead-letter 语义。
  - [x] 补三引擎映射、未知 payload、raw 诊断隔离和编译穷尽测试。

- [x] 实现语义监督
  - [x] 新增纯 run supervisor，只让正文、reasoning、工具起止和文件改动刷新 progress idle。
  - [x] provider retry 形成独立 busy phase；运行中投影可靠的重试次数，默认五分钟终结持续繁忙。
  - [x] local-console 停止传入 120 分钟 wall-clock kill；增加十五分钟 long-run report 且只提醒一次。
  - [x] 把集中参数写入 `src/config.ts`，覆盖 deadline、去重、乱序、恢复和配置边界测试。
  - [x] 扩展 Kimi/Claude 嵌套事件与 Codex item 投影，让运行中活动真实可见。

- [x] 持久化结构化终局与不完整内容
  - [x] 扩展 JSONL terminal fact、SQLite 可重建投影和 renderer DTO，保留 safe terminal、partial Markdown、elapsed 与 step/attempt/run 关联。
  - [x] 在清除 active snapshot 前原子提交最后可见 Markdown；失败不推进 cursor、不提交成功回复。
  - [x] 映射 user interruption、system interruption、idle/max、quota、rate-limit、auth、crashed 和 legacy facts。
  - [x] 更新 sidebar needs-human 推导：用户停止中性，额度/服务/无结果异常触发红点。
  - [x] 补刷新、重启、并行 run、子任务和旧数据库恢复测试。

- [x] 实现一次性执行配置重跑
  - [x] 扩展 retry/rerun API 与持久 intent，服务端用受信任 registry 校验 CLI/model/effort。
  - [x] 新增 run-scoped derived provider identity，允许该 override full 与同 run graceful resume，隔离 base canonical link。
  - [x] 保持同一步新 attempt、原消息附件、workspace 现状和历史过程，不修改团队配置或冻结快照。
  - [x] 证明 override 终局后的普通 run 回到基础 profile/canonical session，普通 mismatch 继续 fail closed。
  - [x] 覆盖重复提交、失败回滚、provider ID 冲突、重启恢复和附件复用。

- [x] 接入终局卡片与执行配置选择器
  - [x] `RunOutcome` 保留并渲染 partial Markdown 与“内容不完整”，补 user-stopped 普通重试。
  - [x] 为 eligible terminal 增加「换执行配置重跑」，复用团队页 registry 和 model/effort 规则。
  - [x] 首版只提供 single-run scope，不增加或默认勾选团队配置持久化。
  - [x] 更新中英文文案、Story 和主/embedded 组合，保持正文列、键盘与 screen reader 可达。
  - [x] 覆盖 registry 慢/失败、父级重渲染、callback identity 变化、迟到响应和重复点击。

- [x] 自动化验证与符合度复核
  - [x] 跑新增纯模块、adapter、runtime/store、desktop 和 console-ui 定向测试。
  - [x] 跑 `pnpm test`、`pnpm typecheck`、`pnpm --filter @moebius/console-ui check:storybook` 和必要 desktop build。
  - [x] 跑 `git diff --check`，核对没有依赖方向、shell、安全字段或 GitHub mode 漂移。
  - [x] 对照 proposal A1–A12 逐条记录自动化证据与真实运行/调用链证据，不用测试计数替代可见行为。

- [x] 真实桌面验收
  - [x] 使用系统临时数据根和可控 Kimi shim，证明 partial 后停止显示「你让这一步停下了」且内容不丢。
  - [x] 证明 Kimi 空/无效 end_turn 不产生成功 Agent 回复或蓝点。
  - [x] 用结构化 `403 + retryable:false` 证明可靠 quota 信号显示确认文案；无可靠信号显示保守文案。
  - [x] 证明伪活动不刷新 idle、真实活动刷新、long-run report 不杀进程。
  - [x] 证明服务繁忙重试次数可见，独立 busy 闸到期后留下准确终局。
  - [x] 刷新并重启应用，证明 terminal partial 与操作仍可恢复。
  - [x] 从终局卡片切换到另一执行配置重跑成功，再发普通消息证明团队配置、快照和原 canonical provider identity 未变。
  - [x] 用 GitHub runner harness 证明 max-duration、失败后 retry 成功和 retry budget 耗尽 dead-letter 行为未变。
  - [x] 输出证据目录、页面入口、可见断言、run/attempt/profile/provider 交叉信号；证据只写系统临时目录。

- [x] QA 阻塞项返工
  - [x] 三引擎维护配对工具生命周期，工具在途期间暂停通用 idle，结束后恢复。
  - [x] Claude `content_block_stop` 保持工具在途，只有匹配的 `tool_result` 形成 tool-finished。
  - [x] timeout 与 auth 终局开放一次性换执行配置重跑。
  - [x] 每次用户显式提交生成新 nonce；同 nonce 幂等、同配置新 nonce 可再次重跑。
  - [x] 删除生产零调用的 deadline evaluator 或把生产 deadline 接入同一规则，并补对应测试。
  - [x] 将服务繁忙口径降级为 provider 有明确信号时的条件能力，不声称真实 Kimi 已验证。
  - [x] 增加真实 Electron 长工具超过 idle 窗口仍完成的断言，并重跑全量门禁。
  - [x] 增加默认三十分钟、集中可配的独立工具执行闸，形成 `timeout{tool}` 明确终局。
  - [x] 修复缺失 tool id 的 FIFO 配对和同一 id 跨生命周期复用。
  - [x] 增加真实 Electron 挂死工具在工具闸到期后停止的断言。
  - [x] 独立 QA 复核工具宽限闸与生命周期配对影响半径。
