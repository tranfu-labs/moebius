# 提案：show-machine-text-and-open-local-files

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#时间线` | 推翻普通正文隐藏裸路径与机器信息的旧规则，改为原文显示并把裸绝对路径提升为文件引用 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#在右侧栏分析这条消息` | 删除“分析入口是普通时间线脱敏规则例外”的旧表述 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#指标与验收` | 将验收 #13、#56 改为机器文本原样显示、裸路径可点和工作空间外文件可读 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#现状参考与产品缺口` | 删除“系统记录出现机器信息”这一已经被产品方向推翻的缺口 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#文件引用标签` | 将入口扩展到裸绝对路径，并取消工作空间/Codex sessions 可信根限制 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#页面状态`、`#指标与验收` | 删除“不在受信任位置”状态，补充任意本机普通文本与既有读取预算的验收边界 | 已写入 |

PRD 变更记录：2026-07-30 用户明确推翻 2026-07-27 建立的“裸路径隐藏、只读可信根内文件”结论。新依据是用户需要知道改了哪个文件，且 Agent 输出到 `/tmp` 或其他工作空间外位置的文件必须能从对话直接打开。

## 背景

当前 `machine-text.ts` 在渲染层扫描 Agent 正文、运行步骤、实时摘要和系统记录，把绝对路径、机器字段、内部 id 以及裸单词 `direct`、`worktree` 替换为占位文案。这会破坏句意、误伤正常英文，并让同一个路径仅因 Agent 是否写成 Markdown 链接而随机地“可操作”或“被打码”。

文件引用读取器又把目标限制在当前会话工作空间与 Codex sessions 根内。即使 Agent 已经给出有效的 `/tmp` 产物链接，用户点击后仍只会看到 `outside-trusted-roots`，无法在现有右侧栏查看。

## 提案

1. 删除 console-ui 的整层机器文本替换与四个占位文案，用户、Agent、运行步骤、实时摘要和系统记录中的原始路径、机器字段与内部标识按原文呈现。`safeRunSummary` 同时删除 `containsMachineText(text)` 的整条丢弃门控：非空实时摘要逐字显示，只有缺失或纯空白时回落 `console.runBlock.progress`。
2. 在共享 Markdown AST 变换中把普通文本里的裸绝对 POSIX 路径及可选 `:line[:column]` 提升为现有应用内文件引用，继续复用私有 intent registry、右侧栏标签去重和目标行定位链路。
3. 删除文件引用读取器的 trusted roots 参数与位置判定，允许读取本机任意位置的普通文本文件。现有 `realpath` 已经解析符号链接真实目标；移除 `isPathInside` 拒绝后，该目标自然可读，不新增符号链接跟随逻辑。
4. 保留现有只读与内容安全阀：只接受绝对 POSIX 路径和有效行列；目标必须存在、可读且为普通 UTF-8 文本；流式扫描、单行、响应体积和扫描字节上限继续生效；HTML 清洗、危险协议阻断、外链确认与图片协议限制不变。
5. 删除 `outside-trusted-roots` 类型、右侧栏错误文案与对应测试分支，改用仍然成立的不可用原因。

## 影响

受影响模块：

- `docs/product/pages/main-conversation.md`、`main-right-sidebar.md`：产品意图已经更新。
- `packages/console-ui/src/console/`：Markdown 内部引用、运行块、操作台文本投影、文件引用标签类型与测试。
- `packages/console-ui/src/i18n/locales/`：删除机器文本占位符和可信根错误文案。
- `src/local-console/file-read.ts`、`runtime.ts`、`types.ts`：取消位置范围限制，保留有界只读读取。
- `tests/local-console-file-reference.test.ts`、`local-console-workspace-diff.test.ts` 中共置的 session file-reference HTTP 用例，以及 Dashboard UI 验收脚本：改为证明 `/tmp` 可读及内容安全阀仍有效；workspace diff 行为本身不变。
- `docs/architecture/module-map.md`：实现验证后更新 Markdown 与文件引用边界描述；模块依赖方向不变，不需要 ADR 或架构图。
- `openspec/specs/console-ui/spec.md`、`local-console/spec.md`：本 change 先以 `spec-delta/` 暂存，代码验证后按项目归档流程合并。

明确不在范围内：

- 不放开 `file:`、`data:`、`javascript:` 或自定义协议，不允许 Markdown 导航到本地资源。
- 不执行文件内容，不增加编辑、保存、删除、终端或 git 能力。
- 不移除二进制、UTF-8、普通文件、扫描字节、单行和响应体积安全阀。
- 不改变附件托管路径隐藏、结构化运行活动的人话化或完整输出 reasoning 过滤边界。
- 不改变右侧栏布局、标签模型或外链确认流程。
- 不改变改动/项目文件标签用「项目文件夹」「独立工作空间」解释位置的产品文案；该映射不经过机器文本替换层。
- 不增加 Windows drive path 支持；正式桌面平台仍为 macOS arm64，裸路径提升与文件读取沿用既有 POSIX 绝对路径边界。

## 真实运行验收语句

1. 在桌面应用打开本地对话，让成员回复正文包含一个 `/tmp/.../report.txt:2` 裸绝对路径；时间线必须显示完整原文且没有任何“已隐藏”占位符。点击该路径后，右侧栏打开文件引用标签，第 2 行滚入视野并突出。
2. 同一条成员回复包含英文句子 `Send a direct message before handoff.`；时间线必须逐字显示 `direct` 与 `handoff`，不出现“工作空间类型已隐藏”或“内部标识已隐藏”。
3. 在 `/tmp` 创建普通 UTF-8 文本并由成员正文引用；点击后右侧栏必须显示文本内容与 canonical path，即使该文件不在当前工作空间或 Codex sessions 根内。
4. 在 `/tmp` 分别准备含 NUL 的二进制文件和单行超过现有上限的文本文件并由成员正文引用；点击后右侧栏必须分别显示“不是可读取的文本文件”和“目标行过长”的既有原因，不返回文件内容，也不崩溃或离开应用。
5. 在桌面应用保持成员运行，让当前活动摘要包含绝对路径与内部 id；主时间线的活动行必须逐字显示该摘要，而不是回落为「正在推进这一步…」。把摘要改为空白后，活动行才显示该既有兜底。
