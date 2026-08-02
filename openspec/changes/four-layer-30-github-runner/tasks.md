# 任务：four-layer-30-github-runner

## A · 删除前基线

### RA-30D 删除前证据（2026-08-02）

- 临时数据根：`/tmp/moebius-ra30d-predelete.X56LSo`
- `github-runner.sqlite` SHA-256：`1cc1da94e7be17b386fdb72a08cf6cf2cc1f0bd057428f616745ca54c7978240`
- 非空 GitHub 代表事实：`github_intake_issues=1`、`github_intake_repositories=1`、
  `goal_ledger_documents=1`、`session_agent_contexts=1`、`session_role_threads=1`、`sessions=1`
- 全部用户表总行数：31。上述事实通过删除前生产 `runSqliteStateCommand` API 写入，不是直接改表。
- 删除后 RA-30D 必须在同一路径启动 local-only terminal/Desktop，再复算相同哈希和逐表行数。

- [x] 导出 production import 图与 `new Worker` / `utilityProcess.fork` / `spawn` 字符串入口清单，记录
  `sqlite-state-worker.ts` 保留和 Desktop runner child 删除的反例
- [x] 建立生产删除清单（整删 / 拆分保留 / 不动）与起始物理行数，逐文件标注最后一个生产消费者
- [x] 建立测试删除 ledger，逐 test name 标注“契约删除 / local 接缝保留 / shared 行为保留”，禁止净删
  local/shared 接缝
- [x] 导出 30/40 批当前 dependencyDebt/fileDebt，锁定 30 批 20 条与 40 批重算基线

## B · local-only 入口与共享能力

- [x] 将 local child-session 使用的 CEO parser/types 提取到 local domain，迁移对应纯测试后删除
  `ceo-orchestration.ts` 的 GitHub 专属分支
- [x] 把 `src/runner.ts` 收为 ≤80 逻辑行 local CLI shell；删除 runtime mode 分支，保留 unknown-arg
  fail-closed、signal/close 与 cold start
- [x] 删除 config 中 repository/GitHub runtime 参数，保留 data root、provider、local timeout 与兼容读取
  所需的窄配置

## C · GitHub runtime 与 observer 删除

- [x] 删除 runner/GitHub intake/dispatch/publication/media/state/prescript 闭包及只覆盖这些契约的测试
- [x] 保留 `sqlite-state.ts` 与动态 worker；只删除无剩余调用者的 GitHub commands/schema setup 代码，
  证明 local commands、worker pool 与历史数据非破坏
- [x] 删除 `src/observer/**`、`pnpm observer` 和 observer 测试/资源
- [x] 删除 Desktop runner child/launch/supervisor、fork/build output、observer 启动/窗口/IPC
- [x] 从 status snapshot、preload、status page、console renderer 与 console-ui props/stories/tests 中删除
  runner/observer 字段和动作，保留 local/doctor/update 诊断

## D · 门禁、事实源与冲突清单

- [x] 从 four-layer registry 摘除已删除文件与 30 批 20 条 debt；机械重导出 40 批剩余 debt，明确保留
  `sqlite-state-worker.ts`
- [x] 新增 composition root 时附逐分支 wiring/timing/business 审计；若只保留既有 local roots，记录无新增
- [x] 更新 `package.json`、`AGENTS.md`、`docs/architecture/module-map.md`、`invariants.md`、相关架构图与
  active command 文档；历史 roadmap/归档证据不改写
- [x] 维护仍含 `github-issue-runner` delta 的未归档 change 冲突清单，交由主理人按纯 GitHub/混合 change
  逐项处置，不把 local/goal-ledger 内容连带删除
- [ ] 完成 spec-delta，归档时退役 `github-issue-runner` spec 并修改 local-console/desktop-shell 事实源

## E · 验证与收口

- [x] `pnpm check:boundaries`、`pnpm run test --scope <base>`、定向保留接缝、`pnpm typecheck` 与 desktop
  build 全绿
- [x] 执行 RA-11R：真实 `pnpm start` local 会话写读、退出释放；`--github-mode` 启动前 fail closed
- [x] 执行 RA-12R：真实 Desktop 主窗口/local 状态页可用，无 runner child/observer UI 或进程
- [x] 执行 RA-30D：带旧 GitHub state 的临时数据根启动前后哈希/表行数不变且无新 GitHub 写入
- [x] 报告净删除行数、30/40 debt、测试 ledger、剩余纯比例新基线与闸门耗时；单样本不声明归因收益
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次完整 `pnpm test`；若红，修复后重跑完整闸门

## 实施收口记录（复核前）

