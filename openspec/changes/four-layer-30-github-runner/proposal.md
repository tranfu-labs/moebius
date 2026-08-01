# 提案：four-layer-30-github-runner

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `openspec/specs/github-issue-runner/spec.md` | 全部 runner Requirement | intake、trigger、执行、发布、恢复语义保持 | 无变更 |
| `docs/protocols/github-interaction.md` | 全部公开交互协议 | mention/comment/stage 行为保持 | 无变更 |
| `docs/architecture/invariants.md` | L1 / S1 / V1 | 调用顺序与失败边界 oracle | 无变更 |
| `openspec/changes/four-layer-architecture-series/design.md` | `30 · GitHub runner` | 本 change 系列契约 | 待主理人核验 |

`spec-delta/` 保持为空；任何 cursor、可见评论或重试语义变化均是回归。

## 背景

`runner.ts` 仍约 2,618 行。scanner、dispatcher、acceptance-prepass、external-route 已出现应用模块，
但主 issue flow 仍混合领域判定、GitHub/Codex adapter 调用和状态提交，导致部分 trigger/route/
acceptance 组合只能通过 runner 级测试验证。

## 提案

- 保持既有 scanner/dispatcher/route/acceptance 模块和流程顺序，不改成事件总线。
- 把 issue processing 主链收成 application use case，纯 decisions 留既有 conversation/intake/ledger/
  trigger/orchestration modules 或窄 planner。
- `runner.ts` 只做配置、adapter 和 composition 装配。
- 纯组合从 runner 重型用例迁到 direct tests，保留 gh/Codex、L1/S1/V1 和 sandbox GitHub 接缝。

## 影响

涉及 `src/runner.ts`、`src/runner/**`、scanner/dispatcher 邻近 application/domain modules 和 tests；
不改 GitHub API、Codex 参数、agent Markdown 或 ledger schema。

## 真实验收环境前提

| 前提 | 开工前机械核对 | 不满足时的影响 |
| --- | --- | --- |
| 专用 sandbox GitHub 仓库已加入本机 `config.local.toml` 白名单 | 只读检查 exact `owner/repo`，不得提交本地配置 | RA-11/RA-12 无法进入真实 runner intake；不影响纯规则与 adapter 替身测试 |
| 当前 `gh` 登录对 sandbox issue 具备读取、评论、reaction 及创建/关闭验收 issue 的权限 | `gh auth status` 加 sandbox 上一次可回收的读写探针 | 无法证明 reaction/comment 可见顺序、fallback 幂等和重启后的外部事实 |
| 有专用验收 issue，且允许发布 mention、无 mention 评论并在结束后关闭 | 记录 issue URL/编号及验收账号，不复用真实用户 issue | 缺少可隔离、可清理的 RA-11/RA-12 页面入口 |
| sandbox runner 配置的至少一个真实 provider 当前可完成一次短调用 | 开工前做一次额度最小探针，不把探针算验收 | RA-11 无法观察目标 Agent 终局评论；RA-12 的 no-action 路径仍只能部分验收 |

任一前提不满足时，相关 RA 条目标记“未验证”，fake `gh` 或 mock provider 不抵扣。究竟阻断本批
合并/归档，还是允许标记“待真机验收”后补，由用户/主理人在 30 批开始前决定；本 proposal 只固定
影响面，不预设该策略。
