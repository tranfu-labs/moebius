# 提案：four-layer-50-final-convergence

## 需求基线

| 文件 | 小节 | 本批关系 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/settings.md` | `语言覆盖范围`、`切换语言` | Moebius 静态错误提示必须随已保存语言切换，用户/Agent/文件内容保持原文 | 已确认，不改 PRD |
| `openspec/specs/desktop-shell/spec.md` | `Desktop-wide static copy follows the saved locale` | Desktop 所有静态错误提示跟随当前 locale | 已实现主路径，本批清最后 16 条 debt |
| `openspec/specs/console-ui/spec.md` | `Type-safe local interface translations` | zh-CN/en key 与插值契约一致，生产静态文案只经 translation key | 已确认，不改 spec |
| `docs/architecture/module-map.md` | 四层归属与 `[IB:*]` / `[NI:*]` | 回流最终机器核账与四层图 | 实现后更新 |
| `docs/architecture/invariants.md` | L1/S1/V1/S2 | 核对最终实现仍满足，不删除现行 local 不变量 | 实现后只核对，预计零改动 |
| `openspec/changes/four-layer-architecture-series/design.md` | 50 批目标与 RA-16 | 最终收口契约 | 本方案细化后交主理人核验 |

`spec-delta/` 保持为空：本批没有新的产品决定，已有 PRD 与现行 spec 已明确要求静态错误提示随 locale。
若实施发现必须改变用户可见语义，停止并另走产品 change，不在最终收敛批里补规格洗白。

## 已核实基线（`ec57cd5`）

- `pnpm check:boundaries` 通过：617 source / 531 production / 3 roots。
- 531 个生产文件唯一归属：view 77、application 171、domain 182、adapter 101；
  `fileDebt=[]`、`dependencyDebt=[]`，composition root 9，exact condition permit 193。
- `production-copy-guard` 仍有 6 个 `desktop/src/console-page/*.ts` 文件、16 行 CJK 静态文案债；
  其中“本地附件服务尚未就绪”出现两次，因此对应 15 个唯一翻译语义。
- guard 基线为 1 file / 3 tests 全绿；其中一条只服务 legacy exact debt 棘轮，债清零后将失去契约意义。
- 40 批完整闸门由主理人独立复现为 122s：root 99/713、slow 1/63、desktop 128/566、console-ui 45/460。

## 背景

00～40 批已经把四层架构债务清零。50 批不再承担架构迁移；唯一生产代码任务是移除 20 批登记、
绑定本 change 的 16 条 copy debt。其余工作是全局核账、测试对账、指标复测、RA-16 和架构事实源回流，
防止“局部 change 都归档但全仓事实源仍不闭合”。

## 提案

1. 把 16 条静态 fallback 文案收敛为 15 个 zh-CN/en translation keys；不增加 `i18n-exempt`，
   不保留或改写 debt 计数。
2. attachment adapter / preview 只抛局部稳定 failure code；application/controller 在提交可见失败时使用
   **当前 render 的** `t` 解析，避免慢请求跨语言切换后提交旧语言。edit-resend 与 team save 通过窄 copy
   参数注入，不让 domain/adapter import locale resources。
3. 生成全生产文件 layer 报告、IB/NI oracle ledger、六批 test-name 总账与固定口径指标报告。
4. 执行 RA-16 联合 smoke；只重做与本批重叠的 RA-05/RA-13/RA-14 子路径，引用未触及的
   RA-11R/RA-12R/RA-30D/RA-15 证据，不为了“更保险”重跑无关 provider 或旧数据验收。
5. checker、测试、真机全部通过后，更新 `architecture/after.svg` 的最终事实并回流为
   `docs/architecture/four-layer-runtime.svg`，在 `module-map.md` 添加引用。

## 影响与停止线

- 预计生产 diff（含 locale data、contracts 与调用接缝）为 140–260 行；用
  `git diff --numstat ec57cd5 -- src desktop/src packages/console-ui/src` 的 additions+deletions 机械复算，
  **超过 500 即停止，不在 50 批继续实施**。
- `LocalConsoleStore`、SQLite/JSONL、provider、HTTP/IPC、Desktop process topology、产品路由与状态机不改。
- 测试预计只删除 1 条已失义的 legacy debt 棘轮测试；全量 CJK 扫描 guard 保留并变强，所有真实 I/O
  接缝测试保留。该删除单列进最终 test ledger，不伪装成纯测试替代。
