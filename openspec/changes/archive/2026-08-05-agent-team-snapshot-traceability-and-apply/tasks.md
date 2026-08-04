# 任务：agent-team-snapshot-traceability-and-apply

实施顺序固定为数据模型 → local 状态机/API → desktop 装配 → console-ui → 保存反馈 → 真实验收。方案核验通过前不得开始本清单的生产实现。

## A. 完整快照与迁移

- [x] 扩展 `LocalConsoleAgentTeamSnapshot` 为完整团队身份、成员身份/Markdown/profile、captured/loaded 时间与内部 key/digests；canonical 计算放纯 domain
- [x] 扩展 desktop `team-runtime-binding` 一次读取完整有效团队版本，继续由 desktop 拥有目录/profile store 知识
- [x] 新增 `session_agent_team_snapshot_meta`，把 member slot 扩为 effective/candidate/pending，并新增 `dispatch_snapshot_key` 与 update intent 表
- [x] 迁移保留现有 effective/pending rows、成员顺序、三家/NULL profile、绑定、消息状态与外键；旧未知字段保持 NULL，不读当前目录补写
- [x] 为 pending/running legacy dispatch 在首次应用事务中绑定当前 effective key；不重写完成历史或 JSONL
- [x] 单测：fresh schema、五类旧库 fixture、双次 init、事务回滚、`foreign_key_check`、旧 API read/write 兼容

## B. 变化检测与应用状态机

- [x] 新增纯 `session-team-update-plan`：Agent-definition digest 比较有序成员的完整已保存 `AGENT.md`，Team-information digest 另比较解析身份结果，并与 execution profile 独立分类
- [x] 新增 inspect runtime：只比较有效保存版本；无绑定、deleted/needs-repair、pending switch、无变化与 candidate 更新均有确定结果
- [x] 新增 apply/retry/cancel runtime 与 store commands；冻结 candidate 到 pending，持久化 from/target key 和 waiting/failed 状态
- [x] 让 primary/worker dispatch 与旧 run 衍生 handoff 继承 snapshot key；应用提升等待旧代次全部清空，不只等待一个 active run
- [x] 点击后用户消息复用现有 `awaiting-team` 持久队列；成功后按新名单 FIFO 解析，失败不发射，取消后按旧名单 FIFO 解析
- [x] retry 只使用 pending 冻结版本；更晚 candidate 不漂移；并发/陈旧 switch/apply/retry/cancel 以 expected key 返回 409
- [x] 重启恢复 waiting/failed intent、pending 版本和等待消息；状态机幂等且不重复发射
- [x] 单测：只改 `display_name` / `description` 身份 frontmatter 且正文不变时同时报告 Agent-definition 与 team-information；另覆盖无旧工作立即应用、primary/worker 队列、旧 run 点击后 handoff、失败/重试/取消、更晚保存、重启恢复、陈旧请求、目标无效与第一提交失败

## C. run 历史审计与窄 API

- [x] 扩展 run execution context 可选团队审计块，并保证新 run 在 provider 解析/启动前追加 JSONL 与可重建索引
- [x] 从 driver `onProcessStarted` 追加最小 process-started 事实；不以普通 lifecycle startedAt 单独证明执行
- [x] 新增纯 audit projector，输出 executed / planned-not-started / bound-start-unknown 和 nullable 字段
- [x] 新增 run-scoped info 与 Markdown GET 路由；校验 session/run/role，拒绝路径/team/member 任意读取参数
- [x] 普通 state/view 不返回 Markdown、内部 key、路径、mtime 或 profile 前后值；错误 DTO 只含稳定 code 和可读摘要
- [x] 单测：真实开始、spawn 前拒绝、一次性 override、成功旧事实、无 context legacy、缺 model/effort、团队已改名/删除、跨 session/run 越权与 Markdown 原文转义

## D. desktop 状态与命令装配

- [x] 扩展 console state/client/contracts，接入 effective/pending 历史摘要、update DTO、inspect/apply/retry/cancel 和两条 audit GET
- [x] `refresh-console-state` 只提交当前 request key/revision 的结果；团队外部变化无需重启即可在当前会话出现
- [x] 现有 switch team 保持目标最新完整版本冻结；A → B → A 与同团队 apply 使用不同 intent，不混写状态
- [x] 修改 current session 团队映射，收起按钮不再从当前 catalog 覆盖历史名称/成员；pending 显示冻结 pending 摘要
- [x] 单测：慢 inspect、失败、迟到旧 session 响应、父级重渲染与 callback identity 变化，不重复提交或覆盖较新状态

## E. `packages/console-ui` 生产组件

