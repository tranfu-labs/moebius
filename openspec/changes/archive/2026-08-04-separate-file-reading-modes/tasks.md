# 任务：separate-file-reading-modes

## 1. 打开意图与纯状态模型

- [x] 扩展 Markdown 本地文件引用意图，保留 `hasExplicitLine`，并保持根路径、inline code、危险协议与外链安全边界。
- [x] 新增不依赖 React 的文件模式决策与 reducer，覆盖 `.md` / `.markdown` 大小写、无行号默认 Preview、显式 `:1` / 其他行默认源码、普通文件、外部预览、用户切换、刷新和过期响应。
- [x] 为上述纯逻辑补集中单元测试；不写读取源码文案的镜像测试。

## 2. local-console 读取契约

- [x] 在 workspace query application 层实现 session workspace + canonical target 的工作区内外分类；覆盖 worktree、路径前缀碰撞、工作区内 symlink 指外、外部别名指内和缺失目标。每次读取按请求重新分类，不增加 symlink 监控或读中换向检测。
- [x] 将项目当前源码查询与累计 diff 内容查询拆开：`/files/content` 只返回完整当前文本，新增明确的 diff 内容端口供 ChangeTab 使用。
- [x] 扩展 session-scoped 文件引用响应为 `workspace-file | external-preview | unavailable` 判别联合；renderer 不得自行猜作用域或完整性。
- [x] 完整工作区读取沿用既有项目文件整文件预算与错误归类；外部窗口沿用既有扫描、单行与响应预算。不得新增预算值或更细错误码，不得把超限工作区文件降级成窗口。
- [x] 保证读取只读，并让完整源码与 Markdown Preview 从同一次成功响应的文本派生；不增加文件版本标识、读中变更检测或新错误码。
- [x] 更新 runtime facade、server route、desktop API client 与四层登记；若新增模块职责或依赖条目，同步更新 `docs/architecture/module-map.md`，不得引入 console-ui → runtime / filesystem 禁向依赖。

## 3. console-ui 模式分离

- [x] 新增 production-exported 普通源码视图，只显示一列当前行号、可选择复制文本和非纯颜色目标定位；不得接收或渲染 diff line kind。
- [x] 让 `ProjectFilesTab` 使用当前源码端口，让 `ChangeTab` 独占 diff 端口与 `FileDiffView`；同一已改动文件从两入口打开时数据和样式不得串用。
- [x] 让工作区内 `FileReferenceTab` 使用完整文件容器，让外部目标使用明确标识的有界预览；保留既有 `file-reference` 标签类型与存量状态恢复。
- [x] 为完整 `.md` / `.markdown` 加入 Preview / 源码切换，裸路径和项目树选择默认 Preview，显式行号默认源码；切回源码恢复目标与阅读位置。
- [x] 用受限 callback profile 复用静态 Markdown renderer：绝对本地链接仍应用内打开，HTTPS 等按现有确认，危险协议 / raw HTML 继续安全处理，文件正文不激活成员 mention 或对话引用。
- [x] 处理模式和读取状态的标签级持久化；新建显式 `:line` 标签 MUST 先初始化为源码，只有用户随后在该标签手动切换才记忆 Preview。旧标签缺字段时安全迁移，不建立全局或跨标签 Markdown 偏好。
- [x] 为新增 production exports 补 Component / Block / Page 层级合适的 Storybook stories，并按实际新增视觉模式更新 `packages/console-ui/DESIGN.md` 的组件 / pattern 说明。

## 4. 异步、恢复与失败测试

