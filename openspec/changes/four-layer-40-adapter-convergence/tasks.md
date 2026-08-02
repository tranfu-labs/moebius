# 任务：four-layer-40-adapter-convergence

- [x] 导出 30 change 后剩余 layer debt，按外部边界分组并逐项归属
  - [x] provider / infra：8 文件，1,502 条 AST 条件、214 条未分类，目标 1,438 / 0；见 `provider-infra-cluster-ledger.md`
  - [x] ai-team-builder：5 个主体文件 1,252 逻辑行 / 126 条原始 AST 条件；目标原文件 <=926 行 / <=49 条，清除 5 条 file debt 与 2 条 dependency debt；见 `ai-team-builder-cluster-ledger.md`
  - [x] desktop team-* 与其他 desktop root：14 个 file debt 文件 4,711 逻辑行 / 626 条原始 AST 条件，
    98 条去重违规，目标旧文件 <=420 条 / 0 违规；见 `desktop-team-cluster-ledger.md`
- [x] 开工前逐项核对 Codex/Claude/Kimi 认证与额度、Electron 页面可达性和网络前提；记录用户/主理人对缺失前提的合并/归档策略
- [x] 建 parser/classifier test-name ledger，列明不可删除 IO 接缝；见 `test-name-ledger.md`
- [x] 清理 desktop main/team/onboarding/IPC/browser storage 共居判据
- [x] 清理 provider/files/trusted JSONL/workspace/attachment 共居判据
  - [x] provider / infra 第一簇：8 条 file debt 清零，150 条 exact permit、64 条账面业务条件下沉，测试净删除 0
  - [x] ai-team-builder 第二簇：5 条 file debt + 2 条 dependency debt 清零，root 454→84 逻辑行，permit/root 净增 0，测试净删除 0
- [x] 清理 local SQLite/JSONL state、HTTP server 与 composition root 共居判据
- [x] 保持 `LocalConsoleStore` API/schema 不变，删除本 change 对应 debt
- [x] scope、定向测试、typecheck、desktop build 全绿
- [x] 执行 RA-13～RA-15，报告环境前提和真实观察
- [x] 报告纯比例、闸门耗时与速度净收益（允许为零）
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

## 实施收口记录

- 30 批彻底收口后的机械基线为 dependency debt 6 + file debt 27 = **33 条**，按三簇归属为
  provider/infra 8、ai-team-builder 7、desktop team/root 18；本批最终 **33 → 0**。所有生产文件仍有唯一层归属。
- provider/infra：150 条不可约 codec/transport/命令分派条件登记为 exact permit，permit 总数 **43 → 193**；
  每条仍以 `ruleId:file:exportName:fingerprint` 独立展开并受 stale 棘轮约束。64 条账面业务条件下沉到纯 plan，
  未靠拆 adapter 分摊条件数。
- ai-team-builder：五个主体文件 1,252 → **799** 逻辑行；`index.ts` 454 → **84**，条件 55 → 5；
  permit 净增 0、root 净增 0。desktop team/root：`main.ts` 586 → **248**，AST 条件 50 → **0**；
  permit 保持 193、composition root 保持 9。
- `LocalConsoleStore` 名称、方法和 schema 未改；SQLite worker 的动态加载、JSONL 原子性、provider 进程、
  Electron IPC/shell 与 team storage 接缝测试全部保留。测试删除 **0**；纯测试只增加决策覆盖，具体对账见
  `test-name-ledger.md`。
- provider 前提按主理人默认策略逐家独立处理：不可用则只把对应 RA-15 标记“待真机验收”，不以另一家抵扣。
  实际 QA 核对 Codex 0.146.0、Claude 2.1.220、Kimi 0.31.0 与 Electron 页面均可用，三家新调用和 resume
  已全部真机通过，故无待验项。
- Node 24.18.0 迭代闸门：`pnpm run test --scope cfade85` 为 **36 files / 189 tests** 全绿；
  `pnpm check:boundaries` 为 **617 source / 531 production / 3 roots** 全绿；`pnpm typecheck` 与
  `pnpm --filter @moebius/desktop build` 均退出码 0。
- 按 00 批同一 logical-line 口径，30 批彻底收口后的 domain closure 基线为 **154 files / 17,112 lines**；
  本批为 **182 files / 19,289 lines**，增加 28 files / 2,177 lines。沿用 00 批 10,024 行对应 34–41% 的
  职责抽样校准，纯逻辑/业务规则约从 **58–70%** 升至 **65–79%**，增幅约 **7–9pp**；这是区间估计，
  不把 DTO/常量迁移算作精确收益。
- 首次合并点 `pnpm test` 于 116s 在 desktop scope 因一条正向源码位置镜像断言失败，未形成可比全绿样本；
  修复后完整闸门数据见下方“合并点重跑”。本 change 测试净删除 0，无法从 test-name 中归因速度收益，
  因此速度净收益按方案记 **0**。

## 簇 3 提交清单（自账目核验起）

