# 四层最终收敛报告

基线：`ec57cd5`（40 批归档）；实现检查点：`7fe13e8`。本报告的机器计数来自
`src/testing/four-layer-registry.ts` 与 `pnpm check:boundaries`，不从历史报告反推。

## 1. 全生产文件归属

| layer | 文件数 | 责任 |
| --- | ---: | --- |
| view | 77 | 状态到显示、交互 intent |
| application | 171 | use case、端口编排与时序 |
| domain | 182 | 纯值规则与决策 |
| adapter | 101 | fs、SQLite、provider、HTTP/IPC、browser/Electron |
| **合计** | **531** | 每个生产文件 exactly one layer |

`pnpm check:boundaries`：617 source / 531 production / 3 roots，退出码 0。机械不变量：

- 未归属文件 0，多归属文件 0；
- `fileDebt=0`，`dependencyDebt=0`；
- composition roots 9，全部存在且命中 exact allowlist；
- exact condition permits 193，permit key 唯一且无 stale；
- 19 个 `[IB:*]` 与 checker stable ID 双向一致，17 个 `[NI:*]` 均有重复可执行的 oracle，见
  `boundary-oracle-ledger.md`。

## 2. 纯逻辑比例

按 00 批固定口径，logical line 是去掉空行和纯 `//` 行后的行数；domain closure 当前为
**182 files / 19,323 logical lines**。00 批 10,024 行经人工职责抽样校准为 34–41%，沿用同一比例尺：

- 下界：`19,323 / 10,024 × 34% = 65.5%`；
- 上界：`19,323 / 10,024 × 41% = 79.0%`；
- 最终报告区间：**65–79%**。

该区间达到系列保守目标 68% 的主体范围，但下界低于目标 3pp；不把 DTO、常量或文件迁移包装为精确
业务规则收益，也不为了抬高下界继续移动代码。剩余非纯分支主要是 application 时序、adapter codec/
transport control 与 193 条外部协议 exact permit；这些不是 50 批允许继续重构的范围。

## 3. Copy debt 与生产预算

- `production-copy-guard`：6 文件 / 16 行 exact debt → **0**；15 个语义进入 zh-CN/en locale resources。
- 生产静态 fallback CJK 扫描 0，locale 条件分支 0；动态服务端错误、用户内容、Agent 内容和文件名仍原样保留。
- 生产 diff（`75022b6..7fe13e8`，`src` / `desktop/src` / `packages/console-ui/src`）：
  additions 225 + deletions 129 = **354**，低于 500 硬停点。
- `app.tsx` 275 物理行并继续通过 composition-root ≤300 门禁；`runtime.ts` 未改。

## 4. 系统不变量复核

| 不变量 | 结论 | 证据 |
| --- | --- | --- |
| L1 单点故障不永久停转 | 保持 | attachment 慢失败、Abort/stale 与恢复测试；RA-16 将重做失败→恢复 |
| S1 用户指令与公开回复不丢 | 保持 | 本批不改消息 cursor/run 归属；RA-16 重做停下/重试与附件发送 |
| V1 失败与降级可见 | 加强 | fallback 以当前 locale 提交；已显示错误不实时重译是 design 已记录的接受后果 |
| S2 退役能力不破坏历史数据 | 保持 | 本批不触及启动、SQLite schema 或历史 GitHub state；引用 RA-30D |

L1/S1/V1/S2 均仍是现行 local 不变量，未因 GitHub runner 退役再次删除或改写。

## 5. 测试与闸门

实现检查点已通过：

- desktop 定向：6 files / 26 tests；
- copy guard + locale parity：2 files / 6 tests；
- `pnpm run test --scope ec57cd5`：61 files / 573 tests（25/159 + 36/414）；
- `pnpm typecheck`；
- `pnpm check:boundaries`；
- desktop build；
- `pnpm brand:check`（7 个生成产物与 manifest 一致）。

六批测试增删与真实 I/O 固定集合见 `final-test-ledger.md`。合并点完整 `pnpm test` 只在 QA/主理人
复核后运行；以下数据届时从**同一次 Node 24 日志**回填，当前不预填或挑选快样本：

| 指标 | 合并点实测 |
| --- | --- |
| root / slow / desktop / console-ui | 待合并点唯一一次完整闸门 |
| 总墙钟 | 待测；目标 ≤110s，未达则解释且收益记 0 |
| 固定真实 I/O 文件 duration 下限 | 待同一日志提取；未打印 duration 按 0 |
| I/O 下限 / 总墙钟 | 待测；目标 ≤40%，不以删唯一接缝修指标 |

## 6. RA-16 重叠半径

- 必须重做：RA-05 语言、RA-13 attachment、RA-14 团队成员保存子路径；
- 联合短 smoke：RA-01/02、RA-05a、RA-08/09/10；
- 不重跑并引用：RA-11R/RA-12R/RA-30D（启动与历史数据无重叠）、RA-15（三家 provider/session link
  无重叠）、RA-14 文件管理器/外链/退出协调（无重叠）。

QA 真机记录完成前，本 change 保持 in-progress，不声明 code-verified。
