# moebius · AI 项目操作手册

本文件只承载四类内容：项目地图、命令入口、红线、域文档指针。**行为细节一律住在域 spec / 域文档里，不复制到这里**（见「修改后检查」的更新闸门）。

## 项目概览
产品品牌统一为 `Moebius`：技术 slug / 协议 namespace 使用 `moebius`，workspace package scope 使用 `@moebius`，环境变量前缀使用 `MOEBIUS`，打包态默认数据根为 `~/.moebius`。这是一条硬切换契约，不读取或接受此前产品标识对应的目录、环境变量或运行协议；当前 worktree 路径与 git remote 属于外部仓库状态，不由应用代码修改。

本项目是一个 Node.js + TypeScript 本地对话操作台，并提供可选 Electron 桌面壳（正式发行只有 macOS Apple Silicon）。`pnpm start` 启动 loopback local console；桌面形态在主进程内拥有同一 local console server，不派生后台 runner 或 observer。GitHub 只用于源码托管、问题反馈与 Release 分发，不是产品运行入口。本地会话以数据根 `sessions/*.jsonl` 为唯一事实源，SQLite 只存可变流转状态与可重建索引。

## 项目结构
```text
.
├── agents/                 # 可被 mention 寻址的 agent 角色素材（dev / qa / ceo / secretary 等），frontmatter 声明机器元数据
├── assets/brand/           # 品牌唯一母版、生成产物与哈希 manifest
├── src/                    # 运行时代码：local-console、会话/mention 纯逻辑、Codex/Claude/Kimi 适配、SQLite worker、目标账本纯模型
├── desktop/                # Electron 桌面壳：主进程、preload、操作台/状态页 renderer、团队与 onboarding、打包配置
├── packages/console-ui/    # shadcn/Radix + Tailwind 的 React 操作台组件库与 Storybook
├── prototypes/             # 与生产代码双向隔离的高保真原型沙盒（规则见 prototypes/AGENTS.md）
├── seeds/teams/            # 打包进桌面应用的只读内置团队种子
├── sites/marketeam/        # 自包含静态官网，英文根页 + `zh/` 中文页（marketing-site 域，同目录 DEPLOY.md）
├── scripts/                # 品牌资产生成、验收脚本
├── tests/                  # Vitest 单元测试
├── docs/
│   ├── product/            # 产品意图事实源：总 PRD + 页面/流程 PRD
│   ├── architecture/       # module-map.md（模块职责与依赖边界）、invariants.md
│   ├── adr/                # 架构决策记录
│   ├── wireframes/         # 历史版式参考；已建页面 PRD 的页面以 docs/product/pages/ 为准
│   └── protocols/          # real-app-acceptance.md：真机验收协议；其余文件仅在对应活跃域指针明确引用时生效
└── openspec/
    ├── specs/              # 当前行为事实规格（落后于实现，只记录已实现并验证的）
    └── changes/            # 先设计再实现的变更工作区（规则见 openspec/changes/AGENTS.md）
```
模块级职责与依赖边界的事实源是 `docs/architecture/module-map.md`，不在本文件展开。