1. `7813b10 test(desktop): define onboarding orchestration plans`
2. `40301e1 refactor(desktop): separate onboarding orchestration storage`
3. `75ba4c3 test(desktop): define team management domain plans`
4. `f019474 refactor(desktop): extract team management decisions`
5. `a0d11d3 test(desktop): define team storage decisions`
6. `bbbc834 refactor(desktop): extract team storage policies`
7. `6417032 refactor(desktop): separate team desktop action plans`
8. `d0b9758 refactor(desktop): inject conversation preference ports`
9. `65d85be refactor(desktop): inject team runtime binding ports`
10. `717bb2d refactor(desktop): compose agent team application services`
11. `d005345 refactor(desktop): isolate main process IPC registration`
12. `a2c011e refactor(desktop): extract window runtime adapter`
13. `80b77e6 refactor(desktop): extract local console orchestration`
14. `52d8a44 refactor(desktop): extract shutdown coordination`
15. `d4a13fa refactor(desktop): extract startup orchestration`
16. `514fbd9 refactor(desktop): bundle team adapter ports`
17. `f8495e7 refactor(desktop): narrow main process composition root`

## RA-13～RA-15 真机记录（QA）

环境：dev Electron（`MOEBIUS_DATA_ROOT=/tmp/moebius-ra10-zT1Ozl` 临时数据根，零 mock），ADR-0002
CDP 9222 attach 真实窗口操作与断言；Node v24.18.0。provider 前提逐家核对：Codex CLI 0.146.0
（ChatGPT 订阅登录）、Claude Code 2.1.220（`~/.claude/.credentials.json` 在）、Kimi CLI 0.31.0
（`~/.kimi-code/bin/kimi`，凭据在）——三家全部可用，无「待真机验收」项。驱动脚本与启动日志留于
临时数据根 `driver/` 与 `electron-ra40*.log`。

- **RA-13 通过（附件生命周期）**。入口＝会话 C composer；操作与观察＝经隐藏 file input 挂
  `ra13-probe.txt`（PLAIN · 95 B）与 `ra13-probe.png`（64×64 手造渐变图）；PNG 在 composer 渲染
  真实缩略预览（blob URL、126px `<img>`）。发送「附件文本文件里列了哪些备件？」后 agent 回复
  「灯泡：2 透镜：1 密封圈：4」，与附件原文逐字相符——附件内容真实到达 provider。重启应用后
  已发送消息仍展示两个附件且 PNG 预览重渲染；附件存储 `.state/local-console-attachments/` 两条
  记录（metadata/content/preview）完好。删除生命周期：草稿侧新挂附件经「Remove attachment」移除
  后 chip 消失，已发送消息的附件不受影响（归属正确），存储无孤儿增长。
- **RA-14 通过（团队 / 文件管理器 / 外链 / 退出协调）**。
  团队：Duplicate team 生成「通用助手 · User team」用户副本，可编辑运行时配置。
  文件管理器：项目菜单「Show in file manager」后 `lsappinfo front` 实测 Finder 前台化；把项目
  文件夹移走后，会话内出现持久系统通知「项目文件夹找不到了，修复后才能继续。」（可恢复语义），
  状态层报 `workspaceUnavailableReason=not-git-repository`；文件夹移回后不可用标记清除。注：
  `shell.showItemInFolder` 对缺失路径本身静默，用户可见反馈由上述系统通知承担。
  外链：About → Release notes 后 Chrome 前台化，无错误反馈。
  退出协调：会话 C 发起长运行后约 5 秒经 CDP `Browser.close` 优雅退出；进程退出。重启后该运行
  经 resume 恢复并完成（agent 消息 08:28:49 落库，在重启之后），无重复终局、无 stuck/error，
  会话回到 idle。侧注：该次恢复的 codex 回答了上一轮问题而非当前 1–400 计数——provider 恢复
  语义的模型侧表现，RA-15 已用显式双问链独立验证 resume 回答当前问题（见下）。
- **RA-15 通过（三家逐家，未互相抵扣）**。方法：把用户副本团队「通用助手」成员 CLI 逐家切换并
  保存，每次新建会话连发两条消息（第二条件即 resume），对账 runDir 原生记录。
  - Codex（model gpt-5.6-sol）：两条均完成（Duration 00:13 / 00:11，回复 RA15-CODEX-1/2）；
    两次运行的 `stdout.jsonl` 共享同一 `thread_id 019fc19b-430b-7163-9c18-54a88065d14a`，
    resume 同源证实；input_tokens 16155→32398 与累积上下文一致。
  - Claude（model sonnet）：两条均完成（00:06 / 00:04）；`claude-stream.jsonl` 共享同一
    `session_id 43310e62-a191-4b21-a29c-f939954372ec`。
  - Kimi（model kimi-code/kimi-for-coding）：两条均完成（00:04 / 00:02）；`kimi-acp.jsonl`
    共享同一 `sessionId session_5f783a7e-6413-4907-8f34-b8927d632919`。
  三家的第二条均回答当前问题（非陈旧上下文）；终端均为成功终局。重启应用后三个会话的消息、
  Duration 与 Full output 入口展示一致。
