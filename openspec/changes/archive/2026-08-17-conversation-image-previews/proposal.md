# 提案：conversation-image-previews

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#带附件的输入框与时间线` | 用户附件新增 SVG 安全预览与普通文件降级 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#会话图片预览与大图查看` | 新增用户与 Agent 本地图片的内联预览、大图查看、状态文案和安全边界 | 已写入 |

需求来自 2026-08-17 的产品采访与逐步评审：图片来源同时覆盖用户附件和 Agent 生成或引用的本地图片；只覆盖 SVG、PNG、JPEG、GIF、WebP，不扩展到 PDF、视频或其他文件内容预览。随后用户确认正常图片卡不显示文件名、格式和来源，并要求同一对话内切换图片、放大、缩小、拖拽及按会话生命周期清理预览缓存。

## 背景

当前用户上传的 PNG、JPEG、GIF、WebP 已有结构化缩略图，但 SVG 只能作为普通文件；Agent 回复中的本地图片路径只能作为文件引用打开，无法在时间线直接判断内容。用户需要在会话里先看懂图片，再在必要时放大检查细节，同时不能因此放宽本地文件读取、Markdown 或 Electron renderer 的安全边界。

## 提案

- 让用户附件的 SVG 经过受限图片上下文解码并生成派生 PNG 预览；无法安全预览时按普通文件保持可发送。
- 让 Agent 最终回复中的本地 PNG、JPEG、GIF、WebP、SVG 文件引用按出现顺序生成内联预览，不改变原文件引用入口。
- 为用户附件和 Agent 图片复用同一时间线图片组件与 Lightbox；正常态只展示图片，异常态保留必要的状态与恢复动作。
- Lightbox 在现有 Dialog 的焦点和遮罩基座上支持同一对话的图片切换、放大、缩小和拖拽；不增加旋转、编辑或下载。
- 预览派生物按会话、消息和图片引用生命周期简单缓存；切换对话、移除消息或卸载后释放不再使用的 object URL。

## 影响

- `src/local-console/`：托管附件 SVG 识别与降级、受控本地图片读取、预览字节与路径护栏。
- `desktop/src/console-page/`：浏览器图片解码、派生预览上传、Agent 图片加载与 object URL 生命周期。
- `packages/console-ui/`：结构化图片预览、大图查看层、文件来源与异常状态、键盘和辅助技术行为。
- `openspec/specs/local-console/spec.md`、`console-ui/spec.md`、`desktop-shell/spec.md`：实现完成后按本 change 的 spec delta 回流。
- 不改变 provider 会话、消息正文、非图片文件阅读或远程 Markdown 图片行为。