## 常用命令
- 安装：`pnpm install`
- 品牌资产：`pnpm brand:generate` 生成 / `pnpm brand:check` 只读校验（管线与门禁见 `openspec/specs/product-identity/spec.md`）
- 本地模式：`pnpm start`（干净环境可冷启动；只在真正调用 Codex 时需要本机 `codex` CLI）
- 桌面开发态：`pnpm desktop`（数据根、种子拷贝、附件 capability 等行为见 `openspec/specs/desktop-shell/spec.md`；dev 期开放 CDP `9222` 供 AI 调试，见 ADR-0002，首选 `.mcp.json` 的 `electron` MCP server）
- 桌面构建：`pnpm --filter @moebius/desktop build`（构建门禁见 desktop-shell spec）
- 桌面打包：`pnpm --filter @moebius/desktop dist`（只产 macOS arm64 DMG/ZIP；正式发行使用 `v*` tag，红线见 desktop-shell spec）
- Release 更新元数据校验：`pnpm release:validate-update --dir <release-dir> --version <version>`／`--remote v<version>`（只接受最终 arm64 DMG/ZIP、`latest-mac.yml` 与 YML 引用的 ZIP blockmap，并校验版本、文件名、大小、SHA-512）
- Release 更新元数据生成：`pnpm release:prepare-update --input <builder-output> --output <release-dir> --version <version>`（从最终 DMG/ZIP 与 ZIP blockmap 生成干净 staging 和 `latest-mac.yml`，不复制 DMG blockmap 等中间文件）
- Release 白名单上传：`pnpm release:upload-assets --tag v<version> --dir <release-dir> --version <version>`（先本地校验，再按精确路径上传，最后远端复验；修复已有 Draft 时显式加 `--replace`）
- 组件库 Storybook：`pnpm --filter @moebius/console-ui storybook`（设计语言事实源是 `packages/console-ui/DESIGN.md`）
- Storybook 门禁：`pnpm --filter @moebius/console-ui check:storybook`（检查 Component / Block / Page 分类并构建静态 Storybook）
- 原型构建验证：`pnpm --filter @moebius/prototypes check`（沙盒规则见 `prototypes/AGENTS.md` 与 `openspec/specs/design-prototypes/spec.md`）
- import 边界：`pnpm check:boundaries`（AST 扫描与 `module-map.md` 的 `[IB:*]` / `[NI:*]` 登记一致性；同时作为完整与 scope 测试的 preflight）
- 验收脚本：`pnpm exec tsx scripts/acceptance/local-console-t4.ts`、`.../local-console-t45.ts`、`.../local-console-t5.ts --case <deadletter-recovery-suite|child-session-acceptance|primary-agent-closeout>`、`.../local-console-direct-member-mention.ts`、`.../local-runtime-supervision.ts`（验证的行为以 `openspec/specs/local-console/spec.md` 为事实源；运行证据写入脚本打印的系统临时目录）
- Dashboard UI 验收：`pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts`（自动断言）/ `... --hold`（保留真实 Electron 窗口供人工复核）/ `... --case <right-sidebar-responsive|right-sidebar-conversation-visibility|project-conversation-load-more|agent-avatar-team-navigation>`（聚焦验收；临时数据与 evidence 均写系统临时目录）
- 会话图片预览验收：`pnpm exec tsx scripts/acceptance/conversation-image-previews.ts`（真实 Electron 发送 PNG/SVG/损坏 SVG 附件、Lightbox 缩放切图、Agent 本地图片引用与失败降级；临时数据与 evidence 均写系统临时目录）
- 官网双语言验收：`pnpm exec tsx scripts/acceptance/marketing-site-locales.ts`（自起静态服务 + 真实 Chromium，断言语言路由、语言控件无脚本可用、单语言无残留、两页结构平价、320–1440px 无横滚与下载降级；不需要网络，evidence 写系统临时目录）
- BYOK / Pi Electron 验收：`pnpm exec tsx scripts/acceptance/byok-pi-electron.ts`（从真实设置入口验证 DeepSeek 失败恢复、重启一致性、窄窗口与秘密落盘边界；临时数据与 evidence 均写系统临时目录）
- BYOK / Pi API-only 引导验收：`pnpm exec tsx scripts/acceptance/byok-pi-onboarding.ts [--app <独立 Moebius.app>]`（在三套 CLI 均不可用的真实引导页验证 DeepSeek 建档、团队原子替换、完成与重启；传 `--app` 时同时验证签名 arm64 应用、safeStorage 与退出进程树；临时数据与 evidence 均写系统临时目录）
- Pi Agent 能力验收：`pnpm exec tsx scripts/acceptance/pi-agent-capabilities.ts`（从本机 Keychain 的 `moebius-byok-acceptance` 项读取临时 Key，在隔离工作区真实验证 DeepSeek 工具循环、原生 resume 与秘密落盘边界；临时数据与 evidence 均写系统临时目录）
- Desktop CLI PATH 验收：`pnpm exec tsx scripts/acceptance/desktop-cli-path-discovery.ts`（以隔离数据根、受限 GUI PATH、Bourne/csh 登录 shell fixture 和假 npm/Codex 验证首次发现、安装失败重试、安装后复检、继承 PATH 优先级及超时 fallback 进程树清理；evidence 写系统临时目录）
- 文件阅读模式验收：`pnpm exec tsx scripts/acceptance/file-reading-modes.ts`（真实 Electron 中从消息、项目文件与结果卡入口断言完整源码、Review、Markdown Preview、外部预览及既有失败边界；临时数据与 evidence 均写系统临时目录）
- 自动更新/退出保护隔离验收：`pnpm exec tsx scripts/acceptance/desktop-auto-update-shutdown.ts --app <独立临时 Moebius.app>`（只启动独立构建、临时数据根并记录自有 PID；不得传当前 `/Applications/Moebius.app`）
- GitHub 团队真机验收：`pnpm exec tsx scripts/acceptance/github-team-electron.ts`（真实 Electron 中从「找现成团队」入口完成搜索、预览、安装、打开已安装团队、重新检查、同步更新、撤销同步、停止接收更新并重启复查持久化；外部 GitHub 调用由受控 `gh` fixture 提供；evidence 写系统临时目录）
- GitHub 团队真实链路 smoke：`pnpm exec tsx scripts/acceptance/github-team-real-smoke.ts`（真实 gh + 隔离数据根，对 `tranfu-labs/moebius-team-dev-deliver` 跑快照→安装→检查→同步→撤销）
- 会话日志压缩：`pnpm exec tsx scripts/compact-session-facts.ts [路径...]`（默认体检数据根下的 `sessions/`，加 `--write` 才落盘；只在应用未运行时执行）
- Provider 原生过程记录验收：`pnpm exec tsx scripts/acceptance/provider-native-process-traces.ts`（实际调用 Claude/Kimi CLI，断言原生 transcript/wire 在真实 Electron 页面中的展示、resume 同源语义与记录删除后的降级；evidence 写系统临时目录）
- Claude 持久 TUI 真机验收：`MOEBIUS_REAL_CLAUDE_ELECTRON=1 pnpm exec tsx scripts/acceptance/claude-tui-electron.ts`（从真实 Electron 页面配置 Claude、创建隔离项目并显式处理原生工作区信任；断言只读终端、同 PTY 第二轮、idle 后精确 `--resume` 与 transcript cache-read usage；evidence 写系统临时目录）
- 过程步骤详情验收：`pnpm exec tsx scripts/acceptance/process-step-detail.ts`（真实 Claude/Codex/Kimi CLI 各跑 full run，断言思考首句步骤、真实 Claude argv 的 `--thinking-display summarized`、时间线无凭据模式，并用真实历史会话确认旧步骤不回填；evidence 写系统临时目录；Kimi 额度不可用与 codex 单次不思考按重试/如实记录处理）
- Kimi ACP 空响应验收：`pnpm exec tsx scripts/acceptance/kimi-empty-response.ts`（实际调用 Kimi CLI，以真实 Electron 页面断言空 `end_turn` 的安全失败、canonical resume、重启保持与过程记录不可用降级；evidence 写系统临时目录；额度状态不再复现时会明确报告前提不成立）
- 托管进程验收：`pnpm exec tsx scripts/acceptance/managed-process-runtime.ts`（真实 launchd ownership）、`pnpm exec tsx scripts/acceptance/managed-process-bridge-lifecycle.ts`（打包 Electron bridge 的 Node 模式与零 helper 退出）、`pnpm exec tsx scripts/acceptance/managed-process-providers.ts`（三家真实 Provider full/resume）、`pnpm exec tsx scripts/acceptance/managed-process-electron.ts`（真实主页面与运行项 UI）、`pnpm exec tsx scripts/acceptance/managed-process-lifecycle-electron.ts`（Command+Q 与崩溃恢复）、`pnpm exec tsx scripts/acceptance/managed-process-kimi-hang-electron.ts`（Kimi 工具完成后悬挂）、`pnpm exec tsx scripts/acceptance/managed-process-local-cli.ts`（`pnpm start` 关闭不变量）；全部使用隔离数据根，evidence 写系统临时目录。
- 定向测试：`pnpm exec vitest run tests/local-console-codex-resume.test.ts`
- 测试：`pnpm test`（完整闸门）／`pnpm run test --scope [基线]`（只跑受改动影响的测试）；类型检查：`pnpm typecheck`
- lint/格式化：TODO: 尚未配置 ESLint / Prettier；改代码时至少跑测试与类型检查。

