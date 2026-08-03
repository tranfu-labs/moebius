# 提案：require-file-reference-path-segment

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#时间线` | 明确文件引用必须在根 `/` 后包含实际路径段，单独 `/` 不是文件引用，三种 Markdown 入口共用边界 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#指标与验收` | 补充根路径负例，并保留 `/tmp`、无扩展名与不存在目标的现有识别规则 | 已写入 |

PRD 变更记录：2026-08-03 用户确认采用“根 `/` 后至少有一个实际路径段”的边界；单独 `/` 与 `A / B` 中的分隔符保持普通文本，不按扩展名或磁盘存在性预判目标。

## 背景

共享 Markdown renderer 当前把普通文本、inline code 与显式 Markdown 目标统一交给 `parseMarkdownFileReference`。该解析器会把单独 `/` 规范化为根路径并返回有效文件引用；裸文本扫描又允许只有一个字符的候选，因此普通句子 `A / B` 中的分隔符也会成为可点击文件控件。现有测试覆盖了有效绝对路径和危险协议，却没有覆盖根路径负例。

这会把排版符号误报成文件操作，并允许点击后才从文件面板得到“不是普通文件”的无意义反馈。与此同时，`/tmp`、无扩展名文件和尚不存在的产物路径仍是有用且无歧义的绝对路径，不能用扩展名或磁盘存在性检查修复误报。

## 提案

1. 收紧共享文件引用解析器：URI 解码、可选 `:line[:column]` 拆分与 POSIX 规范化完成后，若结果没有根 `/` 之后的实际路径段（即规范化结果仍为 `/`），返回“不是文件引用”。
2. 让裸文本、完整 inline code 与显式 Markdown 文件目标继续复用这一个解析判据，不在三个 AST 分支复制规则。
3. 保留 `/tmp`、`/Users/...`、无扩展名路径、不存在目标和可选行列后缀的现有识别；renderer 不读取磁盘、不判断文件类型，点击后的目录、不存在或不可读反馈继续属于文件面板。
4. 用组件行为测试覆盖根路径负例与有效路径回归，并扩展现有真实 Electron Dashboard 验收，从生产时间线证明普通斜杠不可操作、有效路径仍进入右侧栏。

## 影响

受影响模块：

- `docs/product/pages/main-conversation.md`：产品边界已经写入时间线与验收指标。
- `packages/console-ui/src/console/markdown-internal-reference.ts`：收紧共享纯解析边界，不新增依赖或副作用。
- `packages/console-ui/src/console/markdown-message.test.tsx`：覆盖裸文本、inline code、显式目标和回归 intent 的可观察行为。
- `scripts/acceptance/console-dashboard-ui.ts`：扩展既有真实 Electron 文件引用 case 与 evidence。
- `openspec/specs/console-ui/spec.md`：本 change 先在 `spec-delta/` 暂存，代码验证后按项目流程合并。

明确不在范围内：

- 不根据扩展名、文件是否存在、目标是否为目录或可读性决定是否生成引用。
- 不改变文件读取器、右侧栏标签模型、文件错误文案、外链确认或成员 mention 行为。
- 不新增路径语法、Windows drive path、`file:` URL 或自定义协议支持。
- 不改变布局、视觉 token、组件结构或模块依赖，因此不创建 wireframe、architecture、ADR 或 `DESIGN.md` 更新。

## 验收清单与验证方式

1. 真实 Electron 主时间线中的单独 `/` 与 `A / B` 分隔符均为普通文本，不能打开文件标签。
   - 组件测试断言两处文本不存在文件引用按钮且回调调用数为零，并以 `/:2`、`/./`、`/tmp/..` 为代表性组断言规范化后仍为根的目标都不进入回调；同时以 `/tmp/../var/log` 断言规范化后仍有实际段的目标继续有效，证明判据落在规范化结果而非原始字符串。Dashboard UI 验收只对用户实际遇到的单独 `/` 与 `A / B` 做真实成员回复断言，不为等价规范化变体重复增加重型 case。
2. inline code `` `/` `` 保持代码视觉且不可点击。
   - 组件测试断言内容仍由 `code` 元素呈现、没有同名按钮且文件回调不触发；Dashboard UI 验收断言生产时间线中的 `code` 元素可见且不可操作。
3. 显式 Markdown 根目标不能进入文件引用回调。
   - 组件测试渲染 `[根目标](/)` 并断言没有文件按钮、点击能力或文件回调；Dashboard UI 验收断言同一目标未被提升为文件引用控件。
4. `/tmp` 仍呈现文件引用，点击后由文件面板报告目录不可用，而不是 renderer 预判。
   - 组件测试断言 `/tmp` 进入文件回调；Dashboard UI 验收点击真实 `/tmp` 引用，断言右侧栏显示“这个引用没有指向普通文件”且没有目标行内容。
5. 指向真实临时文本文件的绝对路径及 `:line[:column]` 可点击，并在右栏定位目标行。
   - 组件测试断言 callback 收到规范化 path、line、column；Dashboard UI 验收创建系统临时文本，点击 `:2:3` 引用后断言 canonical path、目标位置“第 2 行，第 3 列”与突出行内容。
6. HTTPS、`file:`、fenced code 和成员 mention 行为不回归。
   - 只使用既有组件测试回归：HTTPS 只进入外链确认、`file:` 不进入文件回调、fenced code 不生成引用、已知 mention 只进入成员回调。四者的 AST 分支、协议判定和私有 intent/callback 都能在 `MarkdownMessage` 内直接观察，本 change 不改变对应宿主接线，因此不加入 Dashboard Electron 验收。