- [x] 从 `SessionTeamMenu` 提取共享团队选项；`NewConversationPage` 删除原生 `<select>` 并复用同一选项，分析新会话自然复用
- [x] 选项显示名称/来源/用途/主 Agent/成员数量与成员；复用 `AgentInitialAvatar`，`+N` 鼠标/Enter/Space 展开不选团队、不关菜单
- [x] 已有会话顶部当前项使用历史 snapshot 且不可选；目录区排除当前 stable team；同名辨认和辅助名称保持既有契约
- [x] 新增 `SessionTeamUpdateNotice`，覆盖三类、waiting、failed、retry、cancel；复用 pending dispatch 编辑/移除 UI
- [x] 新增 `AgentRunInfoPopover`、包内 Radix `Dialog` wrapper 和 `AgentMarkdownDialog`；Agent 头像按钮复用 `AgentInitialAvatar`
- [x] Popover 锚定触发头像、自动上翻/防碰撞、窄窗有界；Escape/卡外/重复点击关闭并回焦；Dialog 分层关闭和回焦正确
- [x] info/Markdown 异步状态覆盖慢、失败、retry、key 切换、父级重渲染和 callback identity 变化；迟到响应不污染当前卡片
- [x] 新增/更新 Component、Block、Page Story；亮暗、窄窗、长成员、同名团队、三种证据、legacy 缺字段、reduced-motion 均有 fixture
- [x] 更新 `packages/console-ui/DESIGN.md` 组件模式目录；无裸色、阴影、渐变或 desktop 私有副本

## F. 团队页保存反馈

- [x] 新增纯 `agent-team-save-feedback-plan` 与共享 `AgentTeamSaveFeedback` DTO/component
- [x] 团队信息、主 Agent、成员增删、单成员 `AGENT.md`、profile 保存成功只按真实 mutation result 显示“已保存、无需重启”边界
- [x] save-all 返回成功项目和失败项目；全部成功先保存 feedback 再回列表并显示团队/数量，部分失败留详情且不报整体成功
- [x] 无草稿且有效外部修改载入成功显示 external-loaded；冲突、无效、读取失败、needs-repair 无成功反馈
- [x] 单测：部分 profile + Markdown 保存、失败草稿隔离、retry、导航后反馈、迟到 mutation 与 callback identity 变化

## G. 边界、定向验证与符合度反思

- [x] 实施开始前记录当前 commit 为本 change 的 scope 基线；后续所有 `--scope` 命令使用该同一精确基线
- [x] 新增生产文件登记 `src/testing/four-layer-registry.ts`；运行 `pnpm check:boundaries`
- [x] 运行 `pnpm run test --scope <记录的精确基线>`；不得自行挑文件替代 scope 闭环
- [x] 运行 `pnpm typecheck`
- [x] 运行 `pnpm --filter @moebius/console-ui check:storybook`
- [x] 运行 `pnpm --filter @moebius/desktop build`
- [x] 运行 `git diff --check`
- [x] 对照 proposal/design/spec-delta 和两份 PRD 反思：逐项列出已实现、未实现、多做、兼容降级与测试证据；偏差必须先修复
- [x] 复核 changed-file list，确认生产代码没有 import/read/copy `prototypes/`，desktop 没有复制 console-ui 组件或 local domain 规则

## H. 真实 Electron 功能与视觉验收

- [x] 在隔离数据根启动真实 Electron，从新对话展开团队菜单：断言每项名称/来源/用途/主 Agent/成员数可见，`+N` 键盘展开完整成员且菜单不关闭
- [x] 创建会话后外部修改一个 `AGENT.md` 和一名成员 profile：断言 composer 上方分别出现两类提示，应用任一项后两类一起消失，后续新 run 使用完整新版
- [x] 另在正文不变时只外部修改一名成员的 `display_name` / `description` frontmatter：断言同时出现「Agent 定义已更新」与「团队信息已更新」，且不出现运行配置提示
- [x] 让旧 run 与 worker 队列存在时应用：断言旧工作保持旧 snapshot，点击后消息显示等待且可编辑/移除，重启后仍等待，旧代次清空后只发射一次
- [x] 故障注入提升失败：断言旧 snapshot 不变、消息不偷跑；更晚保存后 retry 仍用原目标；cancel 后按旧版释放并重显更晚变化
- [x] 对应用前历史步骤执行 retry/重新运行/恢复：断言 run audit 仍显示原团队/profile；普通新消息显示新版
- [x] 分别打开运行中、成功、启动前失败和 legacy fixture 的 Agent 头像：断言三种证据标签、历史团队来源、载入时间/未记录与只读 Markdown 正确
- [x] 在时间线顶部/底部和窄窗口打开 Popover：断言锚定头像、需要时上翻、无横向滚动；Escape/卡外/重复点击和 Dialog 分层关闭均回焦原头像
- [x] 团队页逐项保存、部分失败和 save-all 全成功：断言当前操作反馈、失败草稿隔离、列表顶部反馈及数量
- [x] 保存后不重启直接新建对话并选择该团队：断言首次 run 的 info DTO/卡片使用最新保存内容与 profile
- [x] 真实验收 evidence JSON、DOM/可访问性断言和必要截图写入脚本报告的系统临时目录；不得写仓库 `artifacts/`

## I. 功能 QA / 视觉 QA 移交清单

- [x] 功能 QA：按 `wireframes.md` 和验收 99–102、agent-teams 38 逐条执行，并记录页面入口、动作、可观察信号和 evidence 路径
- [x] 视觉 QA：核对已确认原型的信息密度、Popover 锚定/上翻、亮暗/窄窗、焦点、无阴影无渐变和三条中性提示；不要求像素复制原型
- [x] 每条用户可见行为都附一条“真实运行可观察”语句；缺少真实页面证据不得声明 code-verified 完成

> 完整 `pnpm test` 不在实现者初次收口运行；按仓库规则，待功能与视觉复核通过后、合并前由交付流程对本 change 恰好运行一次。归档、spec 回流、architecture/wireframe 回流与本地提交服从 `openspec/changes/AGENTS.md`，不在本清单重复。
