# Changelog

All notable changes to Moebius will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-08-07

### 修复

- 修复生产安装包保存 BYOK API Key 报「两项验证已通过，但本地保存失败」的根因：safeStorage 子进程 helper 依赖未打包 Electron 的隐式行为，打包态下撞单实例锁直接退出导致保存必失败，改为主进程内直调 safeStorage。
- BYOK 凭据改为纯明文存储（原子写 + 0600 权限），删除加解密路径；旧密文档案不迁移，走「需要处理 → 替换 Key」修复路径。
- 修复设置页 AI Provider 候选槽位未过滤导致的整页崩溃。
- 修复团队候选晋升为正式成员与子会话创建两处丢失 Pi Provider 绑定的问题。
- 修复新建对话团队菜单高度溢出视口导致无法点击的问题。

## [0.4.0] - 2026-08-06

### 新增

- 新增 BYOK（自带密钥）AI Provider 体系，作为 Codex / Claude Code / Kimi 之外的第四种 Agent 执行引擎，首个预设支持 DeepSeek：应用级凭据保管库、保存前真实校验、密钥轮换与禁用/启用、迁移与删除均支持崩溃安全恢复。
- 该引擎接入首次引导（免 CLI 的纯 API 路径）、设置（AI Provider 管理）、Agent 团队（按成员配置 Provider/模型/推理强度）、主会话（运行、迁移、一键重跑、续聊）与单 Agent 视图，使零 CLI 用户也能运行完整 Agent 团队。

### 修复

- 修复项目行的指针捕获与 Radix 弹出菜单事件冲突，项目操作对话框补齐焦点陷阱、背景 inert 与焦点归还，使其在交互上真正模态。

## [0.3.4] - 2026-08-05

### 变更

- 延长本地工具调用的默认运行时限，并在工具完成事件到达后正确恢复运行状态与完整输出。

## [0.3.3] - 2026-08-05

### 新增

- 新增可追溯的 Agent 团队快照与应用反馈，明确团队保存版本在新建对话和既有对话中的生效边界。
- 扩展主界面右侧多标签工作区，支持更完整的会话、文件与过程阅读，并保留工作区状态与响应式布局行为。

### 变更

- 对齐首次引导与操作台的视觉、空状态和交互细节，补充对应的原型、Story 与真实页面验收覆盖。

### 修复

- 移除操作台通用诊断错误条，收敛失败呈现与辅助诊断入口边界。
- 修复首次引导、操作台和右侧工作区在 QA 验收中发现的布局、路由与状态回归。

## [0.3.2] - 2026-08-04

### 修复

- 将本地 Agent 执行的默认空闲超时从 3 分钟延长至 10 分钟，减少长时间无输出任务被过早终止的情况。
- 同步官网稳定版本标识，并将版本 badge 纳入发布元数据门禁，避免发布后仍显示旧版本。

## [0.3.1] - 2026-08-04

### 新增

- 新增通用 managed-process runtime，让 Codex、Claude Code 与 Kimi 可通过统一 MCP bridge 托管跨 Agent 回合存活的本地服务和有限任务，并在主会话中查看状态、地址、日志及执行停止或清除操作。
- 新增工作区源码阅读与 Review / Diff 分离模式；Markdown 支持预览与源码切换，显式行号可直接定位目标位置，工作区外文件继续使用有界预览。

### 修复

- 修复长时间线在窗口宽度变化后虚拟行重叠的问题，并保持中段阅读锚点、底部跟随及后续流式追加稳定。
- 修复根路径或不含路径段的 Markdown 目标被误识别为文件引用的问题。
- 修复 macOS Finder 启动桌面应用时 PATH 不完整，导致已安装的 Codex 等 CLI 被误报缺失的问题；CLI 探测与真实 provider 调用现在使用一致的安全解析结果。
- 修复 local-console 当前执行结束与重试释放之间的竞态，并同步增强相关持久化等待和 CI Electron 运行稳定性。

## [0.3.0] - 2026-08-03

### 新增