### 测试闸门的三种形态
| 命令 | 跑什么 | 跨 worktree 互斥 |
| --- | --- | --- |
| `pnpm test` | 完整闸门（根套件 + 慢测 + desktop + console-ui） | **是** |
| `pnpm run test --scope [基线]` | 只跑受改动影响的测试（不带基线＝未提交改动） | 否 |
| `pnpm test <文件...>` | 直通给 vitest | 否 |

**开发过程中的收口用 `--scope`；完整 `pnpm test` 每个 change 恰好一次，时点在复核（QA／主理人）通过之后、合并动作之前。** 声明实现完成（code-verified）与交付复核都不以完整闸门为前置——复核前跑全量，一旦被打回这次全量就作废。`--scope` 靠 vitest 的 import 依赖图挑文件，是机器算出的依赖闭环——NEVER 自己凭直觉挑测试文件当闸门，那样闸门不可复现。

**完整闸门会跨 worktree 排队**：本仓库全量测试是串行的（`--maxWorkers=1`），且大量断言在等真实 I/O。多个 worktree 同机并发跑全量时，彼此抢 CPU 会让这些断言直接撞 deadline——表现不是「慢一点」而是「随机变红」，红了重跑又加剧竞争。锁（`$TMPDIR/moebius-full-test.lock`）保证同一时刻只有一套全量测试在跑；等不到锁时以退出码 **75** 结束，这表示**没跑测试**，不是测试失败。持有者进程死掉或持有超过 45 分钟会被自动抢占。

