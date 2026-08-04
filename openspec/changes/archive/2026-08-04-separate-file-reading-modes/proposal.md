# 提案：separate-file-reading-modes

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#时间线`、`#指标与验收` | 正文文件路径按所属会话工作空间分流；工作区文件完整打开，显式行号进入源码，外部文件只做有界预览 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#工作区文件与工作区外预览` | 新增完整源码、Markdown Preview、显式行号定位与 canonical 路径边界 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#改动标签`、`#项目文件标签` | 将 Review / Diff 与普通源码阅读拆成两种明确语义 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#选择文件`、`#页面状态`、`#指标与验收` | 补齐加载竞态、刷新一致性、失败路径与真实可核查结果 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#非目标` | 明确 Markdown Preview 不是通用预览，并排除编辑、监听、相对资源和外部完整读取 | 已写入 |

## 背景

当前实现把两个不同意图压进了同一套呈现：正文路径进入 `/file-reference` 后只读取目标行附近窗口，未显式写行号的路径又被解析为第 1 行；单行 JSON、压缩 HTML 等文件因此看起来真的只有一行。与此同时，「项目文件」与「改动」都使用 `FileDiffView`，项目文件即使展示当前完整内容，也带着旧 / 新行号和增删样式，用户无法判断自己是在普通阅读还是审查改动。

用户已经裁决：工作区文件路径代表打开完整文件；项目文件使用普通源码视图；只有改动使用 Review / Diff；完整 Markdown 裸路径默认 Preview，显式行号则进入源码并定位；工作区外文件继续只做明确标识的有界预览。

## 提案

- 保留 Markdown 正文路径识别的安全边界，同时保留“是否显式给出行号”，不再把无行号与 `:1` 合并为同一个打开意图。
- 服务端以所属会话的实际工作空间和 canonical 真实路径判断目标在工作区内还是外部；工作区内返回完整当前文本，外部只返回目标附近有界窗口。
- 将项目文件当前源码读取与会话累计 diff 拆为独立查询契约和独立 UI：项目文件及工作区正文路径进入普通源码阅读；改动标签继续使用 Review / Diff。
- 为完整 `.md` / `.markdown` 文件提供「Preview / 源码」切换。无显式行号默认 Preview，显式行号默认源码；用户选择按当前标签保存，源码定位在模式往返后仍恢复。
- Preview 复用现有安全 Markdown renderer 和外链确认规则；绝对本地文件链接继续走同一工作区内外解析，危险协议继续阻止。
- 沿用大文件、不可显示文本、目录、缺失、不可读与外部窗口预算的既有失败边界；文件变化通过同一已加载文本与显式重读保持可理解，异步竞态不允许旧目标覆盖新目标。

## 影响

- 业务域：`console-ui`、`local-console`、`desktop-shell` 的 renderer 接线。
- 主要代码：正文文件引用解析、右侧栏标签状态、桌面 API client、workspace query runtime、项目文件 / 改动 / 文件引用组件和 Storybook。
- 数据契约：项目当前源码、工作区 diff、文件引用解析不再共用含混响应；已有 `file-reference` 标签类型保留兼容，但读取结果增加作用域与内容模式。
- 安全边界：仍为用户主动触发的本机只读读取；不新增写文件、shell、任意协议导航或任意外部完整读取。
- 架构边界：`packages/console-ui` 只消费数据和发出回调，不直接读取文件系统；canonical 解析、工作空间判定和读取预算仍归 `src/local-console`。不引入新的禁向依赖，无需 ADR。
