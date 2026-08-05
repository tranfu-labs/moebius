# 设计：extend-local-tool-deadline-2h

## 方案

### 统一配置与实际覆盖链

只保留一个连续工具在途区间上限的解析来源，并复用现有 wiring；区间本身的开始、结束和并行工具计时规则不在本 change 改动：

```text
src/config.ts
  └─ startLocalConsoleServer 的默认 fallback
      └─ LocalConsoleRuntime / runtime-run-wiring
          ├─ primary-provider-wiring
          └─ worker-provider-wiring
              └─ planLocalProviderExecutionOptions
                  └─ execution-driver
                      ├─ runCodex(... toolTimeoutMs)
                      ├─ runClaude(... toolTimeoutMs)
                      └─ runKimi(... toolTimeoutMs)
```

解析规则固定为：

- 连续工具在途区间从 open-tool 集合由空变为非空开始，到集合再次清空结束；区间内新增或结束部分并行工具不重置 deadline。
- 未设置 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` 时，值是精确的
  `7_200_000` 毫秒（两小时）。
- 设置为正整数时，完整保留并传递该值；该环境变量名称不变。
- 空字符串仍按未设置处理；非整数、零和负数继续触发现有配置错误，不得被解释为无限等待。
- primary、worker、analysis、full 和 resume 使用同一解析值；Codex、Claude、Kimi 不设不同默认值。
- 现有 progress idle、provider busy、long-run report 和 managed-process 的窗口、触发、收束与生命周期语义不变；`LOCAL_RUN_IDLE_TIMEOUT_MS`、`LOCAL_PROVIDER_BUSY_TIMEOUT_MS`、`LOCAL_LONG_RUN_REPORT_MS`
  及 Kimi 独立的 managed-process settle 上限不进入本次改动。

这样可以确保默认值不会因某一 provider、某一种恢复路径或某一个成员 wiring 漏传而失效，也不会把用户配置的工具上限误当成总 run 时长、idle 窗口或 managed process 生命周期。

### 自动回归证据

新增独立的 `tests/local-tool-deadline.test.ts`，不改写六个既有修复文件中的其他五个文件；正式验收脚本仅将 A13 的动态标题断言改为稳定终态行为断言：

1. 通过隔离子进程在覆盖值为空（等价于未配置）时加载配置，断言
   `LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS === 7_200_000`。这条断言是“产品默认两小时”的独立证据，不依赖真实运行等待两小时。
2. 通过隔离子进程设置一个短的正整数覆盖值，断言配置和启动 wiring 使用该值；同时覆盖非法配置仍失败，证明没有取消有限上限。
3. 用确定性 provider runner 捕获 execution-driver 的调用参数，分别断言 Codex、Claude、Kimi 收到同一个覆盖值，并覆盖 full/resume 或其共享调用入口，避免测试只读配置常量而没有证明实际覆盖面。
4. 复用既有 Codex 正常长工具与挂死工具测试：在测试覆盖值下，连续在途区间中的正常工具运行时间超过现有空转窗口仍成功，挂死工具收到 `timeout{tool}` 并释放运行；不另写只复制已有断言的镜像用例。

### 验收矩阵

| 行为 | 运行方式 | 必须观察到的信号 | 证明内容 |
| --- | --- | --- | --- |
| 精确默认值 | 隔离配置子进程，不设置覆盖环境变量 | 读取到 `7_200_000` 毫秒 | 默认确实是两小时，不靠等待推断 |
| 环境覆盖 | 隔离配置子进程设置 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` 为短正整数 | 读取值和 provider 调用参数与覆盖值完全相同 | 覆盖能力保留且三家共用 |
| 真挂死工具 | 自动测试用短覆盖；真实 Electron 也用 `15_000` 毫秒覆盖 | 页面显示工具运行过久的终局，`activeRuns` 释放，非成功 | 有界看门狗仍然工作 |
| 正常长工具 | 真实 Electron `scripts/acceptance/local-runtime-supervision.ts`，使用既有短 idle 覆盖和 `15_000` 工具上限 | `LONG_TOOL_SUCCESS` 出现；运行时间超过现有空转窗口；无 timeout；活动块最终消失 | 连续工具在途区间不会被空转窗口提前停止 |
| 其它监督语义 | 同一真实 Electron 验收 | pseudo-idle 仍是 idle timeout；provider busy 仍按既有窗口；long-run report 只报告不停止 | 本 change 未扩大到其它窗口 |
| managed process | 既有 managed-process 验收/回归不变 | 启动、持续运行和退出语义不受普通工具默认值影响 | 没有把两小时误套到托管进程 |

真实 Electron 的页面入口是生产桌面主会话；页面可断言活动行出现、`LONG_TOOL_SUCCESS`、无 timeout、`active-run-block` 最终为 0，以及挂死工具的中文超时反馈。该脚本生成系统临时 evidence 路径。它使用短覆盖值来控制验证时长；两小时默认只由上述隔离配置证据证明。

过程页的「已暂停跟随」是合法的动态阅读状态：scroll model 在视口不在底部时暂停自动跟随，不代表过程仍在运行或执行未完成。因此正式 A13 不依赖「只读完整过程」标题，而断言过程文本包含工具的 `completed` 事实、没有 `running` 状态，run 已完成且活动块已释放；随后同一正式脚本继续断言挂死工具触发独立 deadline。一次性系统临时 Electron harness 仍可作为同一行为的补充证据，但不替代正式入口。

### 验证顺序

实现放行后先运行新定向测试、受影响 scope、`pnpm typecheck`、`pnpm check:boundaries` 和必要的真实 Electron 验收；长输出写系统临时日志。QA 独立复核通过后，按仓库规则对本 change 只运行一次完整 `pnpm test`，不得用重复全量测试替代定向证据。

## 权衡

- 选择两小时有限上限，接受真正挂死的默认发现时间变长，以换取大型正常工具不被 30 分钟硬截止误杀；保留环境覆盖和有限 deadline，避免无限占用会话。
- 选择集中配置并沿现有 wiring 传递，放弃为三家 provider 分别设置不同默认值；这样 provider 行为一致，恢复和专业成员路径不会悄悄漂移，同时保留既有连续在途区间计时语义。
- 选择隔离配置证据加短值真机验收，放弃让 Electron 测试真实等待两小时；前者直接证明数值，后者验证用户入口和运行链，整体证据更快且可重复。
- 选择复用既有正常长工具、挂死工具与 managed-process 测试，避免为同一分支新增镜像测试；新增测试只锁定本次真正改变的默认值、覆盖值和三 provider 传递。

## 风险

- 默认挂死工具要到两小时才会被收束。风险由“仍有明确有限上限”、本地覆盖能力和短值故障测试缓解；产品不承诺无限等待。
- 如果某条 provider 或 resume wiring 漏传配置，可能退回 adapter 自身默认或错误的 idle 行为。三 provider 参数捕获测试和真实 Electron 的长/挂死路径用于阻止该回归。
- 配置是 import-time 解析。测试必须使用隔离子进程分别验证缺省、覆盖和非法值，避免同一测试进程的 module cache 造成假绿。
- 回滚只需恢复默认 fallback 为 30 分钟；不需要数据迁移、页面回滚或 managed-process 清理。
