# 任务：console-error-visibility

## A · 基线与行为护栏

- [x] 固定 `47f2031` 基线：53 个非 null 写入、除 refresh 外 23 个 null 清除、`app.tsx` 262 逻辑行、
  file/dependency debt 0、permit 193、roots 9
- [x] 先补 `console-error-model` 纯测试：跨来源成功不清、同源成功清除、同源失败替换、stale token 忽略、scope 隔离，
  以及 A 失败 → B 失败 → B 成功后 A 重新可见 → A 成功后清空
- [x] 补 hook/controller 测试：父级重渲染、callback identity 变化、慢旧返回与失败；测试先红后再改生产代码

## B · 错误所有权模型

- [x] 新增纯 `console-error-model.ts`，实现 source/scoped operation 与 begin/fail/succeed reducer；登记为 domain
- [x] 新增 `use-console-error-state.ts`，提供稳定 controller 与 `visibleMessage`；登记为 application
- [x] 在 runtime bridge 内装配 controller，保持 console-ui `lastError` 字符串接口与 `app.tsx` ≤300

## C · 写入方迁移

- [x] 迁移 state-refresh 与 result-acknowledgement；三个成功 poll 不清其他来源，refresh 失败后同源成功可清
- [x] 迁移 desktop-shell、attachment、process-data；draft/tab 并发使用 scoped source
- [x] 迁移 conversation、session-run、new-conversation、edit-resend；现有 send/mutation/stale guard 保持
- [x] 迁移 project、search-navigation、analysis、sidebar-message/sidebar-draft；成功只 settle 本来源
- [x] 审计 22 个承载文件：不再把无来源 `setClientError(string|null)` 穿透 controller 树，53 个写入均有 owner
- [x] 逐项确认测试净删除 0；若旧断言失义，先写 test-name、失义判据与新行为接管证据

## D · 验证与真机

- [x] 定向测试覆盖 reducer、hook、state sync、project/attachment/session/analysis 四类外部行为
- [x] `pnpm run test --scope 47f2031`、`pnpm check:boundaries`、`pnpm typecheck`、desktop build 全绿
- [x] 确认 file/dependency debt 0、permit 193、roots 9，`app.tsx` ≤300，未引入 TTL/真实等待
- [x] 真机执行 CEV-01～04，记录页面入口、操作、可见信号、轮询周期与临时 evidence 路径
- [x] QA/主理人复核后、合并前运行本 change 唯一一次 Node 24 `pnpm test`

## E · 符合度与事实源准备

- [x] 对照 proposal/design 反思：无附件特例、无 refresh-only 漏洞、无 UI/文案扩项、无新 permit/root/debt
- [x] 更新 condition/source 审计与测试 ledger；实现未改变 PRD、wireframe 或 console-ui API
- [x] 准备归档回流：desktop-shell spec delta 与 `architecture/after.svg`

## 实现与验证记录

- 实现提交：`9eeea1a`。生产 diff 相对 `47f2031` 为 +464/−155，共 619 行，落在 350–650
  预算内；`app.tsx` 275 物理行，低于 285 目标及 300 硬门禁。
- 写入审计：53 个 `errors.fail/report`，旧 `setError/setClientError` 为 0；详见 `source-audit.md`。
- 边界账：file debt 0、dependency debt 0、permit 193、composition root 9；`check:boundaries`
  输出 619 source / 533 production / 3 roots。
- 定向闭包：`pnpm run test --scope 47f2031` 退出 0，20 files / 124 tests；全仓 `pnpm typecheck`
  退出 0；desktop build 退出 0（4.26s）。
- 符合度：没有附件特例、TTL 或通知框架；共享错误规则只存在于纯 domain model，React hook 只做状态提交；
  console-ui 仍接收单一 `lastError` 字符串，PRD、wireframe 与组件 API 均未变化。

## 验收语句

1. 打开真实 Desktop 主会话 → 制造项目 mutation 失败 → 不操作等待至少 3.2 秒 → 应持续看到同一可读错误，
   三次成功 state poll 均不得清除它。
2. 保持上述项目错误 → 成功完成另一来源的附件预览或会话搜索 → 应仍看到项目错误；不得因无关成功消失。
3. 先让来源 A 失败、再让来源 B 失败 → B 应成为当前错误；B 重试成功 → A 应重新可见；A 再成功 →
   错误才清空。stale 返回与父级重渲染后结论不变。
4. 切到 English 触发附件失败并等待三个 poll → 应持续看到英文错误；切回简体中文后重新触发同类失败 →
   应持续看到中文错误，均无需 MutationObserver 才能读到。
5. 跑 error model/hook/state-sync/controller 定向测试 → 应退出 0，并覆盖跨来源、同源恢复、stale、父级重渲染、
   callback identity 变化、慢返回和失败。
6. 跑 `pnpm run test --scope 47f2031`、`pnpm check:boundaries`、`pnpm typecheck` 与 desktop build →
   应全部退出 0；file/dependency debt 仍为 0、permit 193、roots 9、`app.tsx` ≤300。

## CEV-01～04 真机记录（QA）

