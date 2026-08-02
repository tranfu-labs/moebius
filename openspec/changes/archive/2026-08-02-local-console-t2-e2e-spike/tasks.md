# 任务：local-console-t2-e2e-spike

- [x] 新增 local console 配置与 SQLite store：数据根路径、单表 schema、消息追加、状态迁移、查询快照、store timeout / busy failure 处理。
- [x] 新增 loopback HTTP 极简页与 API：`GET /`、`GET /api/local-console/messages`、`POST /api/local-console/messages`。
- [x] 新增 local intake / sink adapter：SQLite 消息转 timeline、复用 mention trigger、Codex 成功 / 失败 / timeout 写回本地消息表。
- [x] 在 `pnpm start` 装配 local console runtime：启动 server、单会话串行执行、running 第二条消息拒绝或禁用、stale running 修复、进程退出清理。
- [x] 补单元测试：store、timeline adapter、intake trigger、sink 状态写回、store 快速失败 / busy timeout / 永久挂起注入、stale running 修复。
- [x] 补集成测试：fake Codex + fake `gh` 前置 PATH 的本地 HTTP API 端到端闭环，断言无 `gh` 调用。
- [x] 补故障注入集成测试：静默不退出 fake Codex timeout 后释放 session；慢成功 fake Codex 期间第二条消息不并发运行。
- [x] 跑真实 Codex 验收：不配 repository、不 `gh auth`，在最小本地页面发本地消息，保存 fake `gh` 零调用日志、Codex run 输出和页面截图 artifact。
- [x] 把 spike 结论与验收证据追记到 `docs/roadmap/milestone-4-local-console.md` 的 T2 下方，并勾选 T2。
- [x] 运行 `pnpm test` 与 `pnpm typecheck`。

测试说明：本 change 含可测逻辑（SQLite 状态、adapter、HTTP API、trigger 分支），必须有单元测试与集成测试。最终 `code-verified` 还必须提供真实 Codex 端到端验收证据；fake Codex 集成测试不能替代真实 Codex 验收。

---

## 30 批处置（归档）

本 change 的 local 任务已全部完成，归档为事实。其中涉及 GitHub 对等/零漂移的验收前提随 `four-layer-30-github-runner` 失效，但已验证的 local 事实完整保留。
