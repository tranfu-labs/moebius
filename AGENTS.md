# moebius · AI 项目操作手册

## 项目概览
产品品牌统一为 `Moebius`：技术 slug / 协议 namespace 使用 `moebius`，workspace package scope 使用 `@moebius`，环境变量前缀使用 `MOEBIUS`，打包态默认数据根为 `~/.moebius`。这是一条硬切换契约，不读取或接受此前产品标识对应的目录、环境变量或运行协议；当前 worktree 路径与 git remote 属于外部仓库状态，不由应用代码修改。

本项目是一个 Node.js + TypeScript 常驻脚本，并提供可选 Electron 桌面壳。桌面正式发行只提供 macOS Apple Silicon 的 DMG 与 ZIP。终端入口默认以 `pnpm start` 启动 local console/local 模式；只有显式执行 `pnpm start -- --github-mode` 才进入纯 GitHub runner 模式。GitHub runner 按白名单扫描 repository 的 open issue 更新，把 issue body 与 comments 归一化为带 speaker 的共享时间线，再通过独立 mention trigger 决定是否运行本机 `codex`；真正进入 Codex driver 前会给本轮触发源消息添加 `eyes` reaction 作为即时反馈（issue body 触发则打到 issue，comment 触发则打到该 comment）。提交版 `config.toml` 只作为示例，默认白名单为空；本机通过被忽略的 `config.local.toml` 配置监听 repository，并为每个 issue + role 维护独立 Codex thread。桌面形态启动后以本地对话操作台为主窗口，在数据根中启动本地 console server、显式 GitHub-mode runner child 与辅助诊断用的只读 observer，并使用本机 `codex` / `gh`。本地会话创建时可原子绑定一支 Agent 团队；执行名单按 session 严格解析，未绑定的存量会话才回退共享 `agents/`。每个本地会话以数据根 `sessions/` 下的只追加 jsonl 作为消息与会话事件唯一事实源，`local-console.sqlite` 保留可变流转状态与可重建索引；两边冲突时以 jsonl 为准。本地附件在数据根的专用托管区保存不可变内容，在 `local-console.sqlite` 保存草稿/消息有序引用；消息提交原子 claim 引用，运行前再复制到本轮 runDir，图片进入 Codex `--image`，普通文件只通过 prompt manifest 交付。

## 项目结构
```text
.
├── agents/
│   ├── dev.md                  # 开发者 agent 角色素材，声明 issue worktree 写访问
│   ├── dev-manager.md          # 技术负责人 agent 角色素材（技术决策 / 架构选型 / 质量保证，不写代码）
│   ├── ceo.md                  # CEO 共享身份素材：guardrail + 普通编排 agent，带 ledger context pre script
│   ├── ceo-scripts/            # CEO 剧本数据文件，不作为可 mention agent
│   ├── hermes-user.md          # Hermes 用户画像素材
│   ├── secretary.md            # CEO guardrail 规则维护秘书，带 current repo pre script
│   ├── qa.md                   # 测试设计 agent 角色素材（方案阶段对抗性审查，oracle 为 docs/architecture/invariants.md）
│   └── product-manager.md      # 产品经理 agent 角色素材
├── assets/
│   └── brand/                  # Moebius 品牌母版、生成产物与哈希 manifest
├── src/                        # TypeScript 运行时代码
│   ├── runner.ts               # 常驻心跳编排入口（扫描派发与执行解耦）
│   ├── runtime-mode.ts         # 启动参数解析：默认 local，exact --github-mode 进入 GitHub runner
│   ├── github-state-store.ts   # GitHub-mode SQLite 路径与 legacy 共库有界迁移
│   ├── runner/                 # runner 主链路内部副作用协调子模块（验收 pre-pass、外部路由、Codex reaction）
│   ├── scanner.ts              # 发现层：due 仓库扫描，产出 changed issues
│   ├── issue-dispatcher.ts     # 派发层：in-flight 防重、完成即折叠回写
│   ├── state-persister.ts      # intake state 单写者：写串行化 + 合并 + 原子落盘
│   ├── github-response-intake.ts # GitHub 响应接入的纯业务调度规则
│   ├── github-intake-state.ts  # GitHub response intake 在 github-runner.sqlite 的读写适配
│   ├── goal-ledger.ts          # 目标账本 schema、入账流程、ready gate、阶段切换、验收 fact / join 纯业务逻辑
│   ├── goal-ledger-state.ts    # 目标账本在 github-runner.sqlite 的读写适配
│   ├── issue-source.ts         # repo / issue source key 与 clone URL 生成
│   ├── local-config.ts         # config.toml / config.local.toml 解析与 shape 校验
│   ├── conversation.ts         # 共享时间线、speaker、agent mention、full/resume prompt 纯业务逻辑
│   ├── conversation-interrupt.ts # driver-agnostic conversation message count 中断检测
│   ├── issue-media.ts          # issue 图片 / 视频引用提取与媒体 manifest 纯业务逻辑
│   ├── media-assets.ts         # issue 媒体下载校验、输出 artifact 发现与 Markdown 生成
│   ├── github.ts               # gh CLI 读取 issue / 发表评论 / reaction / release artifact 发布
│   ├── retry.ts                # gh 调用错误分类 + 指数退避重试原语（可注入 sleep、支持 AbortSignal）
│   ├── codex.ts                # codex CLI 调用与 jsonl 解析
│   ├── driver-pool.ts          # codex driver job 并发策略抽象，默认由 runner 注入 5 并发上限
│   ├── stages.ts               # stage 枚举与 marker 宽容解析
│   ├── format-ceo.ts           # CEO guardrail 完整公开 issue context 校正与 fail-open 处理
│   ├── ceo-scripts.ts          # CEO 剧本文件加载与 workflow 校验
│   ├── ceo-orchestration.ts    # CEO agent 结构化编排输出解析、校验、key 与 child issue body 渲染
│   ├── local-console/           # 本地会话 jsonl 事实日志、托管附件、loopback API、运行准备与 SQLite 索引边界
│   ├── observer/               # 本地只读观察页：读配置、目标账本、.state 与 run manifest，不写状态
│   ├── triggers/               # mention 触发方式
│   ├── agent-prescripts/       # Codex 执行前准备脚本与内置 workspace capability
│   ├── agent-context-state.ts  # agent context 在 github-runner.sqlite 的读写适配
│   └── state.ts                # role thread 在 github-runner.sqlite 的读写适配
├── desktop/                    # Electron 桌面壳：主进程装配、操作台 / 状态页、runner 子进程监管与打包配置
│   ├── src/
│   │   ├── main.ts             # Electron 主进程装配：数据根、PATH、自检、observer、runner、IPC
│   │   ├── runner-child.ts     # utilityProcess 子进程入口，调用 src/runner.ts 的 start()
│   │   ├── preload.ts          # browser 边界构建的 sandbox preload，只从纯 contract 暴露窄 IPC
│   │   ├── console-page/       # 桌面操作台 renderer（含 selection/refresh gate、附件 preview/upload 草稿协调）
│   │   ├── status-page/        # 桌面辅助诊断状态页静态资源
│   │   ├── data-root.ts        # 数据根解析与首启种子拷贝计划
│   │   ├── team-*.ts           # Agent 团队实现、引导编排及 preload-safe IPC contract（见 module-map）
│   │   ├── shell-path.ts       # macOS 登录 shell PATH 读取与合并
│   │   ├── env-doctor.ts       # codex / gh / gh auth 自检
│   │   ├── runner-supervisor.ts # runner 子进程状态机与崩溃退避
│   │   └── updater.ts          # 平台更新策略与版本比较
│   └── tests/                  # 桌面壳纯模块 Vitest
├── packages/
│   └── console-ui/             # shadcn/Radix + Tailwind 的 React 对话操作台组件库与 Storybook
├── prototypes/                 # 与生产代码双向隔离的 React + Motion 高保真原型沙盒，发布自包含单 HTML
├── seeds/
│   └── teams/                  # 打包进桌面应用的只读内置团队种子
├── sites/                      # 面向公众的自包含静态营销站点（与产品运行时零耦合）
│   └── marketeam/              # 当前唯一官网：自包含 index.html + 同目录 DEPLOY.md（目录名 marketeam 为历史遗留；marketing-site 域）
├── scripts/
│   └── generate-brand-assets.mjs # 从唯一母版生成/检查桌面、UI 与官网图标
├── tests/                      # Vitest 单元测试
├── docs/
│   ├── product/                # 产品事实源：总 PRD + 页面 PRD（pages/）+ 跨页流程 PRD（flows/）
│   ├── adr/                    # 架构决策记录
│   ├── architecture/           # 模块地图
│   ├── wireframes/             # 历史版式参考；已建页面 PRD 的页面以 docs/product/pages/ 为准
│   └── protocols/              # GitHub issue 交互协议等协作规则事实源
├── openspec/
│   ├── changes/                # 先设计再实现的变更工作区
│   └── specs/                  # 当前行为事实规格
├── package.json                # pnpm 脚本与开发依赖
├── pnpm-lock.yaml              # 依赖锁定文件
├── tsconfig.json               # TypeScript 严格模式配置
└── LICENSE
```