- [x] 补 local-console 行为测试：完整单行 JSON、完整多行文件、既有整文件预算边界两侧、外部大型日志窗口、既有结构化错误、canonical / symlink 分流和只读事实。
- [x] 补 renderer 纯组件测试：普通源码无 Review 语义、Change diff 仍有增删语义、Markdown 两种初始模式和往返定位、外部预览标识、既有失败状态与可访问名称；同时回归 ChangeTab 未开始 / 加载 / 无改动 / 非 Git / 失败空态、工作中刷新、pending 提示、选择和滚动保护。
- [x] 异步组件测试 MUST 使用 deferred Promise 等测试内替身覆盖父级重渲染、回调身份变化、A 慢 B 快、旧成功晚到、旧失败晚到、刷新失败后恢复；不能只测引用稳定的 happy path，MUST NOT 为此增加生产测试开关、特殊路由或用户可见调试能力。
- [x] 补 desktop 接线与状态恢复测试：项目源码 / diff / 文件引用命中各自端口，当前 tab 的模式恢复，旧持久化 `file-reference` 标签可读，慢响应不覆盖另一会话或文件。
- [x] 删除或合并因契约拆分失去意义、与新行为重复或只复述新文案的旧测试，并在交付说明列出删除判据。

## 5. 真实应用验收清单

- [x] **5.1 正文工作区完整文件**：在真实 Electron 主会话让 Agent 消息包含一个工作区内多行 `.ts` 裸绝对路径并点击；右侧栏入口为该文件标签，可观察信号是首尾已知行都可到达、只有一列当前行号，且没有“预览 / 仅显示目标位置附近内容”。
- [x] **5.2 正文显式行号定位**：从主会话点击同一 `.ts:42`；可观察信号是源码直接打开、第 42 行滚入视野并有非纯颜色目标标记，路径与文本可复制。
- [x] **5.3 项目文件普通阅读**：从右侧栏加号进入「项目文件」，分别选择未改动和已改动文件；可观察信号是两者都显示完整当前源码和一列当前行号，内容区没有 `+` / `−`、增删背景或旧 / 新双行号。
- [x] **5.4 改动保留 Review 与既有入口**：从一轮结束结果卡片点击「查看」，确认直接打开同一来源改动标签并选择 5.3 的已改动文件；可观察信号是累计 diff 中删除行、增加行、上下文及旧 / 新行号仍可区分。工作期间触发既有刷新时，截至说明、新改动提示、当前选择与滚动位置仍保持原行为。
- [x] **5.5 Markdown 裸路径默认 Preview**：从主会话点击工作区 `README.md` 裸路径；可观察信号是 Preview 处于选中态、标题 / 列表按 Markdown 渲染，切「源码」后显示完整原文。
- [x] **5.6 Markdown 显式行号默认源码**：从子任务或右侧栏会话点击 `README.md:42`；可观察信号是源码模式选中且第 42 行定位。切 Preview 再切源码后，同一目标重新进入视野。
- [x] **5.7 项目树 Markdown**：从「项目文件」选择 `.markdown`；可观察信号是默认 Preview、可切源码，树中即使有改动标识，内容区也不出现 Review 语义。
- [x] **5.8 工作区外有界预览**：从消息点击 `/tmp` 下大文本目标行以及一个工作区内 symlink 指向该文件；可观察信号是两者聚焦 canonical 对应标签，标签和内容区明确显示“预览 / 仅显示目标位置附近内容”，只出现目标附近真实行号且没有 Markdown 切换。
- [x] **5.9 外部别名指回工作区**：点击工作区路径外、canonical 目标位于工作区内的别名；可观察信号是按完整文件打开，不显示外部预览标识。
- [x] **5.10 完整读取失败**：依次从正文或项目树打开超过既有整文件预算的文本、不可显示文本、目录、不存在和不可读目标；可观察信号是沿用对应失败反馈与重试，上一文件内容不残留，工作区大文件不降级为附近预览。
- [x] **5.11 外部预算失败**：打开目标行过长、超扫描预算和超响应预算的外部文件；可观察信号是沿用对应结构化原因，不显示部分目标行或伪完整内容。
- [x] **5.12 文件变化一致性**：保持 Markdown Preview 打开，在磁盘修改文件；可观察信号是页面不会自动替换已经呈现的内容。重新选择、重新打开或使用既有刷新入口后，Preview 与源码都来自同一次新响应。
- [x] **5.14 Markdown 链接安全与已知缺口**：在 Preview 中点击绝对工作区文件链接、绝对外部文件链接、HTTPS、`javascript:`、相对链接和本地图片；可观察信号分别为完整文件、外部预览、外链确认、危险目标无执行、相对链接仅显示不可导航文字、本地图片仅显示替代内容且不发生本地读取。
- [x] **5.15 证据记录**：将每条真实运行结果按 `docs/protocols/real-app-acceptance.md` 记录入口、夹具、观察与 evidence 路径；任何用户可见行为缺证时不得声明 `code-verified`。确定性加载竞态只由 4.3 的测试内 deferred Promise 验证，不列为真机验收，也不增加生产测试开关。

