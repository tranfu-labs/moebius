# 设计：show-machine-text-and-open-local-files

## 方案

### 1. 删除机器文本替换层

删除 `packages/console-ui/src/console/machine-text.ts` 及其共置测试，并清理以下调用：

- `markdown-message.tsx` / `markdown-internal-reference.ts`：不再向 Markdown 插件传占位符，也不再改写 text、code、HTML、alt 或 title。
- `operator-console.tsx`：
  - `safeRunSummary` 删除 `containsMachineText(text)` 的整条丢弃门控和后续 sanitize；实现收敛为 `nonBlank(summary) ?? t("console.runBlock.progress")`，因此任意非空活动摘要逐字显示，只有缺失或纯空白才使用既有进度兜底。
  - `terminalOutcomeDescription` 保留 `isSafeTerminalFailureCode(message.error)` 资格门；命中安全错误码时返回 `nonBlank(message.body)` 原文，正文空白时返回 `null`，由 `RunOutcome` 使用该状态既有默认说明。未命中安全错误码时仍返回 `null`，不把未分类错误体提升为终态说明。
  - `systemSummary` 返回 `nonBlank(message.body) ?? t("console.operator.systemUpdated")`，不再按机器模式替换。
- `run-block.tsx`：summary、步骤标题和步骤摘要按原文呈现；缺失或纯空白时继续使用既有进度兜底。
- 中英文 locale 删除四个 `console.machineText.*` key。

删除的是渲染期正则替换，不反向要求 runtime 生成更多机器信息。`main-conversation.md#Agent-执行与恢复` 仍要求 Claude runtime 不把原始 stderr、路径和内部异常送入 renderer；renderer 只原样显示 runtime 已分类为安全错误码且已经提供的用户可读 `message.body`，两条边界不冲突。结构化运行活动继续只提供其本来就有的人话 action/object，附件继续只展示结构化元数据，其他受信任错误适配器也仍可生成安全说明；这些都不是“拿到原文后打码”。

### 2. 裸路径复用现有 Markdown 私有 intent

保留 `parseMarkdownFileReference`、`MarkdownFileReference` 与 renderer 实例私有 intent registry。在 `markdown-internal-reference.ts` 增加纯文本节点分词，把以下目标登记为现有 file-reference intent：

- 普通文本中以 `/` 开始、在空白或 Markdown 边界结束的绝对 POSIX 路径；
- 路径末尾可带正整数 `:line[:column]`；
- 整个 inline code 内容恰好是一个合法绝对路径时，把该 inline code 包进内部链接，保留代码视觉；
- 路径末尾紧邻句号、逗号、括号等自然语言标点时，标点留在链接外。

已有显式 inline、带 title 和 reference-style Markdown 文件链接继续走当前解析路径。已有链接、图片、fenced code 与 raw HTML 内不递归制造链接，避免嵌套链接或代码块逐项变成交互控件；其中路径文本仍按原文显示。含空格的路径无法仅凭裸文本可靠确定边界，继续完整显示，并由显式 Markdown 链接形态提供无歧义点击能力。

裸路径与成员 mention 在同一个文本节点变换中按源文本位置一次切分，保证二者不会互相重复处理。所有可点击文件引用仍由 AST 变换时登记的私有 intent 赋予身份；正文伪造的 HTTPS、hash 或保留域外观不能直接触发文件回调。`file:`、`javascript:`、data、自定义协议、外链确认与 HTML sanitize 保持现状。

### 3. 文件读取器取消位置权限，保留内容预算

`readLocalFileReferenceWindow` 删除 `trustedRoots` 输入及真实根收集：

1. 校验绝对 POSIX 路径、正整数 line 与可选 column；
2. 对目标直接 `realpath`，以 canonical path 做后续 `stat`、打开、响应与标签去重；
3. 不再调用 `isPathInside`，符号链接指向任意本机位置时读取其真实目标；
4. 继续要求普通文件，并沿用 NUL/UTF-8、流式扫描、目标行、单行字节、响应字节和扫描字节上限；
5. 无法 `realpath` 时保留输入路径；取得 canonical path 后，所有成功或失败响应继续返回 canonical path。

`runtime.fileReference` 不再读取会话工作空间或解析 Codex sessions root，只把路径与行列交给读取器。HTTP 路由、桌面 loopback capability 和右侧栏的 `sessionId` 标签命名维度不变。

类型层从 `LocalConsoleFileReferenceContent` 与 `FileReferenceContent` 删除 `outside-trusted-roots`；中英文 locale 删除对应错误 key。其他错误码与文案不变。

符号链接不需要新增跟随实现：当前读取器已经先对输入执行 `fs.realpath`，再对 canonical target 做 `stat` 和读取；现状仅在随后用 `isPathInside` 拒绝根外目标。本 change 只删除该拒绝和不再需要的 roots 解析。

Windows `C:\...` 虽然曾被通用脱敏正则命中，但不是现有文件引用协议支持的目标。正式桌面发布仅支持 macOS arm64，因此 parser 与 reader 继续只接受 POSIX 绝对路径，本 change 不新增 Windows 路径语法。

