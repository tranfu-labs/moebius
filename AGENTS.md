# moebius · AI 项目操作手册

本文件只承载四类内容：项目地图、命令入口、红线、域文档指针。**行为细节一律住在域 spec / 域文档里，不复制到这里**（见「修改后检查」的更新闸门）。

## 项目概览
产品品牌统一为 `Moebius`：技术 slug / 协议 namespace 使用 `moebius`，workspace package scope 使用 `@moebius`，环境变量前缀使用 `MOEBIUS`，打包态默认数据根为 `~/.moebius`。这是一条硬切换契约，不读取或接受此前产品标识对应的目录、环境变量或运行协议；当前 worktree 路径与 git remote 属于外部仓库状态，不由应用代码修改。

本项目是一个 Node.js + TypeScript 常驻脚本，并提供可选 Electron 桌面壳（正式发行只有 macOS Apple Silicon）。两种运行形态：`pnpm start` 缺省进入本地对话操作台（local console）；`pnpm start -- --github-mode` 进入纯 GitHub issue runner，扫描白名单仓库的 issue、按 mention 触发本机 `codex` 并回写评论。桌面形态以本地操作台为主窗口，内嵌 local console server、GitHub-mode runner 子进程与只读 observer。本地会话以数据根 `sessions/*.jsonl` 为唯一事实源，SQLite 只存可变流转状态与可重建索引。

## 项目结构
```text
.
├── agents/                 # 可被 mention 寻址的 agent 角色素材（dev / qa / ceo / secretary 等），frontmatter 声明机器元数据
├── assets/brand/           # 品牌唯一母版、生成产物与哈希 manifest
├── src/                    # 运行时代码：runner 心跳编排、GitHub intake、目标账本、会话、Codex/gh 适配、local-console、observer、triggers、agent-prescripts
├── desktop/                # Electron 桌面壳：主进程、preload、操作台/状态页 renderer、runner 子进程监管、打包配置
├── packages/console-ui/    # shadcn/Radix + Tailwind 的 React 操作台组件库与 Storybook
├── prototypes/             # 与生产代码双向隔离的高保真原型沙盒（规则见 prototypes/AGENTS.md）
├── seeds/teams/            # 打包进桌面应用的只读内置团队种子
├── sites/marketeam/        # 自包含静态官网（marketing-site 域，同目录 DEPLOY.md）
├── scripts/                # 品牌资产生成、验收脚本
├── tests/                  # Vitest 单元测试
├── docs/
│   ├── product/            # 产品意图事实源：总 PRD + 页面/流程 PRD
│   ├── architecture/       # module-map.md（模块职责与依赖边界）、invariants.md
│   ├── adr/                # 架构决策记录
│   ├── wireframes/         # 历史版式参考；已建页面 PRD 的页面以 docs/product/pages/ 为准
│   └── protocols/          # github-interaction.md：issue 共享时间线交互协议唯一事实源
└── openspec/
    ├── specs/              # 当前行为事实规格（落后于实现，只记录已实现并验证的）
    └── changes/            # 先设计再实现的变更工作区（规则见 openspec/changes/AGENTS.md）
```
模块级职责与依赖边界的事实源是 `docs/architecture/module-map.md`，不在本文件展开。