调节用的环境变量：`MOEBIUS_FULL_TEST_LOCK=0` 跳过互斥（确认独占机器时）、`MOEBIUS_FULL_TEST_LOCK_WAIT_MS`、`MOEBIUS_FULL_TEST_LOCK_STALE_MS`。

### 测试里的等待
等待一律用 `src/testing/wait.ts` 的 `waitForCondition` / `waitForValue`，NEVER 在测试文件里再手写 `while (Date.now() < deadline) { ... setTimeout(20) }` 轮询——仓库曾因此散落 27 份各自为政的实现，deadline 从 2 秒到 20 秒不等，超时只报 `timed out waiting for condition`，负载一高就随机变红且无从诊断。

两个档位：`logic`（等纯内存时序，默认 5 秒）、`io`（等另一个真实进程的副作用，默认 10 秒）。**deadline MUST 留在用例自己的 vitest `testTimeout` 之内**（全局 20 秒，个别用例声明 15 秒）——一旦超过，vitest 会先判用例超时并报出无信息的 `Test timed out`，helper 备好的诊断信息就永远出不来。`describe` 必填，`snapshot` 用来在超时时带出最后一次实际状态。高负载环境可用 `MOEBIUS_TEST_WAIT_SCALE` 整体放大倍数，但那是应急手段，NEVER 当常态来掩盖真实的时序问题。

### 测试的增与删
全量闸门是串行的（见上），每条测试都会永久占用它——新增测试是对未来所有迭代收税。一条测试的价值判据是「红了意味着行为坏了」，不是数量或覆盖率。

- **测行为，不测措辞**：NEVER 写镜像测试——读取 prompt、文档、配置或页面源文件，断言其中含有某段原文。机械判据：断言失败后唯一的修法是把新文本复制回测试，它就不是测试，是复读机；仓库曾对着 `agents/ceo.md` 的措辞累积 60+ 条这类断言，改一个字就红，红了只能照抄新文本。确需冻结的措辞（品牌名、平台范围声明、对外契约字符串）以点名的极少数断言为限。
- **不堆量**：同一代码分支的参数化重复合并为边界值几条；行为已有测试覆盖的路径不再加存在性或字符串断言凑数。真实 I/O、真实进程、真实等待的重型测试是全量耗时的主体，写之前必须先说明内存替身为何不够。
- **即时剪枝**：改动让旧测试失去测试意义时——被测行为已删除或契约已改、镜像断言、与新测试重复覆盖同一分支——在同一个 change 内删除或合并，与代码同 commit，不需要额外审批；交付说明列出删了什么、判据是什么。NEVER 把旧断言改写成复述新实现的「修绿」——那等于无痕删除；要么它仍在测一个被需要的行为，要么删掉留痕。
- **运行节奏**：迭代与返工收口用 `--scope`，完整 `pnpm test` 每个 change 只在复核通过后、合并前跑一次（见上表）；复核打回后的返工只重跑返工点及关联影响半径。频繁重跑全量买不到额外信心，只烧迭代时间。

