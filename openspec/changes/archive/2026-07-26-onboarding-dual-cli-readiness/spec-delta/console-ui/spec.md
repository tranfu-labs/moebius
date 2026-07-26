# console-ui 规格增量

## MODIFIED Requirements

### Requirement: 引导第 1 步以双 CLI 独立状态放行

Source: docs/product/pages/onboarding.md#第-1-步-环境就绪至少一个-cli-可用

`OnboardingShell` MUST 同时渲染 Codex 和 Kimi 两行独立状态，并明确“Codex 或 Kimi
至少一个可用”。任一行 ready 时“继续” MUST 可用；两行都不 ready 时 MUST 禁用。
全局“重新检查” MUST 在 checking、ready、错误和安装状态下始终可操作，且不得让一套
CLI 的状态覆盖另一套。

缺失行 MUST 展示随应用发布的安装命令和具有“安装 Codex CLI”或“安装 Kimi CLI”
可访问名称的播放按钮。needs-login 与 unavailable 行 MUST 只展示对应修复指引，
不得展示安装动作。ready 行只展示调用方提供的当次真实版本；静态表面没有真实输入时
MUST 使用无版本通用文案。

#### Scenario: 任一 ready 立即放行

- **GIVEN** Codex ready 且 Kimi missing
- **WHEN** 第 1 步渲染
- **THEN** “继续”可用
- **AND** Kimi 行仍展示独立安装动作
- **AND** 页面明确安装 Kimi 是可选的。

#### Scenario: 手动重新检查始终存在

- **GIVEN** 两行都 ready
- **WHEN** 用户查看 footer
- **THEN** “重新检查”仍然可用
- **AND** 触发后两行分别显示当次 checking 反馈。

### Requirement: 引导安装反馈持续且可访问

Source: docs/product/pages/onboarding.md#第-1-步-cli-缺失与安装中

启动安装后，对应播放按钮 MUST 立即禁止重复触发，行内 MUST 持续显示受控阶段与活动
反馈，并提供取消。活动变化、成功、失败、取消和超时 MUST 通过 `aria-live` 宣告；
reduced-motion 下 MUST 以非动画状态变化保留同等信息。

离开第 1 步后，标题栏 MUST 在存在活动任务时聚合单项或双项状态；没有任务时 MUST
不占据状态位置。安装成功 MUST 只刷新对应 CLI；失败、取消和超时 MUST 保留独立重试。

#### Scenario: 点击播放立即反馈

- **GIVEN** Kimi 缺失
- **WHEN** 用户点击“安装 Kimi CLI”
- **THEN** 按钮立即变为不可重复触发
- **AND** 行内显示“正在安装”和活动阶段
- **AND** screen reader 收到状态更新。

#### Scenario: 双任务聚合

- **GIVEN** Codex 与 Kimi 安装都在运行
- **WHEN** 用户进入第 2 步
- **THEN** 标题栏显示两项安装活动的聚合入口
- **AND** 每项仍可区分自身阶段。

### Requirement: 引导贯穿团队 CLI 兼容提示

Source: docs/product/pages/onboarding.md#第-2-步-选团队

团队卡、第 4 步与新建对话 MUST 根据成员 effective CLI 和当前 readiness 使用同一规则
提示不兼容成员数与需要准备的 CLI，MUST NOT 静默替换成员 CLI。全兼容时 MAY 显示
准备就绪；部分兼容时 MUST 使用中性状态且 MUST NOT 显示全成功大勾。相关 CLI 修复后
提示 MUST 根据新 readiness 自动消失。

#### Scenario: 部分兼容团队

- **GIVEN** 只有 Codex ready 且所选团队有两名 Kimi 成员
- **WHEN** 用户查看团队卡、第 4 步和新建对话
- **THEN** 三处一致提示两名成员需要 Kimi 准备
- **AND** 不改变这些成员的 CLI
- **AND** 第 4 步不显示全成功大勾。

#### Scenario: 修复后提示消失

- **GIVEN** 当前选择的团队显示 Kimi 兼容警告
- **WHEN** Kimi 后台安装并 readiness 复检成功
- **THEN** 同一团队的兼容警告自动消失。