## 常用命令
- 安装：`pnpm install`
- 品牌资产：`pnpm brand:generate` 生成 / `pnpm brand:check` 只读校验（管线与门禁见 `openspec/specs/product-identity/spec.md`）
- 本地模式：`pnpm start`（干净环境可冷启动；只在真正调用 Codex 时需要本机 `codex` CLI）
- 纯 GitHub runner：`pnpm start -- --github-mode`（flag 必须 exact，见下方红线；需要 `codex` CLI 与 `gh auth login`）
- 只读观察页：`pnpm observer`（默认 `127.0.0.1:8787`，`OBSERVER_PORT` 覆盖端口；只读旁路，行为见 `openspec/specs/local-console/spec.md` observer 节）
- 桌面开发态：`pnpm desktop`（数据根、种子拷贝、附件 capability 等行为见 `openspec/specs/desktop-shell/spec.md`；dev 期开放 CDP `9222` 供 AI 调试，见 ADR-0002，首选 `.mcp.json` 的 `electron` MCP server）
- 桌面构建：`pnpm --filter @moebius/desktop build`（构建门禁见 desktop-shell spec）
- 桌面打包：`pnpm --filter @moebius/desktop dist`（只产 macOS arm64 DMG/ZIP；`desktop-v*` tag 触发发布 workflow，红线见 desktop-shell spec）
- 组件库 Storybook：`pnpm --filter @moebius/console-ui storybook`（设计语言事实源是 `packages/console-ui/DESIGN.md`）
- Storybook 门禁：`pnpm --filter @moebius/console-ui check:storybook`（检查 Component / Block / Page 分类并构建静态 Storybook）
- 原型构建验证：`pnpm --filter @moebius/prototypes check`（沙盒规则见 `prototypes/AGENTS.md` 与 `openspec/specs/design-prototypes/spec.md`）
- 验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t4.ts`、`.../local-console-t45.ts`、`.../local-console-t5.ts --case <deadletter-recovery-suite|child-session-acceptance|primary-agent-closeout>`、`.../local-console-direct-member-mention.ts`（验证的行为以 `openspec/specs/local-console/spec.md` 为事实源；运行证据写入脚本打印的系统临时目录）
- Dashboard UI 验收：`pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts`（自动断言）/ `... --hold`（保留真实 Electron 窗口供人工复核；临时数据与 evidence 均写系统临时目录）
- 定向测试：`pnpm exec vitest run tests/local-console-codex-resume.test.ts`
- 测试：`pnpm test`；类型检查：`pnpm typecheck`
- lint/格式化：TODO: 尚未配置 ESLint / Prettier；改代码时至少跑测试与类型检查。

## 域文档指针
按改动所属域读对应事实源；一个改动通常只涉及一两个域。

| 域 | 行为事实源 | 补充 |
|---|---|---|
| GitHub issue runner（intake / 心跳派发 / worktree / CEO 编排与 guardrail / stage marker / 媒体与 artifact / codex provider 切换） | `openspec/specs/github-issue-runner/spec.md` | 交互协议 `docs/protocols/github-interaction.md`；agent 素材约定见 `agents/*.md` frontmatter |
| 目标账本（goal / milestone / task / 验收 fact） | `openspec/specs/goal-ledger/spec.md` | |
| 本地会话运行时（jsonl 事实源 / 主 Agent 控制 / 恢复 resume / 附件 / observer） | `openspec/specs/local-console/spec.md` | |
| 桌面壳（数据根 / 种子 / 团队 / preload 边界 / 打包发布 / 更新） | `openspec/specs/desktop-shell/spec.md` | ADR-0002（CDP 调试通道） |
| 操作台 UI（时间线 / composer / 侧栏 / onboarding / RelayDemo / Markdown 渲染） | `openspec/specs/console-ui/spec.md` | 设计语言 `packages/console-ui/DESIGN.md` |
| 设计原型沙盒 | `openspec/specs/design-prototypes/spec.md` | `prototypes/AGENTS.md` |
| 官网 | `openspec/specs/marketing-site/spec.md` | `sites/marketeam/DEPLOY.md` |
| 产品标识与品牌资产 | `openspec/specs/product-identity/spec.md` | |

## 编码规范
- TypeScript `strict`，ESM + `moduleResolution: NodeNext`，相对导入运行时代码使用 `.js` 后缀。
- 运行入口 `tsx src/runner.ts`；自动化测试使用 Vitest。
- 业务纯逻辑与 IO 适配分层：`github.ts` / `codex.ts` / `*-state.ts` 等做适配，纯业务模块不得引入 GitHub / Codex / shell 依赖；边界以 `docs/architecture/module-map.md` 为准。
- 间隔、上限、路径等运行参数集中在 `src/config.ts`；repository 白名单用被 `.gitignore` 忽略的 `config.local.toml` 覆盖，提交版 `config.toml` 只是示例、默认白名单为空。
- GitHub 认证复用本机 `gh auth login`；Codex 默认走本机订阅登录，provider / model 切换配置见 github-issue-runner spec。

## 会话上下文纪律（AI 执行时）
长会话的主要开销来自工具输出灌大上下文（实测一次 33 分钟会话中工具输出占上下文 73%，其中截图、构建日志、批量读文件、全量 diff 是四个大头）。在本仓库执行任务时遵守：
- 验证 UI 优先用文本断言（DOM 文本、退出码、evidence JSON）；只有断言无法覆盖的视觉问题才截图，且截图落盘留证即可，NEVER 用 `view_image` 把图片回读进上下文（单张即 1.7 万~2.7 万 token）。
- 长命令（`pnpm test` / `typecheck` / `build` / `check`、vitest、验收脚本）把输出重定向到文件（如 `> /tmp/build.log 2>&1`），结束后只 `tail` / `rg` 关键行；NEVER 用 30 秒轮询逐片读回滚动日志（每片可达 1 万 token 且大量重复）。多条互不依赖的验证命令合成一条一次跑完，不要逐条串行等待。
- 读文件按需分段：先用 `rg -n` 定位再读目标行段；NEVER 用一条命令串联 `sed -n '1,300p'` 全文连读多份文档。
- 大任务（实施 → 反思 → 归档 → 提交）分阶段开新会话，避免前一阶段的截图、日志、diff 被后续每一轮重复计费；单会话上下文逼近窗口上限会触发压缩并显著拖慢每一步。
- 收尾核对 diff 用 `git diff --stat` / `--name-only`；只对确需逐行确认的文件看全量 diff。

## 修改前检查
- 改用户可见行为前，先读 `docs/product/` 对应的页面 / 流程 PRD。**`docs/product/` 是产品意图事实源，领先于实现（可以写还没做的）；`openspec/specs/` 是行为事实源，落后于实现（只记录已实现并验证的）。两者时间性相反，NEVER 互相替代，NEVER 把同一条规则原样抄两份。**
- 按上方「域文档指针」读改动所属域的 spec 与补充文档。
- 读 `docs/architecture/module-map.md` 确认依赖边界；MUST 确认改动 NEVER 引入被禁的依赖方向，若必须破坏，先写一条 ADR 记录再改。
- 动 `packages/console-ui` 前必读 `packages/console-ui/DESIGN.md`。

## 修改后检查
- 跑测试 / lint / 构建，三者全绿（退出码 0）方可提交；任一失败 → 先修复，NEVER 带红提交。
- 更新受影响的 ADR。
- 按 `openspec/changes/AGENTS.md` 的三档分流决定事实源怎么更新：事实没变 → 什么都不写；行为变了、产品意图没变 → **同一个 commit 内联改 `openspec/specs/`**，不建 change；产品意图变了 → 走完整 change 流程。
- **本文件的更新闸门**：AGENTS.md 只在新增命令、新增顶层目录、新增红线或新增域指针时更新；行为细节（状态机、像素规格、流程语义等）一律进域 spec，NEVER 沉淀进本文件。

## 禁止事项
- MUST NOT 把 `artifacts/` 当作事实源或长期交付目录；验收截图、evidence JSON、静态构建等临时证据必须写入系统临时目录并由运行结果报告路径，仓库内 `artifacts/` 不得提交。
- MUST NOT 提交 GitHub token、个人访问令牌、本地绝对路径、执行日志中的敏感内容或 `.env` 文件。
- MUST NOT 提交本机 `config.local.toml`；它用于本地 repository 白名单。
- MUST NOT 把 issue title/body/author 等外部输入直接拼接到 shell 命令中执行；调用外部命令必须 `child_process.spawn(cmd, args[])`，不得使用 `exec` / `execSync` / `shell: true`。
- MUST NOT 把 `agents/` 当作运行时状态目录；它只存放可被 mention 寻址的 Markdown 角色素材。
- MUST NOT 允许 issue body/comment 或 agent Markdown 正文指定任意可执行脚本；只有 frontmatter 中指向 `src/agent-prescripts/` 的受信任 registry 脚本可执行。
- MUST NOT 编造尚未存在的运行命令；新增脚本后同步更新本文件、模块地图和相关 OpenSpec。
- 启动 flag 红线：GitHub-mode 的确切名称是 `--github-mode` 且只接受 exact flag；`pnpm start` 缺省 local。local 与 GitHub 两条运行时数据链路（`local-console.sqlite` / `github-runner.sqlite`）互不可见，同一启动流程不并发启用。
- 发布红线：桌面正式发行只有 macOS Apple Silicon（arm64）DMG 与 ZIP；不得生成 Windows、Linux、macOS x64 或 universal 产物。
