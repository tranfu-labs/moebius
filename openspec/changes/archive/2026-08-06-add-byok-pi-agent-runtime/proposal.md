# 提案：add-byok-pi-agent-runtime

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/flows/byok-agent-runtime.md` | `#主流程`、`#分支与异常`、`#端到端验收` | 新增 BYOK Provider 与 Pi 编码 Agent 的跨页面完整旅程 | 已写入并通过产品评审 |
| `docs/product/pages/onboarding.md` | `#第-1-步--环境就绪至少一个执行引擎已就绪`、`#第-1-步--添加或修复-api-provider` | 允许 API-only 用户配置、验证并进入产品 | 已写入并通过产品评审 |
| `docs/product/pages/settings.md` | `#ai-服务商`、`#管理-ai-服务商` | 新增 Provider 档案生命周期、引用迁移和删除保护 | 已写入并通过产品评审 |
| `docs/product/pages/agent-teams.md` | `#agent-运行配置`、`#provider-引用与团队生命周期` | 增加 Pi API 成员配置和引用一致性 | 已写入并通过产品评审 |
| `docs/product/pages/main-conversation.md` | `#pi-配置异常与会话迁移`、`#agent-执行与恢复` | 增加 Pi 运行、代际、临时重跑、迁移和结束继续能力 | 已写入并通过产品评审 |
| `docs/product/pages/agent-conversation.md` | `#完整输出`、`#重试与恢复` | 增加 Pi 安全过程与细粒度恢复 | 已写入并通过产品评审 |
| `docs/product/prd.md` | `#ai-服务商档案`、`#desktop-持久-agent-的执行会话连续性`、`#开发域-mvp` | 将 Pi API 确立为第四执行引擎和 BYOK MVP | 已写入并通过产品评审 |

PRD 变更记录：本 change 对应 2026-08-04 已确认并完成逐页用户视角评审的 BYOK / Pi 产品事实；交互投影由 `docs/product/flows/byok-agent-runtime.prototype.html` 验证，但生产实现不得导入、复制或运行时读取 prototype。

## 背景

Moebius 当前只支持 Codex、Claude Code 与 Kimi 三套本机 CLI。没有 CLI 的用户无法通过首次引导；团队成员运行配置只能保存 CLI、model 与 effort；产品也没有可供普通用户管理的 API Provider 档案或系统凭据边界。隐藏的 Codex provider override 仅服务本地开发配置，不能承载 DeepSeek Chat Completions，也不能作为产品级 BYOK 能力。

现有 local-console 已具备会话 JSONL 事实源、执行段、Provider 原生会话恢复、失败分类、附件、FIFO 和 managed process 桥接。新增能力应复用这些产品事实与监督契约，以 Pi SDK 作为第四执行引擎，而不是建立第二套会话、队列或后台进程系统。

## 提案

1. 增加维护型 Provider 目录。首版公开 DeepSeek，固定端点与 `deepseek-v4-flash`、`deepseek-v4-pro` 模型，不接受 Base URL 或任意模型 ID。
2. 增加应用级 Provider 档案。SQLite 只存档案元数据、模型验证集、状态和事务记录；API Key 由 Electron 主进程使用系统凭据保护后单独保存，renderer、local-console DTO、会话 JSONL、命令参数、环境变量和日志都不得出现明文。
3. Electron 38.8.6 保持不升级。其类型与运行时只提供同步 `safeStorage`；本 change 以主进程专用、短字符串、应用 ready 后调用的同步 adapter 隔离该限制，并以打包态验证锁定行为。未来 Electron 升级可替换 adapter，不改变业务接口。
4. 精确锁定 `@earendil-works/pi-coding-agent@0.83.0`、`@earendil-works/pi-ai@0.83.0`、`@earendil-works/pi-agent-core@0.83.0`、`@modelcontextprotocol/sdk@1.30.0` 与 `typebox@1.3.7`，均为 MIT。尖峰评估的 `pi-mcp-adapter@2.19.0` 直接导出 TypeScript 且在本仓库严格编译下失败；`pi-web-lite@0.1.3` 与 `pi-subagents@0.40.0` 会带入明文配置发现或超出首版边界的后台能力，因此不作为运行时依赖。MCP、Web Fetch 与前台子任务由 Moebius 受控薄适配提供，不启用上游环境自动发现。
5. 增加短生命周期 Pi Host。每次 Provider turn 由 local-console 前台启动，密钥只经一次性私有 stdin frame 注入内存；Host 映射 Pi 流式事件、工具、压缩、停止和原生 session link 到现有运行事实。它不是 managed process，也不得在 turn 结束后存活。
6. 扩展成员执行配置和会话快照为 v2 判别联合：CLI 配置保持兼容；Pi 配置冻结 `providerProfileId + providerId + model + effort`，但只引用当前 Key，不复制 Key。Key 轮换不改变会话身份；模型或服务商迁移建立新执行代并封存旧 Pi session。
7. 将受控文件工具、结构化前台命令、Plan/Todo、Web、MCP、Skills/项目指令、前台并行子任务、文本/文件附件与上下文压缩接入 Pi；图片严格服从目录模型能力，首版 DeepSeek V4 在请求前明确拒绝图片输入。跨回合服务继续只走现有 managed process 工具；不引入 sandbox、逐次审批、LSP、插件市场、任意扩展安装或另一套后台进程。
8. 将已经确认的 onboarding、settings、Agent 团队、主对话、单 Agent 页面重新投影到 console-ui 设计系统，覆盖宽窄窗口、异步迟到结果、父级重渲染和回调身份变化。
9. 增加 Provider 档案事务、引用检查、迁移/删除恢复、执行代际、Pi Host 协议、秘密扫描和真实 Electron 验收。所有多对象写入必须同成同败；崩溃后只能显示完整成功或恢复到上一个完整状态并提供重试。

## 影响

### 业务域

- `desktop-shell`：Provider 目录与档案 IPC、系统凭据、AI 建队执行环境、桌面打包。
- `local-console`：执行配置 v2、Pi Host、Provider 原生 session、执行代际、迁移、失败分类、插件工具和引用事实。
- `console-ui`：五个页面及其状态、表单、弹层、窄窗口和安全过程投影。

### 主要代码落点

- `desktop/src/`：credential vault、Provider profile service、preload DTO/IPC、设置与引导编排。
- `src/local-console/`、`src/`：Provider catalog/profile domain、execution profile v2、Pi invocation/host protocol、SQLite migration、generation/recovery facts。
- `packages/console-ui/src/`：Provider 管理、Pi 成员配置、运行与恢复视图；只依赖纯 DTO 与 callbacks。
- `desktop/scripts/build.mjs` 与打包配置：Pi Host、Pi SDK 及原生依赖打包。
- `tests/`、`desktop/tests/`、`packages/console-ui/` tests、`scripts/acceptance/`：单元、协议、构建和真实页面证据。
- `docs/architecture/module-map.md`：新增模块登记与依赖边界；归档时回流架构图。

### 非目标

- 自定义 Base URL、任意模型 ID、第三方插件市场。
- sandbox、逐次权限审批、LSP、云端 Agent、定时任务或自动化平台。
- 另一套后台进程管理；Pi 插件不得绕过 Moebius managed process 契约。
- API 用量账单、预算控制或 DeepSeek 之外尚未确认的公开服务商目录。