环境：dev Electron（`MOEBIUS_DATA_ROOT=/tmp/moebius-ra10-zT1Ozl` 临时数据根，零 mock），ADR-0002
CDP 9222 attach 真实窗口；Node v24.18.0。失败构造：团队保存＝`.state/agent-teams/` 目录只读
（EACCES，原子 rename 落盘失败）；附件恢复＝删除附件记录的 preview 文件使恢复链路 404。
**全部断言均为直接读取屏幕文本，未使用 MutationObserver。** 驱动脚本与日志留于临时数据根
`driver/` 与 `electron-cev*.log`。

- **CEV-01（跨轮询持续可读）通过**。Agent 团队 → 通用助手（用户副本）→ 改思考程度并保存，
  保存因目录只读失败。错误条（EACCES 原文）在 t+0/2/4/6/8s 五次探测均原样可见，跨越约 8 个
  1 秒轮询周期未被清除。
- **CEV-02（跨来源成功不清错）通过**。团队保存错误保持可见期间，完成一次成功的会话搜索
  （「薄荷糖」命中会话 A 并返回结果），错误在搜索后与 +2.5s 后均仍在。
- **CEV-03（同源成功消错 + 遮蔽恢复）通过**。完整序列实测：A＝团队保存错误可见 → B＝新会话
  草稿附件恢复失败（"附件预览读取失败。"）替换 A → 恢复 draft:new 两条记录的 preview 后重开
  新会话，B 恢复成功（composer 出现两个附件 chip 与缩略图），B 错误清除 → **A（团队保存错误）
  按遮蔽修复设计重新浮现**（会话页以「操作台遇到问题，请打开开发者诊断查看日志。」通用条
  呈现，与 console-ui 单字符串契约一致）→ 恢复目录可写后同源保存成功，全部错误清空，
  「用户覆盖」标记确认保存真实生效。
- **CEV-04（中英文持续显示）通过**。英文界面下触发附件预览恢复失败：
  "The attachment preview could not be loaded." 在 t+2/3.8/5.8/7.8s 均直接可读；切简体中文后
  重新触发："附件预览读取失败。" 在 t+2/4.5/7s 均直接可读，无英文残留。两语言均无需
  MutationObserver 即可读——50 批 RA-16 观察到的「约 1 秒被刷新清掉」已消除。

**观察项（不阻塞）**：①团队保存这类 IPC 失败的文案是原始 `Error invoking remote method …EACCES`
英文串，未本地化——与 50 批已接受的「已显示错误文案形态」一致，非本 change 范围；②同一错误
在团队页呈现为具体文本、在会话页呈现为通用条＋诊断入口，是既有分面设计，两种形态均满足
持续可读。

## 合并点完整闸门与实施复核（dev-manager）

- Node 24.18.0，同一工作区，**退出码 0，总墙钟 124s，一次通过无返工**：root 99 files / 713 tests
  （另 1 file / 4 tests skipped）、slow 1 / 63、**desktop 130 / 578**、console-ui 45 / 459。
  较本 change 基线 desktop +2 文件 / +7 用例，与新增 error model / hook 测试吻合；测试删除 0。
- `check:boundaries` 619 source / 533 production / 3 roots 全绿；`fileDebt=0`、`dependencyDebt=0`、
  condition permits **193**、composition roots **9**，四项均无变化。
- `app.tsx` **262 逻辑行**（目标 ≤285，硬门禁 300），未因本 change 增长。
- 生产 diff **621 行**，落在 350–650 预算内。`.tsx` 中已无裸 `setClientError(...)` / `setError(...)` 写入。

### 必改项落实情况：优于要求

评审要求「保留每个 source 的未解决错误，清除后渲染剩余最新一条」。实现没有采用「维护当前可见错误字段、
在清除时补救」的做法，而是把可见错误做成对 `unresolvedBySource` 的**纯选择器**：

- `console-error-model.ts:34` `unresolvedBySource: Readonly<Record<string, ConsoleErrorEntry>>`；
- `succeedConsoleErrorOperation` 只 `delete` 本 source 条目；
- `selectVisibleConsoleError` 遍历剩余条目取 `publishedSequence` 最大者。

因此「B 成功后 A 重新浮现」不是一条需要记得处理的分支，而是选择器的自然结果——**该场景在结构上
不可能被漏掉**。另注：`consoleErrorSourceKey` 以 `\u0000` 分隔 family 与 scope，避免字符串拼接碰撞。

### QA 真机验收

CEV-01～04 全部在真实 dev Electron 通过，**全程直接读屏、未使用 MutationObserver**——50 批 RA-16 中
需要 MutationObserver 才能捕获的现象已消除。其中 CEV-03 按评审指定的完整遮蔽序列实测：
A（团队保存 EACCES）→ B（附件恢复失败）替换 → B 恢复成功后 B 错误清除且 **A 重新浮现** →
同源保存成功后全部清空。

QA 用目录只读构造 EACCES（发现文件只读挡不住原子 rename 后改的方法），并在 B 恢复首次未成功时
定位到 `draft:new` 下有两条附件记录而只修了一条，补齐后恢复链才真正成功——这使「B 成功」的判据
落在真实 UI 事实（两个附件 chip 与缩略图出现）上，而非请求返回码。

两个观察项如实记录且不阻塞：IPC 类失败文案仍是未本地化的原始英文错误串（与 50 批已接受形态一致，
不在本 change 范围）；同一错误在团队页显示具体文本、在会话页显示通用条加诊断入口，属既有分面设计，
两种形态均满足持续可读。