## 常用命令
- 安装：`pnpm install`
- 生成品牌资产：`pnpm brand:generate`
  - 唯一母版是 `assets/brand/moebius.png`；脚本使用 macOS `sips` 等比缩放，不裁切、不抠图、不重绘，并更新 `assets/brand/manifest.json`。
  - 生成 1024px 应用图标、64px UI 图标、32px favicon、180px Apple Touch Icon及官网同内容部署副本。
- 只读检查品牌资产：`pnpm brand:check`
  - 校验母版和全部产物的 SHA-256、PNG 签名、正方形尺寸、文件大小上限与同尺寸部署副本哈希；desktop 打包会先执行该门禁。

### 启动形态（运维必读）
- **默认 local**：`pnpm start` 缺省进入 local console/local runtime，不加载 GitHub intake、不创建 GitHub heartbeat、不扫描或读取 GitHub issue。
- **纯 GitHub runner**：GitHub-mode flag 的确切名称是 `--github-mode`，固定用法是 `pnpm start -- --github-mode`；带 flag 后只启动 GitHub runner heartbeat，不启动 local console server。
- **常驻 runner 迁移**：本启动形态合入后，原常驻命令 `pnpm start` MUST 更新为 `pnpm start -- --github-mode`，否则会进入默认 local 模式。
- **数据隔离**：local 模式使用数据根 `sessions/*.jsonl` 会话事实日志与 `.state/local-console.sqlite` 可变状态/索引；GitHub 模式使用 `.state/github-runner.sqlite`。两种模式的运行时数据互不可见、不镜像，同一启动流程不并发启用两条写入链路。

- 运行本地模式：`pnpm start`
  - 默认只启动 local console/local runtime，使用 `.state/local-console.sqlite`；不加载 GitHub intake、不创建 GitHub heartbeat、不扫描或读取 GitHub issue。
  - 不配置 repository、未执行 `gh auth login` 的干净环境也可正常冷启动；只有本地会话真正调用 Codex 时才需要本机 `codex` CLI。
- 运行纯 GitHub runner：`pnpm start -- --github-mode`
  - flag 名固定为 `--github-mode`；只接受 exact flag，拼写错误、`--github-mode=1`、未知参数或重复参数会在启动任一 runtime 前失败。
  - 需要本机 `codex` CLI 在 `PATH` 中，并需要已完成 `gh auth login`。
  - 只启动 GitHub runner heartbeat，使用 `.state/github-runner.sqlite` 保存 GitHub intake、role thread、agent context 与 goal ledger；不启动 local console server，不写 local console 会话链路。
  - 会真实扫描 `config.local.toml` 中配置的白名单 repository 的最近更新 open issues；没有本机覆盖时默认不监听任何 repository。首次扫描默认只建立 baseline，不批量处理历史 issue。最新 issue body/comment 命中 mention trigger 时，可能调用 Codex 并发表评论；只有真正调用 Codex driver 前会先给本轮触发源消息添加 `eyes` reaction。
- 运行本地只读观察页：`pnpm observer`
  - 默认监听 `127.0.0.1:8787`，可用 `OBSERVER_PORT` 覆盖端口。
  - 只读读取 `config.toml` / `config.local.toml`、`.state/github-runner.sqlite`（缺失时兼容 legacy JSON / 共库）与 `.state/run-manifests.jsonl`，以目标账本为主视图渲染 goal -> milestone -> task 树、owner phase、人工闸口、显式 run evidence 与 unlinked local runs，并保留 legacy issue/run records。
  - 账本缺失、损坏或读取超时时只让 ledger tree 显示空态 / 诊断，legacy issue/run records 继续可见；同一 owner 无 active phase 显示 `no active phase`，多个 active phase 显示 owner 级 ledger error，不推断全局 active。
  - 不调用 GitHub、Codex 或 artifact publisher，不写 `.state` / manifest / release / worktree 文件；不提供确认按钮、写接口、file watcher 或 runner 操作能力；观察页进程崩溃或关闭不影响 runner。
- 运行桌面应用开发态：`pnpm desktop`
  - 使用 Electron 壳启动本地对话操作台主窗口，进程内以动态端口启动 local console server 与只读 observer，并以 `utilityProcess` 派生 runner 子进程。
  - 开发态默认数据根为仓库根；打包态默认数据根为 `~/.moebius`；两种形态都可用 `MOEBIUS_DATA_ROOT` 覆盖。
  - 首启会把提交版 `agents/` 与示例 `config.toml` 种子拷贝到数据根，已存在的文件一律不覆盖；内置团队从 `seeds/teams/` 打包后按内容指纹整体覆盖到 `<数据根>/teams/.system/`，指纹相同则跳过，用户团队目录不参与播种；用户本机仍通过数据根下被忽略的 `config.local.toml` 配置监听仓库。
  - 桌面壳只为 runner 注入 `MOEBIUS_DATA_ROOT`；`WORKDIR_ROOT` 默认派生自数据根（`<数据根>/workdir`），无需单独注入 workdir。runner child 显式以 GitHub mode 启动，因此不会重复启动 local console server。
