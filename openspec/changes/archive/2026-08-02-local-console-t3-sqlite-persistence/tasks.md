# 任务：local-console-t3-sqlite-persistence

- [x] 建立统一 SQLite state store
  - [x] 增加 worker-isolated SQLite store，确保初始化、迁移、读写和 observer 读取有界返回。
  - [x] 增加 schema migration 机制、source-local migration marker 和 T3 表结构。
  - [x] 复用 T2 SQLite 文件路径，并把 `local_messages` 迁移到 `session_messages`。
  - [x] 增加 session key helper，覆盖 local session 与 GitHub issue source。
- [x] 迁移 JSON-backed state adapters
  - [x] 将 role thread state 改为 SQLite-backed，并覆盖旧 JSON 合法 / 缺失 / 损坏迁移测试。
  - [x] 将 agent context state 改为 SQLite-backed，并保持 issue worktree capability 行为。
  - [x] 将 GitHub response intake state 改为 SQLite-backed，并保持 active / idle / route decision 语义。
  - [x] 将 goal ledger state 改为 SQLite-backed document store，并保留 schema 校验、timeout / abort 与 entry-level merge。
  - [x] 将 state persister 的 save path 接入 SQLite。
- [x] 接入 runner / observer / desktop
  - [x] 在 GitHub runner 边界用 deterministic session key 读写内部 state，对外仍使用 issue source。
  - [x] 更新 local console store/API 使用 `session_messages`，同一数据根重启后读回历史。
  - [x] 更新 observer 只读 state loader 从 SQLite 读取 ledger、intake、role threads、agent contexts。
  - [x] 确认 desktop 壳同一数据根重启后能读取一致状态，不新增 T4 UI 能力。
- [x] 回归与验收
  - [x] 增加统一持久化迁移和重启一致性测试。
  - [x] 增加 SQLite 永久挂起 / busy / worker timeout 后释放 session 或 issue 推进锁的测试。
  - [x] 增加 migration 部分失败后不写 imported marker、重启不重复不漏项的测试。
  - [x] 增加旧 JSON 损坏时 source-local 诊断边界测试。
  - [x] 增加 GitHub legacy role thread 迁移后同 issue 同 role resume 复用原 thread id 的测试。
  - [x] 增加迁移成功后保存 state 只更新 SQLite、不写旧 `.state/*.json` 的测试。
  - [x] 复跑 GitHub runner 相关回归与 `pnpm test`，确保零漂移。
  - [x] 复跑 `pnpm typecheck`。
  - [x] 将 T3 验收证据追记到 `docs/roadmap/milestone-4-local-console.md` 并勾选。
  - [x] `git diff --check`，随后 commit、push 并创建 PR，commit message 含 `Closes #101`。

---

## 30 批处置（归档）

本 change 的 local 任务已全部完成，归档为事实。其中涉及 GitHub 对等/零漂移的验收前提随 `four-layer-30-github-runner` 失效，但已验证的 local 事实完整保留。
