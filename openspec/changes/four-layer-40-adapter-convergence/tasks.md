# 任务：four-layer-40-adapter-convergence

- [ ] 导出 30 change 后剩余 layer debt，按外部边界分组并逐项归属
  - [x] provider / infra：8 文件，1,502 条 AST 条件、214 条未分类，目标 1,438 / 0；见 `provider-infra-cluster-ledger.md`
  - [x] ai-team-builder：5 个主体文件 1,252 逻辑行 / 126 条原始 AST 条件；目标原文件 <=926 行 / <=49 条，清除 5 条 file debt 与 2 条 dependency debt；见 `ai-team-builder-cluster-ledger.md`
  - [x] desktop team-* 与其他 desktop root：14 个 file debt 文件 4,711 逻辑行 / 626 条原始 AST 条件，
    98 条去重违规，目标旧文件 <=420 条 / 0 违规；见 `desktop-team-cluster-ledger.md`
- [ ] 开工前逐项核对 Codex/Claude/Kimi 认证与额度、Electron 页面可达性和网络前提；记录用户/主理人对缺失前提的合并/归档策略
- [ ] 建 parser/classifier test-name ledger，列明不可删除 IO 接缝
- [ ] 清理 desktop main/team/onboarding/IPC/browser storage 共居判据
- [ ] 清理 provider/files/trusted JSONL/workspace/attachment 共居判据
  - [x] provider / infra 第一簇：8 条 file debt 清零，150 条 exact permit、64 条账面业务条件下沉，测试净删除 0
  - [x] ai-team-builder 第二簇：5 条 file debt + 2 条 dependency debt 清零，root 454→84 逻辑行，permit/root 净增 0，测试净删除 0
- [ ] 清理 local SQLite/JSONL state、HTTP server 与 composition root 共居判据
- [ ] 保持 `LocalConsoleStore` API/schema 不变，删除本 change 对应 debt
- [ ] scope、定向测试、typecheck、desktop build 全绿
- [x] 执行 RA-13～RA-15，报告环境前提和真实观察
- [ ] 报告纯比例、闸门耗时与速度净收益（允许为零）
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

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