- 桌面壳每次启动生成随机附件 capability，并只通过 preload 窄接口交给 renderer；图片 preview、原件上传、草稿恢复和移除都走 loopback local-console 附件 API。renderer 不直接读取托管目录、SQLite 或普通文件内容，附件 DTO 与 DOM 不得暴露原始路径、托管路径或 blob id。
- Agent 团队的 `team.json` 只保存名称、描述、主 Agent slug 与成员顺序；首次引导协作示例独立保存在同目录版本化 `onboarding-orchestration.json`，只供 onboarding RelayDemo。独立编排缺失或损坏不得改变团队健康度、身份指纹、会话 roster、真实主 Agent 调度或 Codex prompt；AI 建队在同一 staging 目录写入并重读两份文件后才登记。近期曾把 `relayBeats` 内嵌进 `team.json` / 团队记录的版本只做有界兼容：合法数据可过渡读取并在下一次安全团队写入前迁出，旧指纹重定位成功后收敛到核心指纹。
  - onboarding 的 AI 团队设计器是普通 `max-w-lg` 引导主体的响应式例外，宽高上限约为 `780px × 720px`；提交时先在 renderer 即时显示右侧用户气泡，再与服务端公开消息无重复收敛。团队提案卡不得在纵向 flex 中收缩裁切成员，超高内容只滚动设计器对话区。
  - 操作台采用 Codex 桌面端式两栏骨架：macOS 主窗口使用集成标题栏，左侧按已打开的持久化本地项目分组且只列根会话；带 `parentSessionId` 的裂变会话改由父时间线卡片聚合，每行显示子任务、成员与事实状态，点击后在右侧展开，窄窗覆盖主内容区；右侧主线仍是同一条多 agent 时间线，底部输入器承载项目 / 本地或隔离工作区上下文；输入器的 `@` 补全名单只取输入框底部当前显示团队的可用成员（含待生效团队），团队外的手写 `@slug` 保持普通文本；状态页和 observer 只保留为辅助诊断入口，路径、SQLite、runDir、cwd、内部 id 与原始输出不常驻对话页。
  - 桌面 renderer 只记住最后一次成功展示的用户根会话及其项目；重启时精确验证后恢复。没有记录、记录损坏、项目或会话已不可用时进入未选择项目的新建对话，不把 local-console API 的 `local/default` 或其他兼容回退当成用户选择。
  - 每个项目行右侧的新会话按钮只在该项目下创建会话；空白且无运行、消息或父子关系的会话可从 composer 项目菜单切换到其他已打开项目，保持 session id、草稿与选中态。create/open/rebind 共用同步 selection mutation gate；mutation owner refresh 可抢占旧 lease，非 owner refresh 不得提交，周期 refresh 保持 single-flight。已有消息、运行或父子关系的会话项目归属锁定。
  - 同一台机器上，终端 GitHub-mode 与桌面形态不得同时监听相同 GitHub repository；如确需切换形态，优先让终端 GitHub-mode 也设置同一个 `MOEBIUS_DATA_ROOT`，共享 GitHub runner state 与 `config.local.toml`。
  - dev 期 `pnpm desktop` 会打开 Chromium 远程调试端口 `9222`（仅当 `!app.isPackaged`），供 AI agent 通过 CDP attach 已运行的桌面窗口，读渲染进程的 DOM / console / network 并 eval 代码；打包版本永不开放。见 [ADR-0002](docs/adr/0002-electron-cdp-dev-debug-channel.md)，其补充节含实测证据与 Codex Chrome 扩展横向对比。
    - 目前只覆盖渲染进程一路；主进程 Node 的 console 与 IPC 状态若要读，需另开 `--inspect=9229`（尚未落地，见 ADR-0002 补充节）。
    - 首选走 `.mcp.json` 里的 `electron` MCP server；若它列不出窗口，可裸 CDP 兜底：`curl http://localhost:9222/json/version` 探活、`curl http://localhost:9222/json` 拿 target 列表后自建 WebSocket 挂载。
    - 端口冲突（被 Chrome debugger 或其他 CDP 工具占用）会导致 Electron 启动失败，可用 `lsof -iTCP:9222 -sTCP:LISTEN` 定位占用方。
- 构建桌面主进程 / 操作台 / 状态页：`pnpm --filter @moebius/desktop build`
  - desktop build 会先构建 `@moebius/console-ui`，renderer 只消费组件库已由 Vite/PostCSS/Tailwind 编译的 `globals.css` package export；构建产物若残留 `@tailwind` / `@apply` 或缺少关键 utility 会直接失败。
  - desktop 主进程与 runner child 产物为 Node ESM bundle，preload 为按 browser 边界构建的 Electron sandboxed CJS bundle；主窗口与状态窗口显式保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。preload 运行时只允许 `require("electron")`，IPC channel / renderer DTO 只从无 Node runtime 依赖的 `*-contract.ts` 导入；构建会拒绝 Node ESM 动态 `require` shim，以及 preload 中任何其它静态 `require()`。`yaml` 在 Node ESM bundle 中固定解析到官方纯 ESM browser export 并内联，避免主进程加载失败。
- 打包桌面应用：`pnpm --filter @moebius/desktop dist`
  - electron-builder 只生成 macOS Apple Silicon（arm64）的 DMG 与 ZIP，产物名固定含 `mac-arm64`；不得生成 Windows、Linux、macOS x64 或 universal 产物。
  - `.app`、DMG、Dock、操作台、onboarding、辅助状态页与官网统一使用 `assets/brand/moebius.png` 的脚本派生产物。
  - `desktop-v*` tag 会触发 `.github/workflows/release-desktop.yml`，workflow 只在原生 arm64 macOS runner 上构建并在打包前校验 `RUNNER_ARCH` 与 `uname -m`，随后上传 GitHub Release。正式更新口径只有 macOS“检查更新后跳转下载页”；Windows/Linux 分支仅可作为源码防御存在，不属于发布或产品支持范围。
- 运行 React 对话操作台组件库 Storybook：`pnpm --filter @moebius/console-ui storybook`
  - 组件库位于 `packages/console-ui`，使用 shadcn 风格源码组件、Radix 原语与 Tailwind 语义令牌。
  - 所有应用内品牌位置复用包内 `MoebiusLogo`，不得另画 SVG 或使用图标库中的 Infinity 代替。
  - `src/styles/tokens.css` 是包内令牌源：近黑底暗色优先的冷灰基底、accent 双主题统一靛蓝 `#5E6AD2`；运行状态渲染为状态 pill（图标 + tinted 底 + 同色描边），状态色相族为 running 琥珀 / pending 蓝 / waiting 紫 / completed 系中性灰，绿/红只用于裁决与危险（唯一例外：未读计数允许红色圆角标）；圆角基线 14px。`packages/console-ui/DESIGN.md` 是包内设计语言事实源（令牌纪律、排版、图标、状态语义、elevation/动效红线与组件模式目录）。
  - `@moebius/console-ui` 被 desktop renderer 复用；renderer 入口需引入 `@moebius/console-ui/globals.css`。desktop 的 `console.css` 只负责窗口/root 宿主约束，不得复制组件布局、按钮、输入框或卡片样式。
  - 用户与 Agent 正文统一由 `MarkdownMessage` / Streamdown 渲染：历史消息使用 static mode，活动 run 使用唯一 streaming 节点原地替换 `liveMarkdown`；系统事实继续使用结构化组件。支持 GFM、CJK、Shiki、KaTeX 和 Mermaid strict；链接仅允许 `http/https/mailto`，图片仅允许 `http/https`，确认后通过 desktop 单用途 IPC 交给系统浏览器。
  - 主时间线的会话 sticky 标题、历史消息正文与活动 run 的角色名/实时 Markdown 共用同一正文列；活动 run 操作贴住该列右边界。此对齐由 `OperatorConsole` 宿主负责，通用 `RunBlock` 保留独立的默认最大宽度。
