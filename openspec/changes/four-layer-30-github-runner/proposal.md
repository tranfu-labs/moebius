# 提案：four-layer-30-github-runner

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/prd.md` | `产品运行形态` | 产品只保留本地操作台；移除 GitHub issue runner 与独立 observer | 已写入 |
| `docs/product/prd.md` | `Desktop 持久 Agent 的执行会话连续性` | 持久 Agent 从三类收敛为 local 与 AI 建队两类 | 已写入 |
| `openspec/specs/github-issue-runner/spec.md` | 全域 | runner 行为域随运行形态退役 | 待本 change 归档合并 |
| `openspec/specs/local-console/spec.md` | observer 与双模式启动 Requirements | 删除 observer、`--github-mode` 与双状态链承诺，保留 local-only 启动 | 待本 change 归档合并 |
| `openspec/specs/desktop-shell/spec.md` | 启动、退出、状态与 preload Requirements | 桌面不再启动/监管 runner 与 observer | 待本 change 归档合并 |

用户在四层系列 20 批归档后明确裁决“GitHub runner 不再需要，可以去掉”。这是一项产品意图变更，
覆盖本 change 原先“行为零变更地重构 runner”的方案；旧分解账、RA-11/RA-12 与 sandbox 环境前提
全部作废。三 provider 环境前提仍属于 40 批。

## 背景

当前 GitHub 形态不是一个孤立文件：`src/runner.ts`、GitHub intake/state、issue dispatcher、
prescript/worktree、observer 以及 Desktop runner child/status 共同形成约 14k+ 行生产链。继续按原计划
把它分层，会永久维护用户已决定退出的能力、测试与桌面后台进程。

静态可达性与动态入口核对纠正了两条初始假设：

- `desktop/src/runner-child.ts` 明确以 `mode: "github"` 启动；Desktop 的 local console 由
  `desktop/src/main.ts` 独立持有，因此 runner child/launch/supervisor 可以删除。
- `src/sqlite-state-worker.ts` 由 `src/sqlite-state.ts` 通过 `new Worker(workerUrl)` 动态加载，并服务
  local console；Desktop build 也显式打包它。它必须保留，不能因静态 import 图误删。

## 提案

- 删除 GitHub issue 扫描、intake、comment/reaction/artifact、issue worktree、runner state 与 observer
  的生产入口和实现。
- 把 `src/runner.ts` 收成 local-only 的终端进程壳，保留 `pnpm start`；删除 `--github-mode` 与运行模式
  分支，非空未知参数继续 fail closed。
- 将 local console 实际使用的 CEO child-session parser/types 从 `ceo-orchestration.ts` 提取到 local
  领域模块，随后删除 GitHub 专属 orchestration。
- Desktop 只启动并展示 local console 与现有环境诊断；删除 runner supervisor、observer 服务、状态
  字段、preload 动作和 renderer 的 `runnerStatus` 投影。
- 保留 local/provider 共用模块、`LocalConsoleStore`、`sqlite-state.ts` 与动态 worker；不删除用户数据目录
  中已有历史 GitHub 状态，不修改 SQLite/JSONL 的 local schema。
- 外部 GitHub Release、更新检查和仓库链接不是 runner，继续保留。

## 影响

生产代码预计净删除 14k–17k 行，涉及 `src/runner*`、GitHub/state/observer/prescript 纵切、Desktop
后台 runner/observer 装配、状态页与 console status props。30 批 20 条 layer debt 随删除或 local
提取清零；40 批的剩余 debt 以删除后的 registry 重新导出，`sqlite-state-worker.ts` 的 adapter debt
明确保留给 40 批，不能用本次删除抵扣。

行为变化是有意的：

- `pnpm start` 只启动 local console；`--github-mode` 不再是合法参数。
- Desktop 不再产生 GitHub runner 子进程、observer 端口或相应状态/打开动作。
- `pnpm observer` 命令移除。
- 已有 GitHub runner 数据留在磁盘但不再读取、迁移或写入。

已有未归档 change 中凡仍含 `github-issue-runner` delta 的内容，在 runner 退役后不得继续作为可实施
承诺；本 change 只登记冲突清单，不擅自把混合 change 的 local/goal-ledger 内容一并删除。主理人在
本 change 归档前按“纯 GitHub change 作废、混合 change 删除 GitHub delta 并保留本地域”逐项处置。
