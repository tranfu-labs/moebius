# console-ui delta：remove-new-conversation-readiness-hint

## MODIFIED Requirements

### Requirement: 引导贯穿团队 CLI 兼容提示

Source: docs/product/pages/onboarding.md#第-2-步-选团队
Source: docs/product/pages/onboarding.md#第-4-步-准备就绪

onboarding 团队卡与第 4 步 MUST 根据成员 effective CLI 和当前 readiness 使用同一规则提示不兼容成员数与需要准备的 CLI，MUST NOT 静默替换成员 CLI。全兼容时 MAY 显示准备就绪；部分兼容时 MUST 使用中性状态且 MUST NOT 显示全成功大勾。相关 CLI 修复后，引导内提示 MUST 根据新 readiness 自动消失。

该提示 MUST 止于 onboarding 边界，MUST NOT 作为状态、文案或交互要求传播到新对话页。

#### Scenario: 部分兼容团队只在引导内提示

- **GIVEN** 只有 Codex ready 且所选团队有两名 Kimi 成员
- **WHEN** 用户查看 onboarding 团队卡和第 4 步
- **THEN** 两处一致提示两名成员需要 Kimi 准备
- **AND** 不改变这些成员的 CLI
- **AND** 第 4 步不显示全成功大勾。

#### Scenario: 修复后引导内提示消失

- **GIVEN** onboarding 当前选择的团队显示 Kimi 兼容警告
- **WHEN** Kimi 后台安装并 readiness 复检成功
- **THEN** onboarding 内同一团队的兼容警告自动消失。

## ADDED Requirements

### Requirement: 新对话不展示 CLI 准备概念

Source: docs/product/pages/main-conversation.md#选择工作空间与团队
Source: docs/product/pages/main-conversation.md#指标与验收

新对话页 MUST NOT 读取或展示 onboarding readiness，MUST NOT 显示成员准备人数、Codex/Kimi 准备信息、团队 CLI 兼容性提示或为解决该提示而前往 Agent 团队页的引导。该规则 MUST 对 checking、ready、missing、needs-login、unavailable、IPC 延迟、IPC 失败和迟到响应一致成立。

zh-CN 与 en locale MUST 使用同一信息边界；切换 locale、父级重渲染或导航后返回 MUST NOT 恢复旧提示 DOM 或任一语言的准备文案。

新对话发送使能 MUST 继续只依据项目、团队结构、正文/ready 附件、阻塞附件和提交状态，MUST NOT 引入 readiness 或 capability preflight。

#### Scenario: 任意 readiness 终态都没有准备提示

- **GIVEN** 正常操作台的新对话选择了包含 Codex/Kimi 混合成员的有效团队
- **WHEN** 上游 readiness 分别为 ready、missing、needs-login 或 unavailable
- **THEN** 页面都不显示成员准备人数、CLI 准备信息或兼容性提示
- **AND** readiness 差异不改变发送按钮状态。

#### Scenario: 冷启动未知与迟到响应不复现提示

- **GIVEN** 正常操作台冷启动且 readiness IPC 处于 checking、延迟或失败
- **WHEN** 父级多次重渲染且迟到响应随后完成
- **THEN** 新对话始终没有准备提示
- **AND** 不因该状态创建额外发送禁用原因。

#### Scenario: 中英文均无旧提示

- **GIVEN** 新对话选择了含 Codex/Kimi 混合成员的有效团队
- **WHEN** 页面分别以 zh-CN 与 en 渲染并发生父级重渲染
- **THEN** 两种 locale 都不存在旧兼容性提示 DOM
- **AND** 不存在成员准备人数、CLI setup/准备或前往 Agent 团队页调整的文案。
