# 设计：require-file-reference-path-segment

## 方案

### 1. 在共享纯解析器拒绝根路径

`parseMarkdownFileReference` 继续按现有顺序处理输入：去掉 Markdown angle-bracket 包裹、执行 `decodeURI`、拒绝 NUL/换行、拆分可选 `:line[:column]`，再调用 `normalizeAbsolutePosixPath`。规范化完成后增加一个判据：结果为 `/` 时返回 `null`。

这个落点同时约束三条既有入口：

- 普通 text node 的裸路径候选由 `bareFileReferenceNodes` 调用解析器；
- 完整 inline code 由 `transformNode` 调用解析器；
- 显式 Markdown link 与 reference-style link 的 URL 由 `transformNode` 调用解析器。

不在 `isBarePathStart`、inline code 分支和 link 分支分别复制“下一个字符”规则。共享解析器按规范化结果判断可以一并拒绝单独 `/`、带行列后缀的根目标及规范化后仍回到根的目标，并确保未来新增调用方自动继承同一边界。裸路径扫描遇到被拒绝的 `/` 后按现有游标规则继续搜索剩余文本，成员 mention 变换仍处理同一 text node 的普通部分。

### 2. 保留有效路径与后端职责

只要规范化结果至少含一个实际路径段，解析器仍返回现有 `{ path, line, column }`：

- `/tmp` 与 `/Users/...` 继续有效；
- 无扩展名路径与不存在目标继续有效；
- `:line[:column]` 继续要求正整数并从 path 中拆出；
- 尾随自然语言标点、含空格裸路径、angle-bracket 显式目标等现有规则不变。

renderer 不调用文件系统，也不引入目录或存在性判断。`/tmp` 点击后仍沿既有 `onOpenFileReference` → operator console → session-scoped file-reference route 打开右侧栏，由读取器返回 `not-file`；真实普通文本文件继续返回 canonical path 和有界目标窗口。

### 3. 行为测试

在 `markdown-message.test.tsx` 增加一个集中根边界 case，并复用回调观测实际 intent：

- 同一正文放入单独 `/`、`A / B`、inline code `` `/` ``、显式 `[根目标](/)`，断言没有文件引用按钮或回调，inline code 仍为 `code`；
- 用显式 Markdown 目标或完整 inline code 表格覆盖 `/:2`、`/./`、`/tmp/..`，断言这些规范化后仍为 `/` 的输入都不登记文件 intent；加入 `/tmp/../var/log` 正例并断言 callback path 为 `/var/log`，证明判据针对规范化结果而不是原始字符串是否含 `.`、`..` 或行号；这些纯解析等价类不重复进入 Electron 验收；
- 同时放入 `/tmp`、无扩展名与不存在目标、真实路径外观及 `:line:column`，断言这些目标仍可点击且 callback 参数准确；
- 保留并必要时合并既有 HTTPS、`file:`、fenced code、成员 mention 测试，不新增只检查源码或文档措辞的镜像断言。

既有文件面板测试已经覆盖 `not-file`、目标行列与异步加载；本 change 不修改读取器或面板状态，不为同一分支重复增加底层测试。OperatorConsole 既有测试继续证明文件回调能打开右栏；真实 Electron case 负责覆盖 renderer 与宿主接缝。

四个非目标回归只保留内存组件测试，理由分别是：

- HTTPS：`SafeMarkdownLink` 的外链确认 dialog 与 `onOpenExternalLink` 调用可在组件内完整观察，本 change 不改 Electron 外链 handler；
- `file:`：`normalizeMarkdownUrl` 的阻断结果与文件回调零调用可在组件内完整观察，本 change 不改本地资源或 shell 接线；
- fenced code：是否跳过 `code` AST node 并且不生成按钮完全发生在共享 renderer 内，没有需要宿主解释的状态；
- 成员 mention：已知成员的私有 intent 与 `onOpenTeamMember(slug)` 可在组件内完整观察，本 change 不改团队详情打开链路。

因此把它们加入 Electron 脚本只会重复同一分支并增加真实 I/O 税，不能提供本次根路径修复所缺少的接缝证据。

### 4. 真实 Electron 验收

扩展 `scripts/acceptance/console-dashboard-ui.ts` 的现有 fake Codex 成功回复和系统临时文件 fixture：

1. 在同一条生产时间线加入单独 `/`、`A / B`、inline code `` `/` ``、`[根目标](/)`、`/tmp` 与真实临时文本 `:2:3`；`/:2`、`/./`、`/tmp/..` 等规范化等价类只留在组件测试。
2. 用 role/DOM 信号证明三个根目标没有成为文件按钮，inline code 仍是 `code`，普通斜杠文本保持可见。
3. 点击 `/tmp`，断言真实右栏显示 `not-file` 的用户文案且不渲染目标行；这证明 renderer 没有按目录预判并且点击到达文件面板。
4. 点击临时文本 `:2:3`，断言 canonical path、目标位置“第 2 行，第 3 列”、`data-target-line` 与该行内容。

验收继续使用系统临时目录和现有 evidence JSON，不把截图或日志写入仓库 `artifacts/`。截图只作为既有脚本产物落盘，不为本次纯行为断言回读图片。

### 5. 事实源与边界

模块仍是 `console-ui` 内纯 Markdown AST 解析规则，符合 `docs/architecture/module-map.md#console-ui` 的 view/intent 边界；没有新增文件、依赖方向、数据流或架构形态。视觉结构和 token 均不变，`packages/console-ui/DESIGN.md` 无需更新。实现验证后只需把本 change 的 console-ui delta 合并回现行 spec，并核对 PRD 两个锚点。

## 权衡

- 选择在共享解析器按规范化结果拒绝 `/`，而不是只让裸文本扫描要求第二个字符：后者仍会让 inline code 和显式 Markdown 根目标进入文件回调，并复制三份边界。
- 选择纯语法段判定，而不是扩展名或磁盘存在性：目录、无扩展名文件和未来才生成的产物在渲染时不可可靠区分，磁盘状态还会让同一消息的交互随时间变化。
- 选择保留 `/tmp` 可点击并让文件面板报告目录：renderer 只识别引用语法，读取结果继续由有权限、有预算限制的既有后端链路负责。
- 选择扩展现有 Dashboard UI 验收，而不是新建重型 Electron 脚本：现有脚本已经覆盖生产文件引用的 renderer、loopback server 与右侧栏接缝，可以用同一进程和 fixture 增量证明新边界。

## 风险

- 共享判据会让规范化后回到 `/` 的输入不再成为文件引用；这是“必须有实际路径段”的一致结果，通过解析与组件负例锁定。
- 裸路径扫描在拒绝 `/` 后仍会继续扫描同一文本，若游标处理错误可能吞掉后续有效路径或 mention；组合测试覆盖 `A / B` 后仍有 `/tmp` 与 `@成员` 的顺序。
- 扩展 Dashboard fixture 可能因控件同名导致定位歧义；使用唯一可访问名称并把断言限定在当前成功会话时间线和右侧栏区域。
- 回滚只需撤销共享解析判据及对应测试/验收 fixture；若产品决策回滚，PRD 与 spec delta 必须一起恢复，不能只恢复代码。
