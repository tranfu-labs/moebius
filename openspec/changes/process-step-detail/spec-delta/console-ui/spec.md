# console-ui 规格增量

## ADDED Requirements

### Requirement: 过程步骤行显示动作与对象

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 在每个过程步骤行显示该步骤的动作与对象。步骤行 MUST NOT 带「正在」「已完成」前缀；进行中 MUST 由该行自身的进行态表达。

#### Scenario: 运行中的步骤列表

- **GIVEN** 一条运行中的成员记录已产生多个步骤
- **WHEN** 用户查看过程区
- **THEN** 每行显示动作与可辨认对象，正在进行的一行与已完成行可区分
- **AND** 不出现「正在使用工具」这类只有动作的裸行

### Requirement: 过程区默认状态不改变可展开深度

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 在运行中默认展开过程区，在该步骤终局后默认收起为单行摘要。系统 MUST NOT 因为记录已进入历史而减少步骤数量或降低单步可展开的深度。

#### Scenario: 终局后展开历史记录

- **GIVEN** 一条已成功结束的成员记录
- **WHEN** 用户展开其过程区并点开任一步骤
- **THEN** 步骤数量与每步可见内容与该 run 运行时一致

### Requirement: 步骤可就地展开输入与输出

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 允许用户用鼠标或键盘点开单个步骤，展开后先显示该步骤输入、再显示其输出，并允许多个步骤同时展开。输出被裁剪时 MUST 显示剩余数量与前往完整输出的说明。运行中追加新步骤 MUST NOT 收起用户已展开的行。

展开内容 MUST 为只读文本且可选中复制，终端控制字符 MUST 以可见转义形式呈现。系统 MUST NOT 执行其中的 Markdown、HTML 或终端控制序列。

#### Scenario: 展开一个命令步骤

- **GIVEN** 过程区中有一个命令步骤
- **WHEN** 用户点开该步骤
- **THEN** 先显示完整命令原文，再显示其输出
- **AND** 输出超限时显示剩余数量与前往完整输出的说明

#### Scenario: 运行中展开后继续产生新步骤

- **GIVEN** 用户已展开某个步骤且该 run 仍在运行
- **WHEN** 新步骤追加到列表
- **THEN** 已展开的步骤保持展开

### Requirement: 失败步骤在收起态可辨认

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 让失败步骤在收起态即与成功步骤可辨认，并在行内显示错误中第一句有内容的说明。系统 MUST NOT 只显示退出码而无可读说明，也 MUST NOT 用步骤失败暗示整轮运行已停止。

#### Scenario: 一步命令失败但 run 继续

- **GIVEN** 某个命令步骤失败而 run 继续执行
- **WHEN** 用户查看过程区
- **THEN** 该步骤可辨认为失败并带可读错误说明
- **AND** 记录未显示整轮已停止

### Requirement: 缺少步骤记录时说明而非留白

Source: docs/product/pages/agent-conversation.md#过程步骤

历史记录缺少步骤输入或输出时，系统 MUST 在展开位置显示当前引擎未记录的说明。系统 MUST NOT 显示空白展开区，也 MUST NOT 用其他来源回填缺失内容。

#### Scenario: 展开升级前的历史步骤

- **GIVEN** 一条在本次变更前落库、没有步骤输出的历史记录
- **WHEN** 用户点开其中某个步骤
- **THEN** 展开位置显示未记录说明
- **AND** 不出现空白区域，也不显示由其他来源补写的内容
