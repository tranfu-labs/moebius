# console-ui 规格增量：conversation-image-previews

## MODIFIED Requirements

### Requirement: 图片与普通文件使用结构化附件呈现
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

composer 草稿和已发送用户消息 MUST 在正文之外呈现有序附件：能安全预览的 PNG、JPEG、GIF、WebP 与 SVG 使用缩略图、文件名、格式和来源，普通文件使用文件名、类型、大小卡片。GIF MUST 使用静态预览；无法安全预览的 SVG MUST 作为 ready 普通文件卡片呈现。pending、failed 与 ready MUST 有非纯颜色的可辨认状态；failed MUST 提供重试和移除，pending MUST 允许移除。附件名称过长或窗口缩窄时 MUST 截断或换行而不产生页面级横向滚动。

结构化附件组件 MUST NOT 把本地资源 URL 交给 Markdown renderer。组件卸载、消息切换或预览替换时 MUST 释放 renderer 创建的临时 object URL。

#### Scenario: SVG 与 PDF 使用不同卡片
- GIVEN 一条草稿含一张 ready SVG 和一个 ready PDF
- WHEN composer 渲染
- THEN 安全 SVG 显示静态缩略图，PDF 显示含名称、类型和大小的普通文件卡片
- AND 两项顺序与草稿顺序一致。

#### Scenario: SVG 降级不阻止其他内容发送
- GIVEN 草稿含正文、一个 ready 附件和一个无法安全预览但已降级为普通文件的 SVG
- WHEN composer 计算发送状态
- THEN SVG 卡片说明它会作为普通文件发送
- AND 正文、ready 附件与 SVG 可以共同发送。

#### Scenario: 失败附件不清空其他草稿
- GIVEN 草稿含正文、一个 ready 附件和一个 failed 栅格图片
- WHEN failed 卡片显示错误
- THEN 正文和 ready 附件仍在
- AND 用户可对 failed 项重试或移除
- AND 发送保持禁用直到没有 pending/failed 项。

## ADDED Requirements

### Requirement: Agent 本地图片引用在所属消息内形成有序预览
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

系统 MUST 只从 Agent 最终消息的既有 Markdown 文件引用节点语义取得本地图片候选，并按首次出现顺序在所属消息正文后呈现；代码、转义文本、HTML、远程 URL、未知自定义协议和普通非引用文本 MUST NOT 生成本地图片预览。原文件引用入口 MUST 保留，远程 Markdown 图片 MUST NOT 再生成第二份预览。

用户附件与 Agent 图片 MUST 使用同一图片预览结构，显示文件名、格式和「来自你」或「来自〈成员名〉」；成员 MUST 使用可读名称。多图 MUST 在消息边界内响应式换列，MUST NOT 撑宽主页面。

#### Scenario: Agent 回复中的两张本地图片按出现顺序显示
- GIVEN Agent 最终消息先引用 SVG A，再引用 PNG B，并重复引用 A
- WHEN 时间线渲染消息
- THEN A 与 B 在正文后按首次出现顺序各显示一次
- AND 原文中的三个文件引用仍可分别激活。

#### Scenario: 代码块路径不生成预览
- GIVEN Agent 最终消息在代码块写出 `/tmp/example.png`，正文没有文件引用
- WHEN 时间线渲染消息
- THEN 不生成本地图片预览
- AND 代码块内容保持原样。

### Requirement: 会话图片支持受控大图查看
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

每个 ready 图片预览 MUST 是可点击、可键盘聚焦的按钮，Enter 与 Space MUST 打开同一大图 Dialog。Dialog MUST 显示大图、文件名、格式和来源；图片 MUST 保持比例并限制在查看层内，超出范围时只滚动查看层。首期 MUST NOT 提供缩放、旋转、编辑、下载或多图轮播。

关闭按钮与 Escape MUST 关闭 Dialog，并恢复触发按钮的焦点和会话阅读位置。关闭 MUST NOT 触发 Agent、消息、附件或文件 mutation。GIF 与 SVG 在大图中仍使用静态、安全派生预览。

#### Scenario: 键盘打开并关闭大图
- GIVEN 时间线有一张 ready 图片且触发按钮已聚焦
- WHEN 用户按 Space，再按 Escape
- THEN 大图 Dialog 打开后关闭
- AND 焦点回到原图片按钮
- AND 会话滚动位置与 Agent 运行状态不变。

#### Scenario: 窄窗口大图不撑宽页面
- GIVEN 主窗口缩窄且图片大于可用区域
- WHEN 用户打开大图
- THEN 图片保持比例并只在 Dialog 内容区滚动
- AND 主页面不产生横向滚动。

### Requirement: 图片预览异步状态局部降级且抵抗迟到响应
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

图片加载、失败、文件不存在、安全拒绝与文件变化 MUST 占用当前预览槽，并使用 PRD 指定的可执行文案；失败 MUST 只替换当前图片，不得隐藏正文、其他图片或普通附件。重新加载 MUST 只重新读取当前预览；打开文件 MUST 走既有受控文件入口。

切换 session、消息消失、重试或关闭页面后，旧请求的迟到结果 MUST NOT 写入当前消息或大图；所有被替换或移除的 object URL MUST 释放。

#### Scenario: 切换会话后旧图片迟到
- GIVEN session A 的 Agent 图片仍在加载
- WHEN 用户切到 session B，随后 A 的响应成功
- THEN B 不显示 A 的图片或错误
- AND A 的迟到 Blob URL 被释放。

#### Scenario: 单张失败不影响同消息其他内容
- GIVEN 一条 Agent 消息含正文、ready PNG、缺失 SVG 和普通文件引用
- WHEN SVG 加载返回 not-found
- THEN SVG 槽显示 `找不到「{文件名}」。它可能已被移动或删除。`
- AND 正文、PNG 与普通文件引用保持可见可用。
