# console-ui 规格增量：BYOK / Pi 页面投影

## ADDED Requirements

## Requirement: Onboarding 统一展示 CLI 与 API 执行环境

Source: `docs/product/pages/onboarding.md#第-1-步--环境就绪至少一个执行引擎已就绪`

Onboarding MUST 在同一环境步骤展示 CLI 与 AI Provider，允许选择 DeepSeek、输入 Key、选择受维护模型并执行真实验证。验证与本地保存 MUST 是可区分状态；保存失败、取消、离开、关闭重开和迟到结果 MUST 有唯一可见恢复结果。有效 API Provider 单独满足继续条件。

### Scenario: 验证成功但保存失败

- **GIVEN** DeepSeek 回复和受控工具调用均已通过
- **WHEN** 本地保存档案失败
- **THEN** 页面显示验证已完成但尚未保存，并提供无需额外 API 用量的保存重试
- **AND** Provider 列表与可选执行环境不出现半档案。

## Requirement: Settings 提供 AI 服务商完整管理

Source: `docs/product/pages/settings.md#ai-服务商`

Settings MUST 提供 AI 服务商分类、列表、空态、新增、Key 轮换、模型管理、默认模型、重新验证/启用、停用、引用迁移、结束继续能力和删除保护。服务商下架 MUST 引导新建档案并迁移或结束历史继续能力，不进入不可修复的原档案表单。危险操作 MUST 显示逐项引用和跨重启结果。

### Scenario: 默认模型下架但仍有可用模型

- **GIVEN** 档案仍有其他已验证模型但默认模型已下架
- **WHEN** 用户或团队配置打开该档案
- **THEN** 档案保持可识别状态，模型字段为空并要求显式选择
- **AND** 页面不静默代选模型。

### Scenario: 重新启用失败分类

- **GIVEN** 用户对停用档案执行真实重新验证
- **WHEN** 发生网络/限流暂时失败或 Key/模型配置失败
- **THEN** 暂时失败保持“已停用”并可稍后重试，配置失败转为“需要处理”并显示匹配修复入口
- **AND** 修复、验证和保存完成后直接进入“已就绪”。

## Requirement: Agent 团队支持 Pi 成员配置与引用结果

Source: `docs/product/pages/agent-teams.md#agent-运行配置`

Agent 编辑器 MUST 将 Pi API 作为第四执行引擎，并为其显示 Provider 档案、模型和思考程度。页面 MUST 区分 ready、needs-attention、disabled、服务商/模型下架和历史档案缺失；不可用配置不得保存或用于新运行。团队生命周期与设置页逐名引用结果 MUST 同成同败地可见。

### Scenario: Provider 默认模型不可用

- **GIVEN** 用户选择一个已就绪但没有有效默认模型的档案
- **WHEN** Pi 配置表单更新
- **THEN** Provider 保持选中、模型字段为空且保存禁用
- **AND** 用户明确选择已验证模型后才可保存。

## Requirement: 主对话提供 Pi 的唯一可执行恢复动作

Source: `docs/product/pages/main-conversation.md#pi-配置异常与会话迁移`

主对话 MUST 根据 Pi 档案和 generation 的真实状态提供修复、一次性换配置重跑、永久迁移、重新建立执行或结束继续能力；每一状态只能展示可执行动作。历史档案缺失时不得显示原配置重建。结束继续能力后的待发射内容 MUST 显示为不阻塞团队切换的未发送卡片，并保留编辑重提/移除入口。

### Scenario: Provider 档案缺失

- **GIVEN** 时间线历史仍含 Provider 显示标识但档案已无法解析
- **WHEN** 用户打开异常卡片
- **THEN** 页面只显示迁移到已就绪档案或结束继续能力
- **AND** 历史消息和原冻结标识仍可阅读。

## Requirement: 单 Agent 页面展示安全的 Pi 完整过程

Source: `docs/product/pages/agent-conversation.md#完整输出`

单 Agent 页面 MUST 展示 Pi 的安全流式活动、工具、Plan、子任务、附件、耗时、尝试、上下文压缩和恢复结果。完整输出只能是更详细的安全投影；MUST NOT 展示 Key、Authorization、原始 Provider error body、请求响应载荷、stderr、内部协议对象或绝对路径。上下文压缩 MUST 与主时间线共用唯一“已整理较早上下文”事实。

### Scenario: 打开失败 attempt 的完整输出

- **GIVEN** Provider 返回含内部载荷的 auth 失败
- **WHEN** 用户打开完整输出并复制可见内容
- **THEN** 内容只含安全分类、已发生的安全活动与恢复入口
- **AND** 不含原始错误正文、请求头、Key 或内部 frame。

## Requirement: BYOK 异步 UI 不依赖引用稳定

Source: `docs/product/pages/settings.md#操作与反馈`

所有 Provider 验证、保存、轮换、迁移、批量替换和删除 UI MUST 以稳定 operation ID 与 revision 关联结果，MUST NOT 依赖父组件不重渲染或 callback identity 稳定。关闭、切页、慢成功、慢失败、重复点击和迟到返回均不得提交过期草稿或覆盖较新状态。

### Scenario: 父级重渲染后旧验证迟到

- **GIVEN** 用户启动档案 A 的验证后关闭表单，并重新打开编辑为档案 B
- **WHEN** 父级多次重渲染且 A 的旧回调最后返回成功
- **THEN** B 的草稿、按钮和档案列表不被 A 覆盖
- **AND** A 的 operation 只按其持久真实状态恢复或结束。

## Requirement: BYOK 页面遵守桌面与窄窗口设计系统

Source: `docs/product/pages/settings.md#响应式与窗口行为`

五个页面 MUST 使用 console-ui semantic tokens、既有 primitives、焦点与状态语义，MUST NOT 导入 prototype、裸 hex、渐变或阴影。常规桌面宽度与窄窗口 MUST 保持主动作可见、无横向滚动、弹层可滚动、键盘可达，并支持暗色与 reduced-motion。

### Scenario: 窄窗口管理 Provider

- **GIVEN** 真实 Electron 窗口缩窄到页面 PRD 的关键宽度
- **WHEN** 用户新增、查看引用并打开迁移确认
- **THEN** 内容单列或全宽呈现，主操作和关闭入口均可见且可键盘操作
- **AND** 不遮挡状态、产生横向滚动或丢失草稿。
