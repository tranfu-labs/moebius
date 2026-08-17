# desktop-shell 规格增量：conversation-image-previews

## MODIFIED Requirements

### Requirement: desktop renderer 通过窄能力接入本地附件
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

desktop main MUST 为每次应用启动生成仅用于 local-console 图片与附件端点的随机 capability，并把同一 capability 注入 main process 拥有的 local console server 和窄 renderer 配置。renderer MUST 用 Chromium 图片上下文为 PNG、JPEG、GIF、WebP 与 SVG 生成有界 PNG 预览，再通过 loopback local-console 附件 API 流式上传原件、finalize 两档派生预览、显式降级无法安全预览的 SVG、恢复元数据、读取派生预览和移除未发送附件。

renderer MUST NOT 通过附件端点读取完整托管原件，也 MUST NOT 获得通用文件读取、任意路径读取、任意 HTTP header、Node integration、SQLite 或托管附件目录能力。capability MUST NOT 写入日志、持久化草稿、消息 DTO 或可见 DOM URL。

#### Scenario: 安全 SVG 只以图片上下文解码
- GIVEN renderer 收到用户选择的 SVG
- WHEN 它准备附件草稿
- THEN SVG 只通过 Blob URL 的图片上下文解码并绘制为两档 PNG
- AND 不插入 DOM SVG、iframe、object、embed 或 innerHTML
- AND 解码后释放源 object URL。

#### Scenario: SVG 解码失败后保持可发送文件
- GIVEN local-console 已识别上传内容为 SVG，但 renderer 无法生成安全预览
- WHEN renderer 请求 SVG file fallback
- THEN 草稿恢复为 ready 普通文件卡片
- AND renderer 不伪造图片预览或改变正文和其他附件。

#### Scenario: 外部来源缺少 capability
- GIVEN 另一个本地网页知道 local console 端口但没有当前启动 capability
- WHEN 它尝试写入附件、读取派生图或读取 Agent 本地图片源
- THEN local console server 在文件 IO 前拒绝请求。

## ADDED Requirements

### Requirement: desktop 编排 Agent 图片预览并释放本地资源
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

desktop renderer MUST 对 Agent 最终消息中的有序本地图片候选调用带 capability 的会话级预览端点，并把返回 Blob 送入与附件相同的 Chromium 派生函数。源 Blob URL MUST 在派生完成或失败后立即释放；缩略图和大图 object URL MUST 按 session/message/reference 身份隔离，并在替换、重试、会话切换或卸载时释放。

请求 MUST 有界并发并可取消；旧 session、旧消息或旧重试 generation 的迟到响应 MUST 被忽略并释放。renderer MUST NOT 把本地路径写进 `<img src>`、CSS URL、Markdown 图片或系统浏览器。

#### Scenario: Agent 图片成功派生两档预览
- GIVEN 当前 Agent 消息含一个服务端确认的本地 PNG 引用
- WHEN renderer 读取源 Blob 并完成 Chromium 解码
- THEN console-ui 收到同一图片的缩略图与大图 object URL
- AND 本地路径没有进入 DOM 资源 URL。

#### Scenario: 会话切换取消图片请求
- GIVEN session A 有多张 Agent 图片仍在加载
- WHEN renderer 切换到 session B
- THEN A 的请求被取消或其结果被判定为 stale
- AND 已创建的 A 图片 object URL 被释放
- AND B 不显示 A 的图片状态。
