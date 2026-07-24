# desktop-shell delta：fix-onboarding-ai-builder-feedback-layout

## Requirement: AI 建队提交后即时显示用户消息
Source: docs/product/pages/onboarding.md#第-2-步-ai-建队

用户提交 AI 建队目标、追问回答或自然语言调整后，renderer MUST 在等待 Codex 结果期间立即把正文显示为右侧用户消息气泡，并在其后显示 AI 正在输入状态。服务端公开消息包含本轮用户消息后，renderer MUST 把临时气泡无重复地收敛为正式消息；系统 MUST NOT 等到完整 turn 返回才第一次显示用户正文。

### Scenario: Codex 回复尚未返回
- GIVEN AI 建队输入框可提交且服务端 callback 仍在等待 Codex
- WHEN 用户发送一条非空消息
- THEN 输入框清空并锁定
- AND 同一条正文立即显示为右侧用户消息气泡
- AND AI 正在输入状态显示在该气泡之后

### Scenario: 服务端状态接管临时气泡
- GIVEN renderer 已显示一条临时用户气泡
- WHEN 父级状态新增本轮正式用户消息和 assistant 结果
- THEN 对话中本轮用户正文只出现一次
- AND 后续历史只使用服务端公开消息。

## Requirement: AI 团队设计器使用响应式工作区并完整展示提案
Source: docs/product/pages/onboarding.md#第-2-步--ai-建队子流程

普通 onboarding 步骤主体 MUST 继续受约 512px 窄栏约束；第 2 步 AI 团队设计器打开时，主体 MUST 随窗口响应式放宽到最大约 780px、增高到最大约 720px，并在关闭后恢复普通窄栏。有效团队提案 MUST 按内容完整展示 2–6 名成员、各自 `@slug`、主 Agent 与接力关系；提案卡 MUST NOT 因纵向 flex 收缩而裁掉成员，超高内容 MUST 只由设计器对话区滚动。

### Scenario: 大窗口显示四名成员
- GIVEN desktop viewport 有足够宽高且 AI 方案包含四名成员
- WHEN renderer 显示 AI 团队设计器和当前提案
- THEN 设计器宽于普通 512px 主体且不超过约 780px
- AND 设计器高度随可用空间增长且不超过约 720px
- AND 四名成员、四个 slug、主 Agent 与接力关系都位于提案卡可滚动内容范围内。

### Scenario: 窄窗口降级
- GIVEN viewport 小于设计器最大宽度或高度
- WHEN AI 团队设计器打开
- THEN 设计器缩小到可用宽度且不产生页面级横向滚动
- AND 对话区仍可滚动到全部提案内容和输入框。