- 构建并验证 onboarding 高保真原型：`pnpm --filter @moebius/prototypes check`
  - `prototypes/` 是 private 的设计原型沙盒，不进入 desktop / console-ui 正式构建；双向禁止 import，完整规则见 `prototypes/AGENTS.md`。
  - authoring 使用 React、Motion 与按 copy-source 方式采用的最小 beUI 动效原语，最终发布为可离线直接打开的 `docs/product/pages/onboarding.prototype.html`。
  - 构建先写 `prototypes/dist/` 临时目录，发布门禁确认脚本、样式与图形资源全部内联后才原子更新目标 HTML；Playwright 用 `file://` 验证完整旅程、环境硬门、接力重播、最终团队传递和 reduced-motion。
- T4 本地操作台验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t4.ts`
  - 会启动 fake local console server 和静态桌面 renderer，生成 `artifacts/acceptance/t4-live.png`、`artifacts/acceptance/t4-interrupted.png`、`artifacts/acceptance/t4-failed.png` 与 `artifacts/acceptance/t4-evidence.json`。
- T4.5 本地接力循环验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t45.ts`
  - 会启动 fake local console server，覆盖四角色本地接力、SQLite 位点重启续跑、`recordAgentResponse` 事务前失败、timeout stuck 释放 session、两个 session startup catch-up，并生成 `artifacts/acceptance/t45-evidence.json`。
- 本地 Codex 恢复定向测试：`pnpm exec vitest run tests/local-console-codex-resume.test.ts`
  - 覆盖正常步骤保持 full、Retry 精确恢复原 run、正常退出后自动接管、改一改重发的修正增量、上下文不兼容与 rollout 缺失时 full fallback，以及 cached input token 诊断事实。
- T5 本地 dead-letter/recovery 验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t5.ts --case deadletter-recovery-suite`
  - 会启动 fake local console server，覆盖连续失败 dead-letter、防重复刷同一失败、timeout/stale 重启恢复、`recordAgentResponse` 提交前连续失败、dead-letter 可见写失败后 retry、旧 SQLite failure metadata 迁移、dead-letter 不含合法 agent mention，并生成 `artifacts/acceptance/t5-evidence.json`。
- T5 子会话编排验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t5.ts --case child-session-acceptance`
  - 覆盖本地 CEO child session orchestration、`sessions.parent_session_id` 写入、侧栏刷新后以同级列表恢复全部裂变会话、store timeout、project mismatch、hidden key collision、corrupt parent chain，并生成 `artifacts/acceptance/t5-evidence.json`；`parent_session_id` 只服务运行时编排与恢复，不驱动 UI 树形层级。
