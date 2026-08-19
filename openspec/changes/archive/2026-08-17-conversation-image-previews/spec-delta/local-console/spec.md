# local-console 规格增量：conversation-image-previews

## MODIFIED Requirements

### Requirement: 本地附件使用应用托管副本
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

系统 MUST 将本地附件内容写入数据根下的专用托管目录，并在既有 `.state/local-console.sqlite` 中把不可变 blob 元数据与草稿/消息有序 refs 分开持久化。blob MUST 保存服务端判定的种类、显示名、媒体类型、实际字节数、完整性摘要和服务端生成的相对存储键；ref MUST 保存 renderer 可见的不透明 attachment id、blob 关联、draft/message 二选一归属和稳定顺序。系统 MUST NOT 把内部 blob id、原始绝对路径、托管绝对路径或本轮附件副本路径写入附件 DTO、预览响应、消息正文或 renderer 可见 attachment id。

附件原件写入 MUST 流式执行并受有界字节护栏约束；完成内容写入前 MUST NOT 建立可发送的附件元数据。服务端 MUST 只把内容识别为 PNG、JPEG、GIF、WebP，或经有界 UTF-8/XML 判定为 SVG 的附件列为图片预览候选，MUST NOT 只凭客户端 MIME 或扩展名提升图片能力。候选只有在 renderer 提交并由服务端校验时间线缩略图与大图两档派生 PNG 后才可作为 ready 图片呈现；两档派生 MUST 分别遵守集中配置的尺寸与字节上限。

SVG 预览派生失败时，服务端 MUST 允许客户端把同一 staging 项显式降级为 ready 普通文件；该降级 MUST 只适用于服务端已识别的 SVG，MUST NOT 让损坏 PNG、JPEG、GIF、WebP 或其他内容绕过失败。SVG 即使具有图片预览，也 MUST 只作为 manifest 普通文件进入 Agent 输入；provider `imagePaths` MUST 继续只接收当前原生支持的 PNG、JPEG、GIF、WebP。

renderer MUST 只读取应用托管的派生预览，MUST NOT 通过附件端点读取完整托管原件。所有派生键 MUST 由服务端生成，MUST NOT 接受客户端文件路径。

#### Scenario: 原文件删除后托管附件仍可用
- GIVEN 用户已把本地图片加入草稿且托管写入完成
- WHEN 原文件被移动或删除并且应用重启
- THEN 同一 draft key 仍能恢复附件元数据并读取两档派生预览
- AND 系统不重新访问原路径。

#### Scenario: 已发送附件通过新引用复用
- GIVEN 同一 session 的一条历史 user message 已引用两个托管 blobs
- WHEN 系统为“改一改重发”目标 draft 原子克隆其附件引用
- THEN 目标 draft 获得两个新的 attachment ids 并保持原顺序
- AND 原 message refs、blobs 与派生预览保持不变
- AND 系统不复制 blob 字节。

#### Scenario: 安全 SVG 形成图片预览但不进入 provider 图片通道
- GIVEN 用户添加一个服务端识别为 SVG 的附件，renderer 已生成两档合规 PNG
- WHEN 服务端完成预览 finalization 并准备 Agent 输入
- THEN 附件以 `image/svg+xml` 和图片预览呈现
- AND SVG 出现在附件 manifest 的普通文件项中
- AND SVG 路径不进入 provider `imagePaths`。

#### Scenario: SVG 无法安全预览时作为普通文件发送
- GIVEN 服务端已识别一个 SVG staging 项，但 renderer 无法生成安全派生预览
- WHEN renderer 请求 SVG file fallback
- THEN 服务端把同一原件提交为 ready 普通文件
- AND 正文和其他 ready 附件保持可发送
- AND renderer 不能用该 fallback 提交损坏的栅格图片。

#### Scenario: 伪装图片按普通文件处理
- GIVEN 一个扩展名和客户端 MIME 声称为 PNG、但内容不是受支持图片的文件
- WHEN local-console 完成服务端内容识别
- THEN 该附件不会获得图片预览或进入 provider `imagePaths`
- AND 它至多按普通文件附件处理。

#### Scenario: 上传中断不产生 ready 附件
- GIVEN 附件字节流在完成前中断或超过高位护栏
- WHEN 服务端收敛本次写入
- THEN SQLite 中不存在可发送的对应 ready 附件
- AND partial 内容被删除或由启动清理有界回收。

#### Scenario: 超大尺寸或畸形栅格图片上传失败
- GIVEN 一个具有受支持栅格签名、但无法在预览预算内安全解码的附件
- WHEN renderer 无法生成合规派生预览，或 finalization 超过服务端上限
- THEN 系统不建立 ready 附件元数据
- AND 界面保留可重试或移除的失败项
- AND 系统不把它降级为普通文件。

## ADDED Requirements

### Requirement: Agent 本地图片引用使用会话级受控预览端点
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

系统 MUST 为 Agent 最终消息中由现有 Markdown 文件引用语义识别出的本地图片提供会话级预览读取。读取 MUST 要求桌面启动时生成的附件 capability，并复用该 session 的工作空间解析、realpath、普通文件与符号链接边界；请求 MUST 只接受绝对本地文件引用，不接受 `file:` URL、远程 URL、任意存储键或托管 blob id。

服务端 MUST 在读取前后校验同一 realpath、regular file 与稳定文件事实，并以集中配置的源字节上限读取；只有内容识别为 PNG、JPEG、GIF、WebP 或 SVG 时才返回带服务端媒体类型的源 Blob。HTML、伪装扩展名、目录、缺失、读取期间变化、超限和未知二进制 MUST 返回结构化不可用，MUST NOT 返回其他本地内容。响应 MUST NOT 暴露新路径、目录列表或任意文件读取能力。

#### Scenario: 工作空间内 Agent PNG 可预览
- GIVEN Agent 最终消息含一个现有文件引用语义识别出的工作空间内 PNG 路径
- WHEN desktop 以当前 session 与 capability 请求图片源
- THEN 服务端按 magic bytes 返回受限 PNG Blob
- AND 不返回目录内容、相邻文件或额外路径。

#### Scenario: 工作空间外 Agent SVG 仍遵守文件引用边界
- GIVEN Agent 最终消息含一个现有规则允许导航的工作空间外 SVG 路径
- WHEN desktop 请求图片源
- THEN 服务端在 realpath、普通文件、源字节和 SVG 内容判定都满足时返回受限 SVG Blob
- AND 不把工作空间外目录升级为可浏览文件树。

#### Scenario: 扩展名伪装和读取期间替换都不可用
- GIVEN Agent 回复引用 `.png`，但目标是 HTML，或目标在读取期间被替换
- WHEN desktop 请求图片源
- THEN 服务端返回结构化不可用
- AND 响应不包含目标字节、内部异常或替代文件内容。

#### Scenario: 缺失 capability 不读取本地图片
- GIVEN 本地网页知道 local console 端口与 session id 但没有当前附件 capability
- WHEN 它请求 Agent 本地图片预览
- THEN 服务端在 realpath 和文件 IO 前拒绝请求。
