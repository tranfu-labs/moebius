# 提案：defer-runtime-validation-to-execution

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | Agent 运行配置 · 运行配置静态校验 · 页面状态 · 指标与验收 | 团队页从“枚举并验证本机能力”改为“直接编辑可移植配置，只做静态校验” | 已写入 |
| `docs/product/pages/main-conversation.md` | 选择工作空间与团队 · Agent 执行与恢复 · 指标与验收 | 已有 readiness 提示只作参考且不阻止发送；第一条消息直接启动快照绑定 CLI，以真实启动结果完成动态校验 | 已写入 |
| `docs/product/pages/onboarding.md` | 第 1 步 · 环境准备 | 引导继续拥有自己的 readiness 检查，不再复用团队管理链路 | 已写入 |

采访三段对照：

- **现状**：Agent 团队 PRD 要求从本机 CLI 枚举 model/effort，并定义“无法验证 / 需要调整”；主对话 PRD 把这些状态是否阻止创建会话留待后续裁决；onboarding PRD 复用团队页探针，并把自己的兼容性提示延续到新对话。
- **期望**：团队定义是可移植配置，团队管理不自动探测 Codex/Kimi；新会话第一条消息形成快照后直接启动所选 CLI，真实启动失败成为该 run 的“这一步没跑起来”，不做独立预检、不跨 CLI 降级。
- **落点**：单页管理规则写入 `agent-teams.md`，创建会话、首次执行与错误反馈写入 `main-conversation.md`；`onboarding.md` 只改探针归属，不改变兼容性提示的展示与延续。

## 背景

团队详情当前把磁盘中的静态 CLI/model/effort 配置与两套本机 CLI 能力探测绑定在同一次读取中。冷缓存时会同时启动 Codex、Kimi 探测并等待全部返回；renderer 每秒刷新又会改变读取回调身份，使在途结果可能被作废并永久停在“正在读取运行配置”。

修复 effect 生命周期只能消除永久 loading，不能消除更根本的产品错层：团队管理被某一台机器的运行环境阻塞，且为展示一份可移植 JSON 重复做真实启动前仍可能过期的预检。

## 提案

- 团队详情直接读取和保存每名 Agent 的 CLI/model/effort。CLI 保持 Codex/Kimi 枚举；model 与 effort 使用直接文本值；只校验枚举、非空和既有安全解析规则。
- 团队列表/详情/保存 IPC 不再调用 `probeExecutionCapabilities`，不再传递 capability snapshot，也不再产生“无法验证 / 需要调整 / 重新检查”管理状态。
- 保留官方推荐、用户覆盖、逐成员草稿、保存失败保护、复制与官方更新三方比较。
- 普通操作台不在挂载、shell 就绪、进入团队页或发送消息时主动检查 Codex/Kimi；onboarding 和仍在延续的安装流程可以按其既有契约产出 readiness。新对话保留现有兼容性提示，只消费已经存在的 readiness 结果，提示只作参考，不因当前机器未准备好某套 CLI 而阻止会话创建、团队切换或首次发送。
- 第一条消息仍原子创建 session、用户消息、附件归属和团队快照；随后沿用既有 run 路径直接启动主 Agent 快照绑定的 CLI。安装缺失、认证失败、model/effort 被拒绝或驱动失败都落成明确的“这一步没跑起来”，保留会话、消息和快照，另一套 CLI 调用次数为零。
- 第二条及后续消息、成员接力和用户重试不追加 capability preflight，只按各自不可变快照启动绑定 driver。
- 团队页后来修改配置不改变已有会话：后续发送与针对旧 run 的重试继续使用原快照；之后新建的会话才载入新配置。
- onboarding 的 Codex/Kimi readiness 展示、跨页兼容提示和 AI 建队检查保持不变；独立“运行环境”诊断页不在本 change 内。

## 影响

受影响模块：

- `desktop/src/team-ipc-contract.ts`、`desktop/src/team-ipc.ts`、`desktop/src/preload.ts`、`desktop/src/main.ts`：收窄团队运行配置 DTO 与 IPC，移除团队管理能力探测。
- `desktop/src/console-page/app.tsx`：删除团队 capability refresh 适配，向详情提供静态配置文档；停止普通操作台挂载/shell-ready 自动 readiness 检查，保留 onboarding 安装延续所需的状态消费与完成后复检。
- `packages/console-ui/src/console/agent-team-detail.tsx`、`agent-teams-page.tsx`：静态配置编辑器、逐成员草稿和错误保护。
- `desktop/src/team-execution-profile.ts`：保留配置规范化、推荐/覆盖与复制迁移规则；能力评估规则若已无非 onboarding 消费者则收窄到真正需要的边界。
- `src/local-console/*`：原则上复用现有快照与硬路由实现，补足首次失败、后续发送和团队修改快照边界测试；发现实现与新规格不符时做最小修正。

保持不变：

- onboarding、AI 建队的主动环境检查、CLI 安装流程，以及新对话已有的 readiness 兼容性提示。
- 会话团队快照、run 级不可变上下文、Codex/Kimi 硬路由、恢复校验、附件和旧会话 Codex 兼容行为。
- 官方推荐与用户覆盖、复制/更新保护、团队结构健康度和 Sidebar 修复红点。