### 4. 测试与真实运行证据

纯逻辑与组件测试：

- Markdown：裸 `/tmp` 路径和 `:line:column` 原文可见且触发文件回调；自然语言尾部标点不进入路径；整段 inline code 路径可点；含路径、`cwd`、`runId`、`direct`、`worktree`、`handoff` 的正文与 code block 不被替换；显式 Markdown 链接、成员 mention、外链确认和危险协议回归不变。
- RunBlock / OperatorConsole：实时 Markdown、历史 Agent 正文、步骤标题、步骤摘要、系统记录和允许展示的终态说明保留原文；`safeRunSummary` 对含路径摘要不再整条丢弃且只对空白值回落；终态说明只在现有安全错误码门内显示非空 `message.body`，空白或未分类错误继续走状态默认说明；文件引用点击继续进入右侧栏。
- 文件读取器：工作空间外普通文件与越界符号链接改为可读且返回 canonical path；二进制、非 UTF-8、目录、缺失、单行过长、响应过大、目标行不存在和扫描上限仍拒绝。
- runtime HTTP：`local-console-workspace-diff.test.ts` 中现有共置用例改为证明系统临时目录文件通过 session-scoped route 可读，无效行列仍返回 400；不改 workspace diff 断言。
- FileReferenceTab：删除 trusted-root 专属状态，保留其余错误原因与异步加载/目标行定位测试。

真实桌面验收扩展 `scripts/acceptance/console-dashboard-ui.ts`（或复用同等生产 Electron 链路的专用 case）：在系统临时目录准备普通 `/tmp` 文件、NUL 文件与超长单行文件，让 fake Agent 最终正文同时包含裸路径、`direct`/`handoff` 句子及测试文件引用；运行期间再产生一条含绝对路径和内部 id 的非空活动摘要。通过生产 renderer 断言活动摘要逐字可见，并点击文件引用断言右侧栏内容或错误文案；空白摘要单独断言仍回落既有进度文案。证据只写脚本报告的系统临时目录，不提交仓库内 `artifacts/`。

### 5. 事实源闭环

实现验证后更新 `docs/architecture/module-map.md` 的两处现状边界：

- Markdown 边界改为“显式链接与裸绝对路径均投影为应用内文件引用，普通文本不再脱敏”；
- 文件引用边界改为“任意本机普通 UTF-8 文件 + canonical path + 有界窗口”，删除可信根与符号链接逃逸限制。

模块仍保持 `console-ui → 宿主回调 → local-console runtime → file-read IO adapter` 的既有方向，没有新增跨层依赖或架构形态，因此不创建 ADR 和 `architecture/` 图。

## 权衡

- 选择删除整层正则，而不是只放开路径：`direct`、`worktree`、`handoff` 与 `github:` 等自由文本误伤来自同一种黑名单模型；保留部分规则会继续制造不可预测句子，也与“按原文显示”的新产品意图冲突。
- 选择 AST 分词而不是在 React DOM 上二次正则：AST 能避开已有链接、图片和 fenced code，并复用当前私有 intent 安全身份，不需要引入浏览器导航或伪协议。
- 选择只自动识别无空白裸路径：自由文本中的空格无法可靠区分“路径的一部分”和“路径后的句子”；显式 Markdown 链接已经覆盖含空格目标，路径文本本身无论如何都不会再被隐藏。
- 选择取消所有位置根，而不是把 `/tmp` 加入白名单：输出位置不止 `/tmp`，增加一个根只会把同一问题推迟到下一个目录，也不符合用户明确要求的“工作空间外也放开”。
- 选择保留内容预算：位置权限与资源消耗/内容类型是两类独立边界。任意位置可读不等于二进制、无限扫描或无限响应可安全呈现。

## 风险

- Agent 受提示注入后可能给出 `~/.ssh` 等敏感文件的绝对路径，用户点击即可在右侧栏看到普通文本内容。该能力仅在本机、用户主动点击、只读且不执行内容，但不再有目录级阻断；这是本轮用户明确接受的产品取舍。
- 裸路径边界识别可能把自然语言标点包含进目标或漏掉特殊文件名。通过纯分词测试覆盖中英文标点、行列后缀、已有链接、inline code 和 mention 组合；不确定的含空格目标保持可见但要求显式链接。
- 取消 trusted roots 后，旧客户端若仍发送 `outside-trusted-roots` 不会再收到该枚举。local server 与 renderer 同版本打包，不存在需要兼容的远程协议；删除两端类型和文案可避免死分支。
- 读取任意文件会扩大本地数据披露面，但不会扩大写入、执行或网络外发能力。HTML sanitize、危险协议阻断、外链确认、普通文件判定和有界读取继续作为独立防线。
- 回滚时可恢复 `machine-text.ts` 与 trusted roots 判定；spec 与 PRD 必须随产品决策一并回滚，不能只恢复代码造成事实源漂移。