- 新增桌面自动更新闭环：定时检查正式版本、下载进度与状态反馈、安装重启，并通过退出保护协调运行中的 Agent 与本地服务。
- 新增内置「市场推广团队」种子，可直接用于内容策划、营销执行与复盘协作。

### 变更

- 将运行时和桌面代码收敛到 view / application / domain / adapter 四层架构，并加入可执行的 import 边界门禁。
- 优化长会话加载、会话切换与 SQLite 状态 worker 复用，减少大型历史记录下的重复读取和资源开销。
- 以 settled signal 取代本地执行轮询，降低等待噪声并统一执行终局判断。
- 完善内置开发团队的派发事实单、方案来源类型门禁和真机验收规则，避免以替身或 fixture 抵扣真实用户动作验收。
- 升级发布流程：要求 Developer ID Team `QV657S58FL`，对 App 与 DMG 完成 Apple 公证和票据装订，并对白名单更新资产及其哈希、大小和 updater 元数据做本地与远端双重校验。

### 修复

- 修复跨会话切换时对话草稿及其附件归属、附件存在状态和非活跃草稿确认不一致的问题。
- 修复 provider 过程展示混入不可见分析片段的问题，只保留用户可见内容。

## [0.2.0] - 2026-07-31

### 新增

- 新增 Claude Code CLI 支持，覆盖桌面首次引导、Agent 执行配置、AI 建队、本地完整执行与会话恢复，以及托管附件。
- 新增右侧栏分析会话，可从单条消息或整段对话发起，持久保留来源引用，并支持搜索、归档与恢复。
- 新增内置「通用助手」团队；分析会话在方案确认前默认采用只读执行权限。
- 新增侧边栏对话管理，支持未读与异常提醒、置顶、重命名、悬浮信息，以及跨刷新和重启保持状态。
- 新增单个有效成员提及的直达路由，为每位成员提供持久化任务队列，并显示待发射消息的真实目标。
- 新增跨 Codex、Kimi 与 Claude 的结构化执行终局和语义运行监督；异常结束时保留未完成正文，并允许使用临时 CLI、模型和推理强度原地重跑。
- 新增 provider 原生过程记录，在过程面板展示可信 transcript/wire 历史并保持同一会话的恢复语义；记录不可用时安全降级。
- 新增版本化的模型与推理强度注册表，用于配置各 Agent 的执行能力。
- 重新设计「设置」与「关于」，新增手动检查更新、复制版本号以及访问发布记录、源码和反馈入口。

### 变更

- 更新桌面首页、操作台外壳、首次引导、会话目录轨、图标和设置界面的视觉设计。
- 原样展示机器文本和 POSIX 路径；将裸绝对路径提升为只读文件引用，并允许在既有安全限制下查看工作空间外的本机文本文件。
- 将 Codex CLI 最低兼容版本提升至 `0.145.0`，并把运行环境校验延后到实际执行时进行。
- 更新公开官网的产品叙事、GitHub 链接和 Apple Silicon 下载入口。
- 重新设计中英文 README，补充产品预览、执行入口和运行边界说明。
- 加强测试基础设施，新增按依赖范围选择测试、跨 worktree 全量测试互斥以及统一的可诊断等待机制。

### 修复

- 恢复 Kimi 会话连续性，并提高 Kimi CLI 可执行文件发现的可靠性。
- 将 Kimi ACP 空 `end_turn` 作为安全失败处理，避免把缺少完整回复的执行误判为成功，并保留 canonical resume 语义。
- 修复大型会话存储可能导致本地操作台启动超时的问题。
- 限制会话事实日志的重复增长，改为增量追加与读取，并提供保持回放等价的存量日志压缩工具。
- 修复脱离 worker 的重试路由，以及新对话选择和草稿状态不同步的问题。
- 修复侧边栏 mutation 请求丢失 fetch receiver 的问题。
- 修复桌面更新检查未正确跟随正式版本标签的问题，并改为按需初始化 CLI readiness。

## [0.1.4] - 2026-07-28

### Added

