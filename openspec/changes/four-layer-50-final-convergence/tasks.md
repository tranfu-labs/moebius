# 任务：four-layer-50-final-convergence

## A · 基线与护栏

- [ ] 固定基线 `ec57cd5`：531 production = view 77 / application 171 / domain 182 / adapter 101；
  file/dependency debt 0、root 9、permit 193；copy debt 6 files / 16 lines / 15 unique semantics
- [ ] 先补行为测试：attachment failure code、edit-resend/team-save sentinel copy；不得断言 locale 文件包含某句原文
- [ ] 异步 attachment 测试覆盖父级 rerender、translator 回调身份变化、慢失败、Abort/stale 返回与恢复
- [ ] 建生产 diff 500 行闸门：`ec57cd5..工作区` 的 `src`/`desktop/src`/`packages/console-ui/src`
  additions+deletions >500 时停止并交回主理人

## B · 唯一生产代码任务

- [ ] 在 zh-CN/en locale resources 增加 15 个对齐 key，覆盖 16 条静态 fallback（service unavailable 共用）
- [ ] attachment client/preview/replacement/upload queue 改为局部稳定 failure code；application commit 使用最新 translator
- [ ] edit-resend 注入 missing-source copy；team-state 只返回 admission 状态，team save 注入 already-saving copy
- [ ] 删除 6 条 `productionCopyDebt` 登记与 debt-only guard 测试；不得增加 `i18n-exempt` 或修改 debt 数字修绿
- [ ] 运行 production-copy guard 与 locale parity：自动发现生产文件无 CJK fallback、无 locale 分支、key/插值一致

## C · 最终核账

- [ ] 写 `convergence-report.md`：全生产 layer 数、零未归属/多归属/debt/stale root、permit 与 domain closure 指标
- [ ] 写 `boundary-oracle-ledger.md`：19 个具体 IB 与 checker stable ID 双向一致；17 个 NI 各有精确 test/RA/data-flow oracle
- [ ] 写 `final-test-ledger.md`：00～50 六批逐 test-name/断言对账，30 契约删除与重构替代分列，空列为 0
- [ ] 对 `docs/architecture/invariants.md` 做 L1/S1/V1/S2 符合度核对；现行 local 不变量不因 GitHub 退役再次删除
- [ ] 按固定 logical-line/职责抽样复测纯逻辑比例，列 domain files/lines、比例区间与剩余非纯分支，不制造单点精度
- [ ] 从同一次完整闸门日志按 final ledger 的真实 I/O 文件集合求 duration 下限；未打印 duration 按 0

## D · 验证与真机

- [ ] `pnpm run test --scope ec57cd5`、相关定向测试、`pnpm check:boundaries`、`pnpm typecheck`、
  desktop build、`pnpm brand:check` 全绿
- [ ] 执行 RA-16：语言错误 fallback、附件失败恢复与发送、停下/重试、A/B 快切、搜索、分析、右栏、
  团队编辑保存、重启持久事实；记录入口、操作、屏幕信号和临时 evidence 路径
- [ ] 明确引用未重叠验收：RA-11R/RA-12R/RA-30D 与 RA-15 不重跑；RA-14 文件管理器/外链/退出协调沿用 40 批
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 Node 24 `pnpm test`，记录各 scope、墙钟、
  真实 I/O 下限及是否达到 ≤110s / ≤40%；未达时解释且收益记 0

## E · 事实源回流准备

- [ ] 按最终机器事实更新 `architecture/after.svg`，回流为 `docs/architecture/four-layer-runtime.svg`
- [ ] 更新 `docs/architecture/module-map.md` 的四层图引用、最终归属/边界说明；IB/NI 与 checker 双向复核
- [ ] 核对 `docs/product/pages/settings.md`、desktop-shell/console-ui specs 与最终行为一致；无产品差异则保持零 spec-delta
- [ ] 最终确认生产 diff additions+deletions ≤500，测试剪枝只有已登记的失义 debt test，工作区无未记录制品

## 验收语句

1. 跑 `pnpm --dir packages/console-ui exec vitest run src/i18n/production-copy-guard.test.ts src/i18n/i18n.test.tsx`
   → 应退出 0；生产文件无 CJK 静态 fallback、无 locale 分支，zh-CN/en key 与插值契约一致。
2. 跑 attachment/edit-resend/team-save 定向测试 → 应退出 0；sentinel failure code/copy 命中原分支，
   parent rerender 与 translator 身份变化后的慢失败只提交当前语言，stale/aborted 返回不显示错误。
3. 跑 `pnpm check:boundaries` 与最终 layer 报告 → 应退出 0；零未归属、零多归属、file/dependency debt=0、
   root/permit 无 stale，19 IB 与 17 NI 均有可重复 oracle。
4. 跑 `pnpm run test --scope ec57cd5`、`pnpm typecheck`、desktop build、`pnpm brand:check`
   → 均退出 0，且生产 diff additions+deletions ≤500。
5. 打开真实 Desktop → Settings 切到 English → 对 attachment endpoint 注入可恢复失败 →
   应看到英文 attachment fallback；切回简体中文后重试同一失败 → 应看到中文 fallback，迟到旧请求不覆盖当前语言。
6. 在同一真实 Desktop 解除失败注入 → 添加并预览真实附件后发送 → 发起运行并“停下”再“重试” →
   应看到附件成功到达、停止终局与重试终局各归正确 run，无重复终局。
7. 在主页面 A/B 会话快速往返并分别保留草稿 → 完成搜索、分析会话、右栏标签与团队成员编辑保存 →
   应看到 selection/草稿/host/tab/team 修改均归正确对象；重启后这些事实与已发送附件保持。
8. QA/主理人复核后跑唯一一次 Node 24 `pnpm test` → 应退出 0并输出四个 scope；报告同一日志的总墙钟与
   真实 I/O duration 下限，目标 ≤110s / ≤40%，未达到时不得删唯一接缝或宣称速度收益。
