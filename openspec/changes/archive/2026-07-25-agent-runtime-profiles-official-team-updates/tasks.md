# 任务：agent-runtime-profiles-official-team-updates

实施顺序为 0 → 1 → 2 → 3 → 4 → 5 → 7。第 3 组依赖第 1–2 组，第 4 组依赖
第 1 组的有效 profile，第 5 组依赖第 4 组快照。第 6 组是范围护栏，不是待实施能力。

## 0. 已确认方案与范围

- [x] `agent-teams.md` 与 `main-conversation.md` 产品锚点已补齐并完成目标用户视角复审
- [x] 本批固定交付 Agent Teams + core driver，不等待其他页面 PRD
- [x] onboarding、新建/换队 invalid-profile gate、main-right-sidebar 过程投影继续范围外
- [x] GitHub runner、AI 建队与 guardrail 继续 Codex-only
- [x] 实施开始前已核验 proposal、design、三个 spec delta 与 `wireframes.md` 无范围漂移

## 1. 运行配置 domain 与能力探测

- [x] 新增纯类型/校验模块：ExecutionProfile、source、effective profile、fingerprint
- [x] 新增版本化 profile store，key 使用 ownership + stable team id + member slug
- [x] 官方、用户新增、普通用户团队三类 source 规则与复制固化
- [x] Codex app-server `model/list` client/parser、超时与安全错误
- [x] Kimi `--version` / `provider list --json` client/parser、超时与安全错误
- [x] 能力 snapshotId、保存时重验、missing/unavailable/需要调整状态
- [x] 单测：profile 求值、恢复推荐、复制固化、能力解析/失败/过期

## 2. 官方来源团队 A/B/C 与更新

- [x] `seeds/teams/*/official.json` schema、版本与初始推荐配置
- [x] 内容指纹纯模块：包含 core/member files，排除 orchestration/official/runtime
- [x] official state store 与 verified/conservative 旧 marker 迁移
- [x] 移除 system 内容写保护；保留来源身份、团队删除保护与路径保护
- [x] 三方比较/保护优先级/影响摘要纯函数
- [x] 同 slug、新增、删除、改名、用户 slug collision 的 profile 迁移纯函数
- [x] prepare plan + stale token + commit + staging/journal/recovery/idempotency
- [x] 复制官方/用户团队时固化全部已保存 profile
- [x] IPC：list/detail/save/restore/prepare-update/apply-update；main process 全量重验
- [x] 单测：`agent-teams.md` #3、#14–27 对应的 domain/store/IPC 正反路径；#1–2、
      #4–13 只作为既有能力跑非回归，不新建重复实现
- [x] 故障注入：副本、official staging、swap、state、record、retry、startup recovery

## 3. Agent 团队 UI

- [x] team DTO 增加 official management state、profile summary、capabilities
- [x] `readOnly` 拆为 canEditContent/canDeleteTeam，官方内容与成员可编辑但团队不可删
- [x] 团队首页状态：官方来源/已自定义/有更新/无法检查更新
- [x] 详情更新 banner、影响摘要、直接更新/保留副本并更新、成功副本入口
- [x] 运行配置 editor：CLI/model/effort/source/status/恢复推荐/独立保存
- [x] profile draft reducer，与 AGENT.md drafts 组合离开/update/duplicate guard
- [x] unable-to-verify/needs-adjustment 只用普通管理状态，不触发 repair 红点
- [x] 宽/窄布局与键盘操作、现有 DESIGN token/Badge 语义
- [x] 组件测试：编辑官方内容、独立草稿、四种 update、失败与响应式 DOM

## 4. 会话快照

- [x] snapshot member 增加可空 execution profile；SQLite additive migration
- [x] desktop runtime binding 将每名成员 effective profile 注入 pending/effective snapshot
- [x] legacy NULL snapshot 映射为不可变 legacy Codex 兼容身份；full/resume/fallback
      不回写、不读取当前团队页配置
- [x] 每条 run 追加不可变 execution-context JSONL fact，并建立可从 JSONL 重建的 SQLite
      索引，保存原团队内容、角色、workspace、engine/profile 与 fingerprint
- [x] switch team 保持现有 effective/pending 边界：全部已启动/排队 run 终态后整体提升；
      child session、member identity projection 保持当前内容/顺序语义
- [x] 单测：新旧 snapshot、pending/effective、并行 run 换队、团队后改与换队后旧 run
      均不改变 run context

## 5. 执行驱动

- [x] 新增中性 driver registry/run result/session link 类型
- [x] local-console 从 selected member snapshot 读取 profile 并硬路由
- [x] Codex per-run model/effort options builder，full/resume 参数去重
- [x] `src/kimi.ts`：ACP framing、initialize/auth、新建/恢复/config/prompt
- [x] Kimi 运行前核验：以 session/new|resume `configOptions` 与
      `config_option_update` / 设置响应确认实际 model/effort；任何回落、缺项、失败或
      不一致都在 prompt 前失败
- [x] Kimi 图片使用 ACP image block，普通文件沿用 managed copy + prompt manifest；
      转换/能力失败不得降级 Codex
- [x] Kimi 受限 fs reverse RPC、permission fail-closed
- [x] Kimi cancel + SIGINT/SIGTERM/SIGKILL + idle/max watchdog 有限 settle
      - 证据：`tests/kimi.test.ts` 通过真实 `runKimiAcp` wrapper 覆盖 session 建立前与
        建立后挂死/abort，逐阶段断言 cancel → SIGINT → SIGTERM → SIGKILL、有限
        settle、outer close 不追加信号且每个动作最多一次
- [x] execution session link 写 engine/external id/profile fingerprint
- [x] recovery planner 校验原 run context/engine/profile；不匹配时用原 run context
      full-fallback，绝不读取换队后的 current snapshot
- [x] 旧 Codex link 兼容读取
- [x] fake Codex/Kimi 测试：混用、缺失硬失败、full/resume/cancel、禁止降级；
      Kimi 匹配值才允许 prompt，默认回落/过期 option/设置失败/无法确认时 prompt 与
      另一 driver 调用次数均为零；换队后旧 Kimi run fallback 与附件失败时 fake
      Codex 调用次数也为零
- [x] 保持 GitHub runner、AI 建队、guardrail 直接 Codex 调用不变

## 6. 范围护栏（不实施）

- onboarding 的 Codex/Kimi 环境准备不在本批修改。
- 新建对话或明确换队遇到 invalid profile 时是否阻断，不在本批裁决或实现。
- main-right-sidebar 的 Kimi 完整过程来源/投影不在本批修改。
- GitHub runner、AI 建队与 guardrail 不接入 Kimi。
- [x] 实施复核确认没有上述范围的行为改动，并在交付说明中明确能力边界。

## 7. 验证

- [x] 定向 unit/component/IPC/store/driver 测试全绿
- [x] fake CLI 混合团队 AI 验证全绿，不调用真实模型
- [x] official update DOM + 磁盘事实 AI 验证全绿
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm --filter @moebius/console-ui build-storybook`
- [x] `pnpm --filter @moebius/desktop build`
- [x] 对照 `agent-teams.md` 本次追踪 #3、#14–27；#1–2、#4–13 只做既有非回归
- [x] 对照 `main-conversation.md` 本次追踪 #6、#20、#36、#42、#44、#46–49
- [x] 对照 proposal/spec-delta/PRD 逐条反思，无遗漏或越界