- 本地主 Agent 收尾验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t5.ts --case primary-agent-closeout`
  - 覆盖用户直接点名专业成员仍先由团队主 Agent 接收、再由主 Agent 派工并最终收尾，并证明正文中的“验收 / 通过 / 不通过”不会写入本地 acceptance fact、integration event 或触发格式诊断；证据写入 `artifacts/acceptance/t5-evidence.json`。
- 测试：`pnpm test`
- 类型检查：`pnpm typecheck`
- lint/格式化：TODO: 当前尚未配置 ESLint / Prettier；改代码时至少运行测试与类型检查。

## 编码规范
- TypeScript 使用 `strict`，ESM + `moduleResolution: NodeNext`，相对导入运行时代码时使用 `.js` 后缀。
- 运行入口使用 `tsx src/runner.ts`；自动化测试使用 Vitest。
- GitHub 认证复用本机 `gh auth login`，仓库内不得保存 token。
- 启动模式只接受两种形态：`pnpm start` 缺省 local；`pnpm start -- --github-mode` 进入纯 GitHub runner。两种 runtime 不得在同一 `start()` 流程并存。
- local runtime 的会话消息与事件只经主进程 store 串行追加到数据根 `sessions/*.jsonl`，可变流转状态与可重建索引写 `.state/local-console.sqlite`；GitHub runner state 只写 `.state/github-runner.sqlite`。首次 GitHub-mode 启动会从历史共库中有界迁移 GitHub intake、role thread、agent context、goal ledger，不迁移 local session 数据；迁移失败时在扫描前可见失败，不 silent rebaseline。
- 当前 repository 白名单先读取数据根下的提交版 `config.toml` 示例，再由同一数据根下的 `config.local.toml` 覆盖；未设置 `MOEBIUS_DATA_ROOT` 时数据根等于项目根目录，终端形态行为与原来一致。`config.local.toml` 为本地专用且被 `.gitignore` 忽略。默认白名单为空。
- `config.local.toml` 示例：
  ```toml
  [[watchRepositories]]
  owner = "tranfu-labs"
  repo = "tranfu-agents-app"
  ```
- 闲时扫描间隔、忙时 issue 轮询间隔、运行中 agent 中断检测轮询间隔、扫描窗口、本地 agent Markdown 目录、数据根覆盖、role thread / agent context / 目标账本状态文件路径、issue 媒体大小限制、issue worktree git 超时、输出 artifact release tag 集中在 `src/config.ts`。
- GitHub response intake 默认闲时每 5 分钟扫描每个白名单 repo 的最近 20 个 open issues；issue 成功触发响应后进入 active；处理失败时不推进 intake `updatedAt`，而是记录 `failureCount` / `lastFailureReason`、保持 active 并按 1 分钟轮询重试，连续失败达 `FAILURE_RETRY_LIMIT = 5` 后尝试发布死信评论，死信发布成功才推进 `updatedAt` 并降回 idle；连续 5 次 active poll 无变化也会降回 idle；active poll / idle changed-issue 拉到 `state = CLOSED` 时从本地 intake state 移除，不触发 Codex / 评论。active issue 最新外部 user comment 无合法 mention 时，runner 会在 no-trigger 分支对该 comment id 执行一次 CEO 式轻量兜底路由判定；当前 processing cycle 正在处理的 issue body 若无合法 mention 且呈明显目标形状，也可用 `issue-body:<digest>` 有界 key 执行一次兜底路由，intake state 不保存完整 body/comment。目标明确时可 append 具体角色，目标不清或需要编排裁决时可 append `@ceo`，无意图时 no_action；判定结果记录为 `no_action` / `append` / `fail_open`，同一 comment id 或 issue-body digest key 不重复判定。若兜底决定 append 但 handoff 评论发布失败或超时，本轮返回 `failed`，不推进 `updatedAt`，也不保存成功 append route decision。兜底路由同样覆盖账本 child issue 上 agent 自身的最新无 mention 评论：账本已有该 child 的 passed 验收 fact 时不调 codex、确定性记 `no_action`（reason `ledger-task-closed`）；未闭环时带 ledger task 上下文交 CEO 判定，append 语义与防重、fail-open 规则同 user 路径；非账本 child issue 的 agent 评论不触发。
- runner 每分钟一轮**心跳**：`src/scanner.ts` 扫描 due 仓库找 changed issue，加上 due 的 active issue 转成 issue processing jobs，批内按 `issueKey` 去重后交给 `src/issue-dispatcher.ts` 派发，**心跳从不等待 job 执行**（防重入只覆盖秒级的扫描派发阶段）；`createDefaultRunnerDependencies()` 通过 `createDefaultCodexDriverPool()` 注入默认并发上限 `CODEX_DRIVER_POOL_MAX_CONCURRENT = 5`，超额 job 排队等前面空槽；`src/driver-pool.ts` 抽象本身仍允许 `undefined` / `null` 表示不限，便于测试注入 fake pool。调度业务逻辑仍集中在 `github-response-intake.ts`，不得引入 Codex / GitHub adapter 或 driver pool 依赖。
- `src/issue-dispatcher.ts` 维护跨心跳的 in-flight issue 集合：在跑 issue 重复派发记 `skip-inflight` 跳过（同 issue 严格串行、不同 issue 互不阻塞，长跑 codex 只占驱动池 1 个名额）；每个 job **完成即**把结果以纯函数折叠进 `src/state-persister.ts`（intake state 单写者，写串行化 + 合并 + 原子落盘，写失败记日志不中断），并执行 active 上限策略（豁免在跑 issue）。job 运行期间该 issue 的 intake state 不推进，中途变化由后续心跳依据折叠后的状态重新推导，不排队重放。
- `docs/protocols/github-interaction.md` 是 GitHub issue 共享时间线交互协议的单一事实源：`@` 只表示移交下一步控制权且每条消息最多一个合法 mention；`#N` 只用于真实 issue / PR 引用；runner 专属 role envelope 不得人工手写；带路由意图的人工评论必须显式带一个合法 `@`。所有 `agents/*.md` 必须最小引用并遵守该协议。
- `agents/<name>.md` 对应 issue 消息里的 `@<name>`；当前每轮只看共享时间线最新消息作为触发源，但具体触发方式由 `src/triggers/` 决定。`src/conversation.ts` 的 mention 解析会忽略 fenced code block 与 inline backtick 内的 agent mention，代码区域外的最早合法 mention 仍会触发。`agents/ceo.md` 现在是 CEO 一个身份、两条路径的共享素材：发布前 guardrail 路径只读取正文 persona、保持无状态 fail-open；普通 `@ceo` agent 路径进入独立 role thread，执行 ledger context pre script，并由 runner 承担 fail-closed 编排副作用。`agents/ceo-scripts/*.md` 是独立剧本数据，不放在顶层 `agents/*.md`，不会被当作 agent；当前必需剧本包含 `goal-intake`，其 action 为 `goal_intake`，并记录 `switch_phase` 的窄契约说明。
- `agents/<name>.md` 通过 YAML frontmatter 声明机器元数据，canonical 字段统一使用 snake_case：`pre_script` 或 `workspace_access`。runner 继续有界兼容 legacy `preScript` / `workspaceAccess`；同一语义的新旧字段并存但值冲突时必须明确失败。`pre_script` 路径必须是仓库内 `src/agent-prescripts/` 下的受信任脚本；`workspace_access` 只接受 `write` / `read-run`，只触发 runner 内置 issue worktree capability，不允许 agent Markdown 指定任意脚本；正文仍作为 persona 传给 Codex。
- issue worktree capability 由 `src/agent-prescripts/issue-worktree.ts` 实现：`agents/dev.md` 声明 `workspace_access: write`，`agents/qa.md`、`agents/product-manager.md`、`agents/hermes-user.md` 声明 `workspace_access: read-run`，`dev-manager`、`ceo`、`secretary` 不纳入首批。runner 在调用 Codex 前基于当前 GitHub issue source 创建 / 复用同 issue 共享 worktree，并把 Codex cwd 切到该 worktree；新建 worktree 使用去 role 化路径 `<WORKDIR_ROOT>/worktrees/<owner>__<repo>__<issue>` 和本地分支 `agent/<owner>__<repo>__<issue>`，首建从 freshly fetched `refs/remotes/origin/main` 创建。复用已有 issue workspace 时只刷新 / 检测 remote main 是否已被当前 `HEAD` 包含，并把 `mainStatus` 写入日志与 prompt context；即使 main 已前进，也不得自动删除、重建、merge 或 rebase 进行中 worktree。legacy dev context 通过懒迁移兼容：当旧 `dev` entry 匹配当前 issue 且旧 dev `worktreePath` 可访问时，新增 issue workspace entry 指向原路径，并保留旧 entry，不搬迁、不删除、不重建。repo cache 的 clone / fetch / worktree add / merge-base 检测按 `repoCachePath` 做进程内 keyed mutex 串行，所有 workspace git 调用必须有界超时，超时 / 失败 / abort 后释放 repo lock；跨不同 bare repo 的操作保持并发不受限。
- `read-run` 是协作约束而非 OS 级只读隔离：相关角色不得有意修改源码、提交或推送，但允许跑测试、起服务、生成构建缓存、测试输出和验收截图等临时产物。
- 本地会话以团队快照首成员作为主 Agent 单一事实：所有 composer 用户消息无论正文 mention 都先交给主 Agent，mention 只作为主 Agent 可见的派工意图；成员回复中的合法 mention 继续按显式交棒推进，非主 Agent 无 mention 回复确定性回到主 Agent，主 Agent 无 mention 回复推进 cursor 并结束本轮。每个 session 最多一个主 Agent run、每个专业成员最多一个执行 run，不同成员可并行；主 Agent 重定向正在工作的同一成员时先中断旧 run，等待终态后再串行重启。主 Agent 运行期间的新用户消息以持久化 FIFO 待发射，主 Agent 任一终态后逐条领取，专业成员终态不触发发射；中断始终按 `sessionId + runId` 精确匹配。local runtime 使用独立本地 prompt 注入主 Agent 与成员名单，不复用 GitHub Issue prompt。正文中的“验收”“通过”“不通过”等自然语言不产生本地程序状态或验收副作用；旧 SQLite acceptance 表只作历史只读兼容。session/project 的进行中事实由 cursor 待处理 source、主 Agent pending、全部活动 run、active claim、真实 running message 与待主 Agent 接回的专业结果合并派生，不代表任务成功或质量通过。
- 本地 Codex thread 只用于同一次未完成执行的局部恢复：普通新消息、主 Agent 派工、成员接力和下一步骤一律 full；正常退出对已收到 `thread.started` 的活动 run 先把 `graceful-shutdown` intent 写入 session JSONL 再 abort，下次启动按原 lane 自动接管；没有 intent 的崩溃/强杀 orphan 仍落成 stuck。主时间线和子会话 Retry 必须携带精确 `sessionId + runId`，改一改重发在新公开消息之外携带原 runId。恢复前必须校验 thread link、role/团队内容、工作空间指纹和本机 rollout；旧 link、缺失或不兼容时安全 full fallback，禁止按 session+role 或最近 thread 猜测。resume 消费结果与 `cached_input_tokens` 仅写诊断事实，不进入普通对话 DTO。
- 本地附件内容只写数据根下 `.state/local-console-attachments/`；SQLite 只保存不可变 blob 元数据与 draft/message refs。上传必须流式计数并由 magic bytes 分类，PNG/JPEG/GIF/WebP 只有在有界 PNG preview finalize 后才成为 ready 图片；正文与附件 refs 在同一 SQLite transaction 中形成用户消息。运行前只从托管副本复制到当前 `runDir/input-attachments/`，图片按顺序传入 `imagePaths`，普通文件只进入内部 prompt manifest；任何失败不得静默跳过附件或把内部路径写进 renderer 可见 DTO/错误。
- `agents/secretary.md` 声明 `src/agent-prescripts/current-repo-workspace.ts`；runner 在调用 Codex 前把 Codex cwd 固定到 moebius 当前仓库根目录。该 pre script 不创建 worktree、不读写 `.state/*`，用于让 `@secretary` 独立维护 `agents/ceo.md`、OpenSpec、测试与文档，而不污染 issue 级 worktree / thread。secretary 在该活仓库遵守 git 纪律：不建 / 不切 / 不 reset 分支、不开 PR，改动直接在当前分支完成，commit+push 前必须经用户 issue comment 同意。
- `agents/ceo.md` 声明 `src/agent-prescripts/ceo-ledger-context.ts`；runner 只在普通 `@ceo` agent 路径执行该 pre script。它 fail-closed 校验 `.state/goal-ledger.json` schema 合法、必需 CEO 剧本存在，并在当前 issue 能唯一关联到 active phase projection 时把当前阶段 projection、可见 task、ledger owner 和可用 workflow id 确定性注入 prompt；当账本缺失 / 为空或当前 issue 没有唯一 active owner 且账本可加载时，它返回 goal-intake bootstrap context，供 CEO 只走 `goal_intake` 入口，不伪造 active phase projection。guardrail 路径不执行此 pre script。
- `@dev` Codex 运行期间会按 conversation message count 做运行中断检测；如果 GitHub issue 在本轮 Codex 完成前新增 comment，runner 会中断当前 Codex 子进程，不发表评论、不更新 role thread，并保持 issue active 以便下一轮基于最新 timeline 重跑。
- runner 只在 mention trigger 进入真实 Codex driver 路径、prompt plan 需要执行且 workspaceAccess / preScript 均成功后，为本轮触发源消息添加一次 `eyes` reaction：触发源是 issue body 时打到当前 GitHub issue，触发源是 comment 时打到该 comment；no-trigger、workspaceAccess 失败、preScript 失败、prompt plan skip 或 resume fallback 不重复添加 reaction。reaction 添加失败只记录日志，不阻断 Codex 执行。
- runner 在真正进入 Codex driver 前会解析本轮 prompt 范围内的 issue 图片 / 视频引用：full run 与 fallback full run 使用完整公开 timeline，resume 只使用新增外部 delta 消息。媒体引用提取由 `src/issue-media.ts` 纯函数完成，不访问网络 / 文件系统。
- issue 媒体下载与校验由 `src/media-assets.ts` 完成，文件只写入本轮 Codex `runDir/input-media/`，不写入目标 worktree、`agents/` 或 `.state/`。图片默认上限 10MB，视频默认上限 100MB；只接受 `http:` / `https:` URL 与图片 / 视频 MIME。媒体准备失败时 runner 发布一条带当前 agent role envelope 的错误评论，且不调用 Codex、不更新 role thread，并把该触发视为已处理，避免同一坏链接每分钟重复刷屏。
- Codex 图片输入通过 `codex exec --image <file>` / `codex exec resume --image <file>` 传递；视频因当前 Codex CLI 没有视频 attachment 参数，以本地文件路径 manifest 的形式注入 prompt，供 Codex 用本地工具检查或抽帧。
- Codex 成功后，runner 会发现本轮新增 / 修改或最终回复明确引用的 SVG、图片、视频产物，复制到 `runDir/output-artifacts/` 后通过 artifact publisher 发布为 GitHub comment 可查看链接；默认 publisher 使用同仓库 GitHub release tag `moebius-artifacts` 上传 release assets，不把生成产物提交到业务仓库。artifact 发布失败时发布错误评论，不更新 role thread，不伪装成已交付。
- 普通 `@ceo` agent 成功返回后，runner 只接受带合法 `in-progress` stage marker 的结构化 JSON 编排输出。`spawn_child_issues` 工作流会先校验 workflow id、ledger task id、initialRole、qualityBaseline、验收语句、依赖、分组与 provenance，再通过 `src/github.ts` 的受控 adapter 在父 issue 同仓库串行创建子 issue，body 必须包含 parent reference、ledger task id、质量基准、验收语句、依赖、初始交棒角色、provenance、冲突分组理由与 hidden orchestration key。orchestration key 只由 parent issue source + workflow id + ledger task id 派生；重试时先查 ledger child ref，再按 hidden key 查询父 repo，唯一命中则补写 ledger，不重复创建。`goal_intake` 工作流使用单 action 多 mode：`interview` 只发可见 2-4 问采访；`propose` 校验 2-5 个粗里程碑、一个阶段一、3-7 个阶段一任务与每任务 1-3 条验收语句，写 pending ledger bundle，并发布带 hidden proposal key 的待确认提案；`confirm` 校验 proposal key 与阶段一任务描述，先把 ledger 转 ready/active，再复用既有 spawn executor 创建或找回阶段一子 issue。创建、查询、ledger 保存和 fail-closed 可见评论都必须有界；全部副作用成功后才保存 ceo role thread，失败不保存 thread，已创建 / 找回 issue 不删除补偿，失败原因保留 URL 供 dead-letter 留痕；fail-closed 评论发布失败时本轮仍为 `failed`。runner 还会在 mention trigger 前执行验收 pre-pass：验收角色评论先写入 child acceptance fact 或 parent integration acceptance event；全部 in-scope child passed 后按 hidden integration key 在父 issue 发起目标级集成验收；父级验收失败按 hidden orchestration key 创建或找回 repair child issue。验收角色评论声明整体通过但逐条走查解析失败时，pre-pass 记录 `acceptance-walkthrough-unparsed` 事件并以 CEO envelope 发一条含规范格式模板的提醒（mention 该验收角色，hidden reminder 标记防重，单 issue 封顶 2 次，超过只记日志落回普通流程）；join waiting 时会核实 missing 子 issue 的 GitHub 状态，发现已 closed 则在父 issue 发一条按 hidden integration-blocked key 防重的 blocked 上报，状态查询失败 fail-open 维持 waiting。T8 只记录 `switch_phase` 窄契约，不新增自动阶段切换 pre-pass、observer UI 操作或 T9/T10 dogfood runner。
- 所有 Codex agent 的每条响应末尾都必须显式声明 stage marker；stage 枚举集中在 `src/stages.ts`，当前为 `plan-written`、`code-verified`、`in-progress`。`agents/dev.md` 可用 `plan-written` / `code-verified` 声明开发阶段，普通进度、采访、澄清或其他 agent 默认使用 `in-progress`；stage 只声明阶段，不直接指定后续 agent。persona MUST NOT 输出枚举外的 stage 值（会被静默解析为 unknown）。五个可触发角色（dev / qa / product-manager / dev-manager / hermes-user）的每条评论按统一输出骨架产出（`## 结论`、`## 依据`、角色专属节、`## 下一步`），`## 下一步` 必含恰一条收尾行：`交棒：@<合法角色> …` 或 `等待真人：…`；CEO guardrail 的「交棒完整性裁决（第 0 检查）」对无收尾行的评论禁用 `no_change` 并强制 `append` 路由（规则见 `openspec/specs/github-issue-runner/spec.md` 的 T7 节）。
- `agents/dev.md` 的 `plan-written` 响应正文末尾必须包含「验收语句」一节，并位于最终 stage marker 之前；每条验收语句必须是一句可机械执行的检查，UI 类使用 `打开 X → 做 Y → 应看到 Z`，非 UI 类使用等价命令 / 断言格式（如 `跑 X → 应输出/退出码 Z`），数量与方案功能点一一对应。
- runner 在 Codex agent 生成 `LAST_RESPONSE` 后、发布 GitHub 评论前调用 `src/format-ceo.ts`，用 `agents/ceo.md` 的 persona body、CEO 剧本摘要和完整公开 issue context（issue 链接、issue body、所有 comment body 原文、最新响应、agent 名、allowedStages）做一次无状态 CEO guardrail 校正；`latestResponse` 仍是本轮唯一待发布的 agent 响应，完整 issue context 只作为理解用户流程、后续覆盖指令、历史上下文和交付规范的背景。CEO 输出统一为 JSON，三态 `action`：`no_change` 直接发原文；`replace` 用改写后的 `body`（末尾必带合法 stage marker）替换原评论，runner 追加 `ceo-corrected` metadata 后发布；`append` 让 runner 先发原评论、再发一条独立评论（前缀与 `role=<as>` metadata 按 `as` 字段决定，`as` 允许 `{ceo, dev, dev-manager, product-manager, hermes-user, secretary, qa}`；独立评论末尾追加 `ceo-corrected` metadata）。所有 runner 发布的 role envelope 评论必须带 `ceo-reviewed` 审计 metadata；实际经过 CEO 的评论标明 `no_change` / `replace` / `append_*` / `fail_open`，未实际调用 CEO 的系统错误、dead-letter、兜底 route append 标明 bypass 或 not-applicable reason；`ceo-corrected` 只表示 replace / append 修正子类。CEO 超时、失败、返回非法 JSON / 未知 action / 未知 as / body 空 / stage marker 缺失时 fail-open 发布原文；当 `agent=ceo` 时，guardrail 对 `append as=ceo` 或 append body 回交 `@ceo` 的结果 fail-open，防止自激。业务判据（触发条件、模板措辞、`@mention` 与否等）全部由 `agents/ceo.md` 和 `agents/ceo-scripts/` 承担，`format-ceo.ts` 只做格式红线校验与防自激后置校验。persona 层（`agents/ceo.md`）当前只承载 `no_change` / `append` 两种 guardrail 输出（`replace` 保留为代码层能力），并承载协作生态认知：真实可触发 agent 清单、阶段验收回流路由（`plan-written` 先派 `@qa` 测试设计审查，`code-verified` 回流发起需求角色，交棒正文一律一行轻交棒，方法论由目标角色 persona 自持）、qa 交棒兜底、缺验收语句时要求补齐、交付规范、死锁等待、PR 冲突提醒和免确认操作放行识别场景。CEO 对 PR 下判断前必须在其 Codex 子进程内用 `gh pr view <完整URL> --json title,body,state,mergeable,mergeStateStatus` 核实 PR 真实状态（`format-ceo.ts` 代码层仍不调用 GitHub），`gh` 失败时不基于猜测介入；免确认清单（只写在 `agents/ceo.md`，dev 行为不变）为从最新 `origin/main` 建 feature 分支、落盘 `openspec/changes/`、方案经 qa 测试设计审查通过且发起角色验收通过后进入实现阶段（不再要求用户口头"开始写代码"），清单外操作（push、建/合 PR、删除类）仍等用户。CEO 规则进化入口是 `@secretary`；CEO 默认超时为 300 秒（`DEFAULT_CEO_TIMEOUT_MS`），为子进程内 `gh` 核实留余量。
- `agents/ceo.md` 承载 CEO speaker，且 `@ceo` 是普通 mention 可触发 agent；`src/conversation.ts` 的 `normalizeComment` 对 `<!-- moebius:role=ceo -->` metadata 特殊处理直接归为 `speaker=ceo`，不依赖 mention trigger 白名单。
- `plan-written` / `code-verified` 阶段由 CEO guardrail persona 承接验收回流：有可用「验收语句」时，`plan-written` 必须 `append as=ceo` mention `@qa`，正文为一行轻交棒（陈述已输出 `plan-written` 且含验收语句，请 qa 按其自身测试设计流程审查）；`code-verified` 必须 `append as=ceo` mention 发起需求 agent，正文为一行轻交棒（请其按已确认验收语句逐条验收实现证据），执行方 `dev` 只能裸写、不得额外 mention；CEO 交棒正文不得复制目标角色 persona 已有的审查 / 验收方法清单；缺验收语句时 `append as=ceo` mention `@dev` 要求补齐；若发起者是真人用户而非 agent，最新评论已含 `等待真人：` 行时 `no_change` 等用户，未含时 `append as=ceo` 裸写请真人按验收清单逐条验收（不使用 agent mention），不得静默等待。若 CEO append 正文包含有效 agent mention，后续由下一轮 active poll 按普通 mention trigger 处理。
- `agents/hermes-user.md` 与 `agents/product-manager.md` 被 mention 请求验收方案或实现时，必须按可用「验收语句」逐条走查并输出结构化结论；每条结论独立一行、行首为 `N. 通过 — 依据` 或 `N. 不通过 — 依据`（编号与验收语句序号一致，不用表格、不加「原验收」等前缀变体），走查后必须有独立一行 `验收结论：通过/不通过`——该格式是 runner 逐行解析写入账本的硬约束。方案阶段基于 dev 方案推演，代码阶段基于 dev 提供的测试输出、截图 artifact、文件路径或命令输出等证据；全部通过时声明验收通过并说明下一步等待谁，任一不通过时 mention `@dev` 并指出未过语句、实际观察与期望差异。
- runner 写回 agent 评论时使用 GitHub 页面可见的 `<role>:\n${LAST_RESPONSE}` 前缀；comment body 中落 `&lt;role&gt;:\n${LAST_RESPONSE}`，并追加 `<!-- moebius:role=<role> -->` metadata，便于后续归一化 speaker。
- 每个 role 在同一个 issue 内维护独立 Codex thread；状态保存在被忽略的 `.state/role-threads.json`，包含 issue、role、threadId、lastSeenIndex。并发 Codex 成功写回时必须使用 issue + role entry 级别的串行 merge helper，不能用旧 state snapshot 覆盖整文件。
- agent context 保存在被忽略的 `.state/agent-contexts.json`；issue workspace 使用保留 entry 记录 issue、`workspaceAccess`、内置 capability 标识、目标仓库、共享 `worktreePath`、`mainStatus`、legacy 懒迁移来源与 `preparedFromMessageIndex`，旧 role preScript context 继续兼容读取。并发 context 写回时必须使用 issue + entry 级别的串行 merge helper。
- GitHub response intake 状态保存在被忽略的 `.state/github-response-intake.json`，记录 repo 闲时扫描时间、issue `updatedAt`、active/idle 模式、active 无变化次数、失败次数 / 最近失败原因、下次轮询时间，以及可选的外部无 mention 兜底路由判定 ledger（按 comment id 或 `issue-body:<digest>` 有界 key 记录 outcome、判定时间、reason 与 targetRole，不能保存完整 issue body/comment）。
- 目标账本状态保存在被忽略的 `.state/goal-ledger.json`，记录 goal / milestone / task / phase、质量基准、验收语句、依赖、provenance、父子 issue reference（含有界 note）、run manifest reference、验收 fact、集成验收 event 与阶段归档引用；`src/goal-ledger.ts` 只做纯业务 schema、部分入账、goal-intake pending proposal / confirm helpers、ready gate、阶段切换、当前阶段上下文投影、join 评估与归档引用回查，`src/goal-ledger-state.ts` 负责原子读写、entry-level merge、同文件写串行化、可注入 IO 与 timeout / AbortSignal 包装。CEO 编排可以通过 runner 显式读取当前 projection 并写入 task child issue reference / orchestration key；验收 pre-pass 可以通过 runner 显式写入 bounded acceptance provenance 和 integration event；目标账本自身不得调用 GitHub、Codex、shell，不得成为 runner 心跳、observer UI、worktree 或 fan-out 拓扑的隐式入口。
- Codex stdout/stderr 运行目录格式为 `/tmp/moebius-<ISO>-c<count>-r<sequence>/`；`<sequence>` 是 runner 进程内递增后缀，用来避免并发 runs 在同一 timestamp + count 下复用同一目录。本轮下载的输入媒体位于 `input-media/`，准备发布的输出产物位于 `output-artifacts/`。
- `src/codex.ts` 在保持 stdout/stderr 完整落盘与最终文本提取的同时，以 1 MiB 单行上限 framing 完整 JSONL 行，可选回调只暴露 `item.completed` 的 `agent_message` 正文。local runtime 只把最新一段投影到当前 `ActiveLocalRun.liveMarkdown` 内存/API snapshot，各段 Agent 可见进度事实追加到会话 jsonl，但不写 `session_messages`、不推进 cursor；run 结束后仍只形成一条最终 Agent 消息事实。
- local run 收到 Codex `thread.started` 后，必须通过 session fact 单写漏斗追加 `runId + sourceMessageId + role + threadId + startedAt` 的稳定关联；同值重放幂等、冲突 fail closed。过程标签只依据该关联在当前 Codex sessions 根内唯一定位 rollout JSONL，旧 run 无关联或源文件缺失 / 重复 / 越界 / 不可读时明确 unavailable；不得从 Moebius runDir、tmp、stdout/stderr tail、最终回复或时间猜测补关联。
- 过程标签把每个 attempt 启动时的用户 / Agent 公开时间线与 Codex rollout 中的 Agent Markdown、命令、工具 / 函数 / MCP、文件、错误投影成友好事件；系统 prompt、persona、团队规则、token、内部 id、原始 reasoning 与原始 JSON 不下发。读取使用跨 attempts 的反向分页和活动 append cursor，尾部半行等待完成；renderer 使用动态高度虚拟列表，首开到底、离底暂停跟随、上页插入保持 event-key 锚点，并按来源跨标签关闭与应用重启恢复阅读位。
- 默认工作根目录（git worktree 根）派生自数据根 `<数据根>/workdir`，可通过 `MOEBIUS_WORKDIR_ROOT` 覆盖；启动日志会打印解析后的路径。
- 默认数据根为项目根目录；可通过 `MOEBIUS_DATA_ROOT` 覆盖 `config.toml`、`config.local.toml` 与 `agents/` 的解析位置。桌面打包态默认数据根为 `~/.moebius`，开发态默认仓库根。
- Codex 默认走本机 `~/.codex/auth.json` 订阅登录；在 `config.local.toml` 里加 `[codex] provider = "<name>"` 即切到 API 网关（例如 `tranfu` / `derouter`）。provider 名会按约定 `<NAME>_API_KEY` / `<NAME>_BASE_URL` 从 `process.env` 读，`.env` 在项目根被 `src/config.ts` 顶层用 `process.loadEnvFile` 加载一次；缺任一变量会在启动时抛可见错误并且 NEVER spawn codex。切换只追加 `-c model_provider=... -c model_providers.<name>.{name,base_url,env_key,wire_api}` 到 `codex exec` 尾部，NEVER 改写用户 `~/.codex/config.toml`，也 NEVER 触碰 `--yolo / --json / -m gpt-5.6-sol / xhigh` 等既有 flag。模型名默认 `gpt-5.6-sol`，可通过 `[codex] model = "..."` 覆盖（空白/未设 → 回落默认），与 provider 相互独立。
- `github-response-intake.ts`、`goal-ledger.ts`、`local-config.ts`、`conversation.ts`、`conversation-interrupt.ts`、`issue-media.ts` 与 `ceo-orchestration.ts` 只做业务数据操作；`ceo-scripts.ts` 只读剧本数据并校验 workflow；`src/triggers/` 封装 mention 触发规则；`driver-pool.ts` 只承载 driver job 并发策略；`scanner.ts` 只做发现、`issue-dispatcher.ts` 只做派发与折叠、`state-persister.ts` 只做单写者状态持有与落盘；GitHub、Codex CLI、媒体 IO、状态文件读写分别由 `github.ts`、`codex.ts`、`media-assets.ts`、`state.ts`、`agent-context-state.ts`、`github-intake-state.ts`、`goal-ledger-state.ts` 适配；`runner.ts` 只做心跳编排、依赖装配与 issue-processing 主顺序，`src/runner/*` 只承载 runner 主链路内部的高内聚副作用协调（如验收 pre-pass、外部路由、Codex execution reaction），仍属于 GitHub issue runner 边界，不得成为新的业务事实源；`src/observer/` 是本地只读旁路，只读消费配置、目标账本、`.state` 与 run manifest，禁止被 runner 主链路依赖。
- 本地脚本执行必须把 GitHub issue 内容当作数据处理，不能拼接成 shell 命令；调用外部命令必须使用 `child_process.spawn(cmd, args[])`，不得使用 `exec` / `execSync` / `shell: true`。

## 修改前检查
- 改用户可见行为前，先读 `docs/product/` 对应的页面 / 流程 PRD。**`docs/product/` 是产品意图事实源，领先于实现（可以写还没做的）；`openspec/specs/` 是行为事实源，落后于实现（只记录已实现并验证的）。两者时间性相反，NEVER 互相替代，NEVER 把同一条规则原样抄两份。**
- 读 `docs/architecture/module-map.md` 确认依赖边界。
- 读相关 `openspec/specs/<domain>/spec.md`。
- 动 `packages/console-ui` 前必读 `packages/console-ui/DESIGN.md`（包内设计语言事实源）。
- MUST 确认改动 NEVER 引入 module-map 中被禁的依赖方向；若必须破坏，先写一条 ADR 记录再改。

## 修改后检查
- 跑测试 / lint / 构建，三者全绿（退出码 0）方可提交；任一失败 → 先修复，NEVER 带红提交。
- 更新受影响的 ADR。
- 按 `openspec/changes/AGENTS.md` 的三档分流决定事实源怎么更新：事实没变 → 什么都不写；行为变了、产品意图没变 → **同一个 commit 内联改 `openspec/specs/`**，不建 change；产品意图变了 → 走完整 change 流程。

## 禁止事项
- MUST NOT 提交 GitHub token、个人访问令牌、本地绝对路径、执行日志中的敏感内容或 `.env` 文件。
- MUST NOT 提交本机 `config.local.toml`；它用于本地 repository 白名单。
- MUST NOT 把 issue title/body/author 等外部输入直接拼接到 shell 命令中执行。
- MUST NOT 把 `agents/` 当作运行时状态目录；它只存放可被 mention 寻址的 Markdown 角色素材。
- MUST NOT 允许 issue body/comment 或 agent Markdown 正文指定任意可执行脚本；只有 frontmatter 中指向 `src/agent-prescripts/` 的受信任 registry 脚本可执行。
- MUST NOT 编造尚未存在的运行命令；新增脚本后同步更新本文件、模块地图和相关 OpenSpec。
- 当前 `agents/` 是角色素材，不应被运行时代码隐式改写或当作状态存储目录。
