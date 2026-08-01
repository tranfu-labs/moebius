# 任务：four-layer-20-desktop-renderer

## A · 基线与 ledger

- [x] 冻结 settings/onboarding/team 与 conversation/search/sidebar 现有行为矩阵
- [ ] 从系列 design 复制 20 批五条精确 test-name 映射，建立 ledger；补齐 duration、最终替代纯测试和删除/保留结论，标出必须保留的 fetch/IPC/React 接缝

## B · Shell/team 纵切

- [ ] 提取 settings/onboarding/team/builder application controllers 与纯 state models
- [ ] 把 preload/localStorage/subscription 收敛为 adapters
- [ ] 覆盖 stale owner、generation、慢/失败返回和父级重渲染

## C · Conversation 纵切

- [ ] 提取 selection/route/search/process/analysis/project/session/sidebar controllers
- [ ] 把 HTTP/browser storage/timer 收敛为 adapters
- [ ] `app.tsx` 收为 exact composition root + view prop mapping，删除对应 layer debt

## D · 验证与真机

- [ ] 按 ledger 剪枝重复重型组合，保留唯一接缝
- [ ] scope、定向测试、typecheck、desktop build 全绿
- [ ] 执行 RA-05、RA-05a～RA-10 并按真机协议记录；RA-05a 必须记录 A/B 草稿、pending 发送禁用、最终 selection/未读及重启事实
- [ ] 报告纯比例、闸门耗时和集成测试净变化
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

## 行为矩阵基线

| 旅程 | 保持不变的外部行为 | 失败/迟到边界 | 真机 oracle |
| --- | --- | --- | --- |
| settings | 语言、更新、复制反馈只归最新请求；重启保持语言 | 旧请求不得覆盖新状态 | RA-05 |
| sidebar/conversation | A/B 草稿各归 owner；pending 禁发；最终 selection/未读按最新 generation 提交 | 慢切换、快速往返、创建失败恢复旧 route/draft | RA-05a |
| team/builder | 切换、编辑、保存反馈只归目标团队/成员 | owner 改变或迟到保存不得串写 | RA-06 |
| onboarding | 回看后保持原 selection、草稿与右栏；readiness 只接受最新 sequence/revision | 初始检查、full snapshot 迟到不得回退 | RA-07 |
| search | 第二条件成为当前结果与 route host | 第一请求迟到不得抢回 | RA-08 |
| analysis | 消息/会话分析结果归正确 host 标签并可继续发送 | 离开入口后的迟到结果不得抢页面 | RA-09 |
| right sidebar | 改动/文件/过程/子任务/会话标签按 host 保持 | refresh 不得改写用户当前标签 | RA-10 |

## test-name ledger

三次样本使用 Node 24.18.0、desktop Vitest 单 worker 与精确 test-name filter，日期 2026-08-02。

| 原集成测试 | 三次 duration / 中位数 | 新纯测试 | 等价决策分支 | 保留接缝 | 当前结论 |
| --- | --- | --- | --- | --- | --- |
| `console-app-sidebar-conversation-regressions.test.tsx` · `keeps a target-owned draft editable across a slow switch and parent rerender while blocking send` | 88/72/74ms · **74ms** | `console-conversation-controller.test.ts` · `keeps target draft ownership through rerender and blocks send during slow selection` | draft owner、pending phase、父重渲染/callback identity | mounted React receiver + slow fetch | 待建纯测试；保留原接缝 |
| 同文件 · `serializes rapid round trips and clears both unread badges without stale selection writes` | 38/35/36ms · **36ms** | `console-navigation-controller.test.ts` · `serializes rapid round trips and commits unread state only for the latest selection generation` | generation、队列、stale write 丢弃 | mounted app + HTTP receiver | 待建纯测试；保留原接缝 |
| 同文件 · `keeps the previous route and draft when ordinary conversation creation fails` | 18/18/18ms · **18ms** | `console-navigation-controller.test.ts` · `rolls back pending creation to the previous route and draft on failure` | create pending → failure 回滚 | mounted fetch failure → 可见反馈 | 待建纯测试；保留原接缝 |
| `onboarding-app-routing.test.tsx` · `keeps the later shell PATH recheck when the initial check resolves last` | 24/24/24ms · **24ms** | `onboarding-readiness-controller.test.ts` · `rejects an older initial readiness result after a newer PATH recheck` | request sequence 丢弃初始迟到结果 | mounted onboarding + PATH status receiver | 纯测试已建；原接缝保留 |
| 同文件 · `does not let an older full readiness response overwrite newer per-CLI results` | 6/6/6ms · **6ms** | `onboarding-readiness-controller.test.ts` · `merges newer per-CLI results without accepting an older full snapshot` | revision 合并拒绝旧 full snapshot | preload readiness/install receiver | 纯测试已建；原接缝保留 |
