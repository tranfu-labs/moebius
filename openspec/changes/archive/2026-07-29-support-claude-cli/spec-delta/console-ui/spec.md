# console-ui 规格增量

## MODIFIED Requirements

### Requirement: 完整输出能力按执行引擎局部降级

Source: docs/product/pages/agent-conversation.md#完整输出

系统 MUST 只为能提供稳定过程记录的 run 显示可点击完整输出入口。Kimi 与 Claude run
MUST 保留最新活动、计时和最终回复，但统一原位说明当前执行引擎不提供可恢复的完整
过程记录，MUST NOT 打开空标签、借用 Codex 记录或显示另一执行引擎的名称。

#### Scenario: Claude run 工作中

- **GIVEN** 当前活动 run 的执行引擎是 Claude
- **WHEN** 用户查看活动记录
- **THEN** 最新活动与已进行时长正常显示
- **AND** 完整输出位置显示执行引擎中性不可用说明而不是按钮
- **AND** 说明中不出现 Kimi。

### Requirement: 引导第 1 步以三 CLI 独立状态放行

Source: docs/product/pages/onboarding.md#第-1-步-环境就绪至少一个-cli-可用

`OnboardingShell` MUST 同时渲染 Codex、Claude Code 和 Kimi 三行独立状态，并明确三者
至少一个可用即可继续。任一行 ready 时“继续” MUST 可用；三行都不 ready 时 MUST
禁用。全局“重新检查” MUST 在 checking、ready、错误和安装状态下始终可操作，并同时
刷新三行；每行状态 MUST 只由自身最新 revision 更新。

缺失行 MUST 展示该 CLI 随应用发布的安装命令和可访问安装按钮。Claude 按钮名称 MUST
为“安装 Claude Code”。needs-login、unsupported-version 与 unavailable 行 MUST 只
展示对应修复指引，不得展示安装动作；Claude unsupported-version 行 MUST 额外展示
可访问的「更新 Claude Code」按钮，并只能触发调用方提供的受信任 update action。
ready 行 MUST 展示调用方提供的真实版本；静态表面没有真实输入时 MUST 使用无版本
通用文案。

#### Scenario: Claude-only ready 立即放行

- **GIVEN** Claude Code ready 且 Codex/Kimi missing
- **WHEN** 第 1 步渲染
- **THEN** “继续”可用
- **AND** Codex 与 Kimi 行仍展示各自安装动作
- **AND** 页面明确其安装是可选的。

#### Scenario: 三行重新检查

- **GIVEN** 三行已各自有终态
- **WHEN** 用户触发“重新检查”
- **THEN** 三行分别显示当次 checking 反馈
- **AND** 任一迟到的旧 revision 不覆盖新结果。

### Requirement: 引导安装反馈持续且可访问

Source: docs/product/pages/onboarding.md#第-1-步-cli-缺失与安装中

启动安装后，对应按钮 MUST 立即禁止重复触发，行内 MUST 持续显示 starting、
downloading、installing 或 verifying 阶段，并提供确认取消。活动变化、成功、失败、
取消和超时 MUST 通过 `aria-live` 宣告；reduced-motion 下 MUST 保留非动画等价信息。

离开第 1 步后，标题栏 MUST 聚合任意 1–3 项活动任务；没有任务时 MUST 不占据状态位置。
聚合数量 MUST 随任务完成准确下降，每项阶段与取消入口仍可区分。安装成功 MUST 只刷新
对应 CLI；失败、取消和超时 MUST 保留独立重试。

#### Scenario: 三任务聚合

- **GIVEN** Codex、Claude Code 与 Kimi 安装都在运行
- **WHEN** 用户进入第 2 步
- **THEN** 标题栏显示“3 项 CLI 正在安装”的聚合入口
- **AND** 详情能区分三项自身阶段
- **WHEN** Claude 任务结束
- **THEN** 聚合数量按剩余两项更新。

### Requirement: 引导贯穿团队 CLI 兼容提示

Source: docs/product/pages/onboarding.md#第-2-步-选团队

团队卡、第 4 步与新建对话 MUST 根据成员 effective CLI 和 Codex/Claude Code/Kimi
readiness 使用同一规则提示不兼容成员数与所需 CLI，MUST NOT 静默替换成员 CLI。全兼容
时 MAY 显示准备就绪；部分兼容时 MUST 使用中性状态且 MUST NOT 显示全成功大勾。相关
CLI 修复后提示 MUST 根据新 readiness 自动消失。

#### Scenario: Claude 成员部分兼容

- **GIVEN** 只有 Codex ready 且所选团队有两名 Claude 成员
- **WHEN** 用户查看团队卡、第 4 步和新建对话
- **THEN** 三处一致提示两名成员需要 Claude Code 准备
- **AND** 不改变这些成员的 CLI
- **AND** 第 4 步不显示全成功大勾。

### Requirement: Agent execution profile editor has independent draft state

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The selected member MUST expose the saved CLI, model and effort, source and eligible restore/save
actions without runtime capability data. CLI MUST be a Codex/Claude Code/Kimi enum. Model MUST use
the product-bundled registry for that CLI; effort MUST contain only the selected model's supported
efforts. Selecting Claude MUST choose `sonnet/high`. Selecting Claude `fable` MUST offer xhigh,
while selecting `sonnet` or `opus` MUST remove xhigh. Changing model MUST preserve effort only when
still supported and otherwise choose that model's default `high`.

A saved value absent from the registry MUST remain visibly unsupported until the user explicitly
selects a current combination. Profile drafts MUST survive member switches independently of Markdown
drafts. Parent rerenders, new callback identities and slow or failed async returns MUST NOT reset a
draft, reapply stale data or trigger duplicate reads. Save failure MUST retain the draft and identify
the last saved profile as effective.

#### Scenario: Claude draft survives parent rerenders

- **GIVEN** a member has an unsaved Claude/fable/xhigh profile draft
- **WHEN** the parent rerenders with new callback identities and an older read resolves late
- **THEN** the Claude draft remains visible
- **AND** the old response does not reset or persist it
- **AND** no duplicate save occurs.

#### Scenario: Historical Claude profile remains visible

- **GIVEN** a member previously saved a Claude model or effort absent from the bundled registry
- **WHEN** the user opens the detail or switches away and back
- **THEN** the original values remain selected and labelled as legacy custom
- **AND** no save occurs until a supported combination is explicitly selected and saved.

### Requirement: Claude 旧版本失败提供同一受信任更新入口

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复
Acceptance: main-conversation#58

When a Claude-bound run fails the `<2.1.170` runtime gate, the console MUST show a stable
“Claude Code 需要升级” reason and an accessible update action. The renderer MUST NOT receive or
submit executable paths, commands, args, stderr or internal errors. Triggering update MUST preserve
the failed run, user message and frozen profile; completion MUST offer an explicit retry rather than
automatically creating a Claude session.

#### Scenario: Runtime old-version failure does not crash

- **GIVEN** a Claude-bound run reports unsupported version before session creation
- **WHEN** the failure renders
- **THEN** the timeline remains usable and shows the update action
- **AND** updating does not erase the failed attempt or automatically rerun it.

## RENAMED Requirements

- FROM: `### Requirement: 引导第 1 步以双 CLI 独立状态放行`
  TO: `### Requirement: 引导第 1 步以三 CLI 独立状态放行`