- 生产代码范围 `+242/-14,960`，净删 **14,718 行**；35 个整删生产文件合计 10,874 行，逐文件
  最后消费者见 `production-removal-ledger.md`。`src/runner.ts` 为 **70 行**，满足 ≤80；
  `src/local-console/runtime.ts` 保持 299/300 逻辑行、未改动。
- 30 批 exact debt **20 → 0**。40 批机械重导出为 dependency debt 6 + file debt 27 = **33 条**，
  覆盖 28 个 distinct files；`sqlite-state.ts` 与 `sqlite-state-worker.ts` 均保留到 40 批。与方案阶段
  “40 批约剩 28 条”的估算不同，当前 registry 的 exact 条目数为 33，以实现后机械结果为准。
- composition root allowlist 为 9 条；30 批没有新增 root。`src/runner.ts` 是既有 root，只删除 GitHub
  分支；新 parser/judgment 是 domain，新 persona loader 是 adapter，均不进入 root allowlist。
- domain closure 为 **155 files / 18,926 logical lines**。沿用 00 批 10,024 行对应 34–41% 的职责抽样
  校准，删除后新基线约 **64–77%**；满足本 change ≥60% 的保守目标，不把删除前后的比例差声明为
  可归因架构收益。
- 测试剪枝逐名对账见 `test-deletion-ledger.md`：删除 322 个 runner/observer/desktop-child 契约用例；
  local CLI、route judgment、CEO parser、SQLite worker、conversation/trigger、config/persona 与 Desktop
  local topology 均保留或先建等价行为测试。不存在把已删除产品契约伪装成“降级纯测”的对账。
- Node 24.18.0：`pnpm check:boundaries` 通过（569 source / 483 production / 3 roots）；
  `pnpm run test --scope d7373e3` 通过（root 45 files / 466 tests，另 1 file / 4 tests skipped；Desktop
  21/174；console-ui 1/114），`pnpm typecheck` 与 Desktop build 退出码 0。状态页真机返工没有 import
  consumer，未提交 scope 按设计以退出码 76 报“零受影响测试”；其行为由 build + RA-12R 覆盖。
- 仓库没有安装 `openspec` CLI，`pnpm exec openspec validate ... --strict` 报 command not found；未为验证
  临时引入依赖。proposal/design/tasks/spec-delta 结构按 `openspec/changes/AGENTS.md` 人工核对。
- 完整 `pnpm test` 尚未运行，按约定留到 QA/主理人复核通过后的合并点；因此当前不报告完整闸门
  墙钟，也不声明速度收益。

## RA-11R / RA-12R / RA-30D 真机记录（dev）

环境：Node 24.18.0；同一临时数据根 `/tmp/moebius-ra30d-predelete.X56LSo`；真实 terminal local 与
真实 dev Electron，Desktop 经 ADR-0002 CDP 9222 读取真实窗口 DOM，零 mock。

- **RA-11R**：`pnpm start` 启动 `http://127.0.0.1:8788/`，经真实 HTTP 创建标题
  `RA-30 terminal` 的会话并从 `/api/local-console/state` 读回相同 selected session；进程树只有
  `cross-env → tsx → src/runner.ts`，无 `gh`/runner child。SIGINT 后端口连接失败（curl 退出 7）。
  `pnpm start -- --github-mode` 在 server 启动前退出 1，明确打印“GitHub runner mode has been removed.
  Run \"pnpm start\" to start the local console.”
- **RA-12R**：`pnpm desktop` 真实窗口从 onboarding 进入主页面，看到项目
  `moebius-ra30d-predelete.X56LSo`、`RA-30 terminal` 与“新对话”。第一次状态页走查发现并修正遗留
  “仓库白名单”标签；复跑后状态页显示“本地操作台／运行中”、`v0.2.0`、codex CLI、本地文件与打开
  数据目录，DOM 断言 runner=false、observer=false、allowlist=false；进程树无 runner child/observer。
  退出 Desktop 后 local 端口 52212 释放。
- **RA-30D**：删除前、terminal 退出后、Desktop 退出后三次 SHA-256 均为
  `1cc1da94e7be17b386fdb72a08cf6cf2cc1f0bd057428f616745ca54c7978240`；非空表逐项保持
  `github_intake_issues=1`、`github_intake_repositories=1`、`goal_ledger_documents=1`、
  `legacy_migration_sources=4`、`projects=1`、`schema_migrations=20`、`session_agent_contexts=1`、
  `session_role_threads=1`、`sessions=1`，总行数始终 **31**。local 新会话只写
  `.state/local-console.sqlite`，未改旧 `github-runner.sqlite`。
