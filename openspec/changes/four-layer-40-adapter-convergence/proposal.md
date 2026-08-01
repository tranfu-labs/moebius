# 提案：four-layer-40-adapter-convergence

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `openspec/specs/desktop-shell/spec.md` | desktop main/team/onboarding/provider/IPC Requirements | adapter 行为保持 | 无变更 |
| `openspec/specs/local-console/spec.md` | store/provider/process/observer 接缝 | adapter 行为保持 | 无变更 |
| `openspec/specs/github-issue-runner/spec.md` | GitHub/provider/state/media 接缝 | adapter 行为保持 | 无变更 |
| `openspec/specs/goal-ledger/spec.md` | ledger state adapter | schema 与原子性保持 | 无变更 |
| `openspec/changes/four-layer-architecture-series/design.md` | `40 · Adapter convergence` | 本 change 系列契约 | 待主理人核验 |

`spec-delta/` 保持为空。本 change 不修改数据层端口、schema、CLI/IPC/API 协议。

## 背景

前三个执行 change 处理最大的 application 容器后，剩余 layer debt 会集中在 desktop main/team/
onboarding、provider/GitHub/state/media/observer adapters 及“读取外部 shape + 内联业务判据”的共居模块。
这些模块不能仅因使用 IO 就整体免于分层，也不能仅因体量大就重画数据层。

## 提案

- 逐项清理剩余 domain/application → concrete adapter 反向依赖。
- 外部 wire/storage/process shape 的纯 parser/classifier 原样析出到 domain；实际 IO 留 adapter。
- desktop main、preload、server、runner entry 继续作为 exact composition roots。
- 保留 `LocalConsoleStore`；不按行数拆 `sqlite-state-worker.ts`，只在发现真实领域判据时提取。
- 对 adapter parser 的纯组合做 test-name 对账，原子性、安全路径、进程、IPC 和 HTTP 接缝继续集成测。

## 影响

覆盖尚未迁移的 `src/**`、`desktop/src/**`、observer/provider/state/media 和 composition roots；
console-ui 与已完成 application flows 不重写。

## 真实验收环境前提

| 前提 | 开工前机械核对 | 不满足时的影响 |
| --- | --- | --- |
| `codex` CLI 已安装、认证有效且额度足够完成一次新调用和一次 resume | 记录版本与最小额度探针结果，不记录凭证 | Codex 对应 RA-15 链路标记“未验证”；不能证明真实 transcript/link/resume |
| `claude` CLI 已安装、认证有效且额度足够完成一次新调用和一次 resume | 同上，独立记录 Claude 结果 | Claude 对应 RA-15 链路标记“未验证”，不影响 Codex/Kimi 或 RA-13/RA-14 |
| `kimi` CLI 已安装、认证有效且额度足够完成一次新调用和一次 resume | 同上，独立记录 Kimi 结果 | Kimi 对应 RA-15 链路标记“未验证”，不影响 Codex/Claude 或 RA-13/RA-14 |
| Electron 开发态可启动，preload/IPC 与 provider 原生过程记录页面可用 | 从真实桌面入口完成一次不计结论的只读可达性检查 | RA-14 与全部 provider 的页面观察不可完成；纯 parser/port 测试仍可运行 |
| 网络与 provider 服务在验收窗口可用 | 每个 provider 调用分别记录开始、终局或明确外部失败 | 外部故障不得伪装成产品通过；对应 provider 只记“未验证” |

各 provider 前提按链路独立判定，不以其中一个通过代替另外两个。缺失项不会改变本批代码范围，但会
留下真实进程/额度/原生 transcript 接缝的证据缺口；究竟阻断合并/归档，还是允许标记“待真机验收”
后补，由用户/主理人在 40 批开始前决定。
