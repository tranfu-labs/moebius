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
- [ ] 真机执行 CEV-01～04，记录页面入口、操作、可见信号、轮询周期与临时 evidence 路径
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 Node 24 `pnpm test`

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
