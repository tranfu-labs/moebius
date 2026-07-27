# 提案：open-markdown-file-references

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | 时间线、指标与验收 | 把显式 Markdown 本地文件链接改为受控应用内引用，并把已知成员 mention 显示为可读名称、连接既有团队详情；裸路径与未知 mention 保持原边界 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | 页面结构、区域与信息、页面状态、指标与验收 | 新增文件引用标签、目标行定位与受信任位置失败边界 | 已写入 |

## 背景

Codex 的原始回复会用普通 Markdown 生成 `[标签](/absolute/path:line)`。Moebius 当前先把该目标当机器路径隐藏，再把剩余本地目标按不允许的 URL 降级为文本，导致用户看不到链接，也无法在产品内核对引用证据。

## 提案

保留显式 Markdown 文件目标并渲染为应用内按钮；点击后打开或聚焦右侧栏文件引用标签，按目标行和可选列读取只读文本窗口并定位。对正文文本节点中的已知团队成员 mention，用会话冻结名单替换为可读显示名，点击只进入现有 Agent 团队详情。外链、图片、裸绝对路径、未知 mention、代码区域与 `file:` URL 继续沿用既有边界。服务端只允许当前会话工作空间和 Codex sessions 根内的规范普通文本文件，使用真实路径校验阻止穿越与符号链接逃逸。

## 影响

- `console-ui`：Markdown 文件引用解析、团队 mention 投影、机器文本脱敏、右侧栏标签模型与文件引用详情。
- `desktop-shell`：文件引用读取 API 的 renderer 适配。
- `local-console`：受控文件引用 HTTP 端点、可信根校验和按行窗口读取。
- 产品事实源、console-ui/local-console 行为规格与模块地图。