### 真机验收（用户动作的最终闸门）
测试矩阵每层各自全绿推不出整体可用——mock 接缝处的缺陷正是它系统性排除的类别。凡新增或变更**带副作用的用户动作**（点击 / 输入 / 菜单 / 快捷键 → 写请求、持久化、进程调用），MUST 在真实运行的应用里从用户入口各做一遍并记录观察；测试计数与构建成功 NEVER 抵扣。定义、豁免边界、记录格式与演练见唯一事实源 `docs/protocols/real-app-acceptance.md`。

## 域文档指针
按改动所属域读对应事实源；一个改动通常只涉及一两个域。

| 域 | 行为事实源 | 补充 |
|---|---|---|
| 目标账本（goal / milestone / task / 验收 fact） | `openspec/specs/goal-ledger/spec.md` | |
| 本地会话运行时（jsonl 事实源 / 主 Agent 控制 / 恢复 resume / 附件 / 运行过程） | `openspec/specs/local-console/spec.md` | |
| 桌面壳（数据根 / 种子 / 团队 / preload 边界 / 打包发布 / 更新） | `openspec/specs/desktop-shell/spec.md` | ADR-0002（CDP 调试通道） |
| 操作台 UI（时间线 / composer / 侧栏 / onboarding / RelayDemo / Markdown 渲染） | `openspec/specs/console-ui/spec.md` | 设计语言 `packages/console-ui/DESIGN.md`；Agent 画像资产的生成与再生成流程见 `.claude/skills/generate-avatar-set/` |
| 设计原型沙盒 | `openspec/specs/design-prototypes/spec.md` | `prototypes/AGENTS.md` |
| 官网 | `openspec/specs/marketing-site/spec.md` | `sites/marketeam/DEPLOY.md` |
| 产品标识与品牌资产 | `openspec/specs/product-identity/spec.md` | |

## 编码规范
- TypeScript `strict`，ESM + `moduleResolution: NodeNext`，相对导入运行时代码使用 `.js` 后缀。
- 运行入口 `tsx src/runner.ts`；自动化测试使用 Vitest。
- 业务纯逻辑与 IO 适配按 view / application / domain / adapter 四层登记；纯 domain 不得引入文件系统、SQLite、provider、Electron、HTTP/IPC 或 shell，边界以 `docs/architecture/module-map.md` 为准。
- 间隔、上限、路径等运行参数集中在 `src/config.ts`；被 `.gitignore` 忽略的 `config.local.toml` 只覆盖本机 provider / model，不保存运行时状态。
- Codex 默认走本机订阅登录；provider / model 切换配置见 local-console 与 desktop-shell spec。

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
- MUST NOT 提交本机 `config.local.toml`；它用于本机 provider / model 覆盖。
- MUST NOT 把用户消息、Agent Markdown、附件文本或其他外部输入直接拼接到 shell 命令中执行；调用外部命令必须 `child_process.spawn(cmd, args[])`，不得使用 `exec` / `execSync` / `shell: true`。
- MUST NOT 把 `agents/` 当作运行时状态目录；它只存放可被 mention 寻址的 Markdown 角色素材。
- MUST NOT 允许用户消息或 Agent Markdown/frontmatter 指定任意可执行脚本；Agent 素材只提供 persona 文本与静态团队元数据。
- MUST NOT 编造尚未存在的运行命令；新增脚本后同步更新本文件、模块地图和相关 OpenSpec。
- 启动红线：`pnpm start` 只启动 local console；`--github-mode` 已退役，必须在 server 启动前以可读错误 fail closed。local CLI 与 Desktop 启动不得读取、迁移、清空或重写既有 GitHub runner state。
- 发布红线：桌面正式发行只有 macOS Apple Silicon（arm64）DMG 与 ZIP；不得生成 Windows、Linux、macOS x64 或 universal 产物。
