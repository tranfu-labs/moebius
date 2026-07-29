# 提案：remove-new-conversation-readiness-hint

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | 选择工作空间与团队 | 新对话不再读取或展示 onboarding readiness、成员准备人数、CLI 准备信息或调整引导；真实执行继续在首个 run 启动时裁决 | 已写入 |
| `docs/product/pages/main-conversation.md` | 指标与验收 | 增加任意 readiness、异步延迟/失败下均无准备提示，并保持发送与运行失败语义的验收判据 | 已写入 |
| `docs/product/pages/onboarding.md` | 第 4 步 · 准备就绪 | 明确 onboarding 的兼容性说明止于引导边界，不传播到新对话 | 已写入 |
| `docs/product/pages/onboarding.md` | 指标与验收 | 保留 onboarding 内的检测、安装、登录和部分兼容状态，同时移除新对话继承要求 | 已写入 |

PRD 变更记录：2026-07-29 本地共享时间线中，用户明确否定新对话里的“成员需要准备”概念；`@dev-manager` 将范围收敛为新对话彻底移除该提示，onboarding 继续负责 CLI 安装/登录，实际 run 启动错误继续作为动态执行事实。

## 背景

当前新对话页接收 onboarding readiness 的布尔投影，按所选团队成员的 effective CLI 统计“仍需完成准备”的人数并显示调整去向。该信息既不能说明用户在新对话中需要完成什么，也不是发送前置条件；普通操作台又不主动探测 CLI，导致启动时的未知状态曾被错误投影为未就绪并误报整支团队。

即使修复未知状态误报，新对话仍会保留一个用户不需要处理、也不能在当前页面完成的“准备”概念。用户已明确选择从产品规则上移除它，而不是继续维护提示的状态准确性。

## 提案

- 新对话生产组件删除 readiness 输入、成员兼容性计算、提示区块及仅服务该区块的中英文文案。
- 操作台组合层不再向新对话传递 onboarding readiness；正常操作台不为新对话读取或保存 readiness 展示投影。
- onboarding 第 1 步的 CLI 检测、安装、登录指引，第 2/4 步已有兼容性说明，后台安装与成功复检继续按现有契约运行。
- 新对话发送条件保持只由项目、团队结构、正文/附件、附件状态和提交状态决定，不增加 readiness 或 capability preflight。
- 第一条消息仍先原子创建 session、消息和团队快照，再直接启动主 Agent 快照绑定的 CLI；缺失、未登录、配置拒绝或驱动失败仍在已创建会话中显示“这一步没跑起来”，不跨 CLI 降级。
- 自动化测试覆盖冷启动初始状态、readiness IPC 延迟/失败、父级重渲染、终态 readiness、发送使能和 onboarding 安装/登录回归；真实桌面验收提供 DOM/文本与运行事实证据。

## 影响

受影响域：

- `console-ui`：新对话页面、OperatorConsole 组合契约、console i18n 和相邻测试。
- `desktop-shell`：普通操作台对 onboarding readiness 的消费边界和安装延续回归测试。
- 产品文档：主对话与 onboarding 的跨页边界。

保持不变：

- onboarding readiness service、CLI 安装器、登录/不可验证状态、AI 建队 CLI 选择与复检。
- Agent 团队静态 CLI/model/effort 配置和团队结构可用性。
- local-console 会话创建、团队快照、硬 CLI 路由、运行失败、重试与恢复。
- 新对话的项目、工作空间、团队、正文、附件及发送条件。

本 change 不引入新路由、IPC、持久化字段、CLI 探针或架构依赖方向。
