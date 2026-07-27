# 设计：open-markdown-file-references

## 方案

1. 在 `console-ui` 建立纯 `file-reference` seam，解析绝对 POSIX Markdown 目标末尾的可选 `:line[:column]`；remark 变换把内部文件与成员意图登记到当前 renderer 实例的私有 registry，React 节点只用不可预测的一次性 key 查表，不解析公开保留 URL 作为身份凭证。
2. `sanitizeMachineText` 通过 Markdown AST 只改写普通文本节点，天然保留 inline link、带标题 link 与 reference-style link 的目标；其余正文中的机器字段、裸路径与内部标识继续脱敏。
3. `MarkdownMessage` 区分外链与文件引用：外链保持确认流程；文件引用只调用应用内回调，不生成可导航锚点。用户写出的任何 HTTPS URL，包括内部保留域外观，都只能走外链流程。
4. `MarkdownMessage` 用 remark 文本节点变换识别已知成员 mention，跳过 code、inlineCode 与现有 link 节点；显示名来自会话冻结成员名单，点击只回调成员 slug。mention 边界复用运行时 ASCII slug 语义及同一组测试向量。
5. `OperatorConsole` 先解析文件引用取得 canonical path，再以 `session + canonical path + line + column` 打开或聚焦 `file-reference` 右侧标签；已知成员点击则切换到既有 Agent 团队详情入口。文件详情组件显示完整路径、实际行号并滚动突出目标行。
6. desktop renderer 调用 session-scoped `file-reference` 端点。local runtime 以当前 session workspace 和 Codex sessions root 为允许根，先 `realpath` 根与目标再校验包含关系。
7. 文件读取器流式扫描到目标附近，只返回固定上下文窗口；对单行和响应总 UTF-8 字节分别设置硬上限，不复用 2 MiB 整文件读取器。

## 权衡

- 首版只识别 Codex 已实际生成的绝对路径 Markdown 目标，不把任意相对链接或 `file:` URL 提升为文件能力。
- mention 只基于会话冻结成员名单投影，不从全局当前团队猜测，也不改变底层消息原文。
- 文件引用使用独立标签，而不复用项目文件标签；后者依赖 workspace 相对路径、完整树和整文件上限，无法正确承载 workspace 外的 Codex rollout 与大文件目标行。
- source key 持久化路径以恢复标签，但它只留在本机按会话隔离的右侧栏偏好中，不进入主时间线或远端外发。
- canonical path 一旦由可信根内 `realpath` 得到，成功与后续结构化不可用响应都携带该路径；多个异步引用完成时通过函数式最新标签状态逐个合并，不能用点击时快照覆盖。

## 风险

- Markdown 解析边界可能误把普通根路径链接识别为文件引用；通过只接受绝对路径且要求应用内回调、服务端复验可信根降低风险。
- 大文件晚段目标仍需从文件开头扫描；读取设置有界扫描预算，超出时明确不可用，后续可独立引入行索引。
- 超长单行无法安全展示时整次引用明确不可用，不返回截断后可能误导用户核对的证据。
- 工作空间或 Codex sessions 中的符号链接可能逃逸；目标真实路径必须仍在某个真实根内。
