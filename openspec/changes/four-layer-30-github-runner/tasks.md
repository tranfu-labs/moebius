# 任务：four-layer-30-github-runner

## A · 删除前基线

- [ ] 导出 production import 图与 `new Worker` / `utilityProcess.fork` / `spawn` 字符串入口清单，记录
  `sqlite-state-worker.ts` 保留和 Desktop runner child 删除的反例
- [ ] 建立生产删除清单（整删 / 拆分保留 / 不动）与起始物理行数，逐文件标注最后一个生产消费者
- [ ] 建立测试删除 ledger，逐 test name 标注“契约删除 / local 接缝保留 / shared 行为保留”，禁止净删
  local/shared 接缝
- [ ] 导出 30/40 批当前 dependencyDebt/fileDebt，锁定 30 批 20 条与 40 批重算基线

## B · local-only 入口与共享能力

- [ ] 将 local child-session 使用的 CEO parser/types 提取到 local domain，迁移对应纯测试后删除
  `ceo-orchestration.ts` 的 GitHub 专属分支
- [ ] 把 `src/runner.ts` 收为 ≤80 逻辑行 local CLI shell；删除 runtime mode 分支，保留 unknown-arg
  fail-closed、signal/close 与 cold start
- [ ] 删除 config 中 repository/GitHub runtime 参数，保留 data root、provider、local timeout 与兼容读取
  所需的窄配置

## C · GitHub runtime 与 observer 删除

- [ ] 删除 runner/GitHub intake/dispatch/publication/media/state/prescript 闭包及只覆盖这些契约的测试
- [ ] 保留 `sqlite-state.ts` 与动态 worker；只删除无剩余调用者的 GitHub commands/schema setup 代码，
  证明 local commands、worker pool 与历史数据非破坏
- [ ] 删除 `src/observer/**`、`pnpm observer` 和 observer 测试/资源
- [ ] 删除 Desktop runner child/launch/supervisor、fork/build output、observer 启动/窗口/IPC
- [ ] 从 status snapshot、preload、status page、console renderer 与 console-ui props/stories/tests 中删除
  runner/observer 字段和动作，保留 local/doctor/update 诊断

## D · 门禁、事实源与冲突清单

- [ ] 从 four-layer registry 摘除已删除文件与 30 批 20 条 debt；机械重导出 40 批剩余 debt，明确保留
  `sqlite-state-worker.ts`
- [ ] 新增 composition root 时附逐分支 wiring/timing/business 审计；若只保留既有 local roots，记录无新增
- [ ] 更新 `package.json`、`AGENTS.md`、`docs/architecture/module-map.md`、`invariants.md`、相关架构图与
  active command 文档；历史 roadmap/归档证据不改写
- [ ] 维护仍含 `github-issue-runner` delta 的未归档 change 冲突清单，交由主理人按纯 GitHub/混合 change
  逐项处置，不把 local/goal-ledger 内容连带删除
- [ ] 完成 spec-delta，归档时退役 `github-issue-runner` spec 并修改 local-console/desktop-shell 事实源

## E · 验证与收口

- [ ] `pnpm check:boundaries`、`pnpm run test --scope <base>`、定向保留接缝、`pnpm typecheck` 与 desktop
  build 全绿
- [ ] 执行 RA-11R：真实 `pnpm start` local 会话写读、退出释放；`--github-mode` 启动前 fail closed
- [ ] 执行 RA-12R：真实 Desktop 主窗口/local 状态页可用，无 runner child/observer UI 或进程
- [ ] 执行 RA-30D：带旧 GitHub state 的临时数据根启动前后哈希/表行数不变且无新 GitHub 写入
- [ ] 报告净删除行数、30/40 debt、测试 ledger、剩余纯比例新基线与闸门耗时；单样本不声明归因收益
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次完整 `pnpm test`；若红，修复后重跑完整闸门