## 6. 收口验证与符合度反思

- [x] 运行受改动影响的可复现闸门 `pnpm run test --scope <实现前基线>`，并保存退出码与关键日志；按仓库节奏不在复核前运行完整 `pnpm test`。
- [x] 运行 `pnpm typecheck`、`pnpm check:boundaries`、`pnpm --filter @moebius/console-ui check:storybook` 和受影响 desktop build；全部退出码必须为 0。
- [x] 对照 proposal、design、两份 spec-delta 和 PRD 验收 #30/#31/#52-#56 逐条反思；列出实现偏差、删除测试、范围外事项与真实应用 evidence，未闭环项不得勾选完成。

## 实现与验证记录

- 实现前基线：`8a70248a`。`pnpm run test --scope 8a70248a` 退出码 0：root 266 passed / 4 skipped，desktop 142 passed，console-ui 440 passed。遵循仓库节奏，未运行完整 `pnpm test`。
- 最终返工影响半径：console-ui 5 files / 34 tests passed；desktop sidebar store 7 tests passed。`pnpm typecheck`、`pnpm check:boundaries`、desktop build、Storybook check 与 `git diff --check` 均退出码 0。
- 真机证据：真实 Electron + production preload/local-console/SQLite/filesystem 已覆盖 5.1–5.12、5.14、5.15；结构化 evidence 仅写入运行时报告的系统临时目录、未提交仓库。工作态刷新使用临时 provider 延迟夹具，没有生产测试开关或用户可见调试能力。
- 符合度反思：proposal、design、两份 spec-delta 与 `main-conversation` #56、`main-right-sidebar` #30/#31/#52–#56 一致。反思中发现并补齐项目文件按路径模式在右侧栏标签卸载后的恢复，以及文件读取刷新/过期响应的纯 reducer；最终无产品或架构偏差。
- 测试删除判据：删除 `decideProjectFileRead` 及 `local-console-workspace-query-plan` 中两个相关断言，因为“项目文件按 changed 猜 current/diff”契约已被明确删除，保留或改写会成为对已移除行为的镜像断言；其余既有测试保留。另将 `local-console-timeline-truth` 的等待条件收紧到 mock 参数已赋值，修复确定性测试时序，不改变生产行为。
- 范围外保持不变：相对 Markdown 链接、本地图片、`.mdx`、编辑/保存、文件监听与版本协议、预算数值、外部完整读取、ChangeTab 外围状态机重构。change 未归档。
- QA 返工闭环：文件打开以用户意图代次保护最终活动标签，并以 canonical source 代次阻止旧成功/旧失败覆盖新快照；宿主会话切换后丢弃旧完成。成功响应现在分别返回 `workspace-file/isComplete:true` 与 `external-preview/isComplete:false`；完成 canonical 分类的外部失败保留 `external-preview`，未知缺失路径仍为 `scope:null`。v1 标签对 `line > 1` 或 column 做显式定位推断，`:1` 无 column 保持裸路径 best-effort。上述均属于批准设计，无方案外重构。
