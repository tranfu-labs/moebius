# desktop-shell delta：官方通用助手与 sidebar chat renderer 编排

## ADDED Requirements

## Requirement: 既有安装原子登记通用助手
Source: docs/product/pages/agent-teams.md#既有安装首次登记通用助手

桌面壳 MUST 把 `general-assistant` 作为官方来源团队随安装包提供。干净安装或既有安装缺失该官方团队时，系统 MUST 原子登记恰好一支官方团队；失败 MUST 保持缺失状态并可重试，MUST NOT 留下半团队、重复记录或覆盖现有用户团队/文件。

### Scenario: 旧安装首次升级
- GIVEN 数据根已有其他官方团队但没有 `general-assistant`
- WHEN 新版本完成官方团队播种
- THEN 恰好新增一支官方「通用助手」
- AND 其他官方或用户团队不变
- AND 唯一 `assistant` 成员推荐 Codex、gpt-5.6-sol、high。

### Scenario: 稳定身份与目录冲突
- GIVEN 非官方记录占用稳定身份或预定目录存在不可识别内容
- WHEN 用户选择产品内保留并添加动作
- THEN 现有团队和文件保持
- AND 官方团队在新的受管记录/位置原子登记
- AND 失败时回到原冲突状态且可重试。

## Requirement: sidebar chat 初始团队不改写普通偏好
Source: docs/product/pages/agent-teams.md#新建对话中的团队预选

renderer MUST 在手动 sidebar chat 与「分析当前对话」草稿中初始选择当前可用的官方 `general-assistant`，并允许发送前改选。首次发送成功前 MUST NOT 更新 last-used team；团队不可用时 MUST 保留草稿并等待修复或用户改选，MUST NOT 静默替换团队或运行配置。

### Scenario: 改选团队后首次发送
- GIVEN sidebar chat 初始选择官方通用助手
- WHEN 用户改选团队 T 且首次创建成功
- THEN session 使用 T 的快照
- AND last-used team 记录为 T
- AND 通用助手不成为应用级默认团队。

## Requirement: renderer 持久化完整 sidebar presentation route
Source: docs/product/pages/main-left-sidebar.md#选择对话

renderer MUST 以版本化文档保存 selected、main、right 与 host 会话关系、每个 host 的右侧标签现场和未发送 sidebar 草稿。重启恢复、归档、项目移除和来源失效 MUST 提交完整组合或保持最后成功组合，MUST NOT 持久化半套选择。

### Scenario: 重启恢复组合
- GIVEN 最后成功状态选中 sidebar chat B、主内容为来源 A、右侧聚焦 B
- WHEN desktop renderer 重启且 A/B 均可用
- THEN 左侧只高亮 B
- AND 主内容恢复 A
- AND 右侧恢复 B 及其标签阅读现场。

### Scenario: 创建失败保留草稿
- GIVEN sidebar 草稿包含上下文、正文、文本片段和普通附件
- WHEN 会话创建或首条消息原子提交失败
- THEN版本化草稿完整保留
- AND renderer 不写入 session locator 或 last-used team。