- Added persistent Simplified Chinese and English language preferences across desktop onboarding, settings, the main console, and the status page.
- Added interactive Markdown file references that resolve workspace paths safely and open files in a dedicated reference view.
- Added a bundled feedback-driven engineering team with explicit investigation, implementation, review, and delivery responsibilities.

### Changed

- Formalized the console UI delivery workflow and required implementation teams to close work only when it is merge-ready.
- Disabled Codex internal collaboration agents for direct Moebius agent runs so team orchestration remains under the local runtime.
- Updated the release workflow to recommend a semantic version when none is supplied and wait for explicit user confirmation before publishing.
- Serialized integration tests and strengthened the CI gate used by production releases.

### Fixed

- Preserved new-conversation drafts independently for each workspace while navigating or switching projects.
- Surfaced Codex upgrade failures instead of allowing unsuccessful upgrades to appear complete.
- Repaired local-console system-event migration and state synchronization for existing sessions.

## [0.1.3] - 2026-07-27

### Added

- Added a collapsible conversation relay rail with participant lanes, message previews, timeline navigation, and per-conversation reading-position restoration.
- Added anchored expansion, path-drawing, preview-following motion, and an equivalent reduced-motion presentation for the relay rail.
- Added attempt-scoped Codex debug invocation chains with recorded prompt layers, raw tool events, model metadata, precise timestamps, completion states, and token usage while continuing to exclude reasoning content.
- Added persistent provider-session continuity for local desktop agents, AI team building, and the desktop GitHub runner, with fail-closed behavior when a prior session cannot be resumed safely.

### Changed

- Made team runtime profiles portable static configuration and deferred CLI, model, authentication, and execution validation to the actual agent run.
- Kept existing runtime-readiness guidance informational so it no longer blocks conversation creation, team selection, or the first message.
- Consolidated real-application evidence requirements into the bundled development-team roles.
- Required AI-generated teams to assign expensive validation and publication methods to one responsible member and state the conditions that activate them.

### Fixed

- Preserved relay-rail keyboard focus while navigating between conversation events.

## [0.1.2] - 2026-07-26

### Added

- Added Codex and Kimi CLI readiness detection, installation flows, and runtime profiles for desktop teams.
- Added official-team update management and bundled content-production, development, and product-development team definitions.
- Added live agent run activity, elapsed-time reporting, richer run outcomes, and a dedicated agent-conversation experience.

### Changed

- Required real-app evidence for product-development team acceptance and reused existing evidence rules across team roles.
- Added console screenshots to the English and Chinese project documentation.

### Fixed

- Isolated role runs from nested-agent state so delegated executions retain the correct runtime context.

## [0.1.1] - 2026-07-25

### Added

- Unified the desktop and prototype onboarding flow, including clearer environment readiness, recheck, and first-team setup states.

### Changed

- Reused verified QA evidence across agent handoffs to reduce repeated validation work.

### Fixed

- Allowed desktop instances with different data roots to run concurrently while retaining the single-instance guard for the same data root.
- Preferred the inherited shell `PATH` when repairing the desktop environment.
- Hid unused compatibility projects from the local console.
- Preserved session member display names throughout local-console state synchronization.

## [0.1.0] - 2026-07-24

### Added

- Initial public macOS Apple Silicon desktop release with the local conversation console, persistent sessions and agent teams, GitHub Issue runner, and read-only observer.
- Initial public project documentation, contribution guidelines, issue forms, pull request template, and continuous integration workflow.

[Unreleased]: https://github.com/tranfu-labs/moebius/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/tranfu-labs/moebius/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tranfu-labs/moebius/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/tranfu-labs/moebius/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/tranfu-labs/moebius/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/tranfu-labs/moebius/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/tranfu-labs/moebius/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/tranfu-labs/moebius/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tranfu-labs/moebius/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/tranfu-labs/moebius/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/tranfu-labs/moebius/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/tranfu-labs/moebius/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/tranfu-labs/moebius/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tranfu-labs/moebius/releases/tag/v0.1.0
