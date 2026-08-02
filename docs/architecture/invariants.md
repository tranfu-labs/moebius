# 系统级不变量清单

本文件是 moebius 的系统级不变量事实源：qa 做测试设计审查时的判定标准（oracle），也是 dev / dev-manager 设计方案时的约束。它独立于任何单个方案存在——评审方案时，用本清单裁决"方案没说的"，而不是只验证"方案做到了它自己说的"。

## 维护规则

- 新增 / 修订 / 删除不变量走 openspec change 流程。
- qa 在审查中发现清单外的新故障类时，在本地共享时间线提出补丁建议，经人类确认后合并；qa 不得直接修改本文件。
- 每条不变量带稳定编号（L / S / V + 序号），供缺陷挂靠引用；编号只增不复用。

## 不变量

### L1（liveness）：任何单点故障不得使本地会话永久停转

任何单点故障——provider 永久挂起、子进程崩溃、SQLite 锁、文件系统变慢——都不得使 local runtime、其他会话或同一会话后续可恢复动作永久停转。

推论：每个外部调用必须有超时、AbortSignal 或看门狗兜底；活动 run、claim 与恢复意图必须在退出、失败或重启后收敛。凡靠“对方一定会返回”维持推进的设计，都是对未验证经验假设的裸依赖。

出处：历史 GitHub runner 的挂起事故首次暴露该故障类；runner 退役后，不变量继续约束 local provider、SQLite、工作区与进程生命周期。

### S1（safety）：用户指令与公开回复不丢

用户消息只有在产生持久的 Agent 回复、明确 no-action、可见失败或可恢复终局后才推进处理位点；provider 成功但回复未落库时不得推进 per-Agent cursor。任何处理失败都必须保留原消息、run/attempt 归属和可恢复入口。

出处：local console 的 SQLite/JSONL 双事实接缝、canonical provider session 与 restart recovery 设计。

### V1（visibility）：失败与降级必须可见

系统放弃、暂停或降级任何本地动作时，必须在对应会话或状态页留下可恢复的可见事实；重启后该事实仍可观察。可见失败路径本身受 L1 / S1 约束——“这一步没跑起来”的信号不能因为同一场故障而沉默。

出处：local console 的 interrupted/stuck/failed/recovery 终局与真实运行验收。

### S2（safety）：退役能力不得破坏历史数据

删除 GitHub runner 的代码、命令和 UI 不得 drop、truncate、迁移或重写既有 GitHub state 文件/表。local CLI 与 Desktop 可以忽略这些历史事实，但启动前后文件哈希与逐表行数必须保持不变。

出处：`four-layer-30-github-runner` 删除类变更的 RA-30D。
