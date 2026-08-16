# local-console 规格增量

## MODIFIED Requirements

### Requirement: 活动事实只记录单调、安全的最新投影

Source: docs/product/pages/agent-conversation.md#最新活动

系统 MUST 从当前执行引擎的结构化事件投影有界的动作与安全对象，并按 run 内单调游标原地更新最新活动。系统 MUST NOT 在较新事件完成后回退到较早工具的开始事件，也 MUST NOT 在**最新活动** DTO 中暴露命令参数全集、输出、绝对路径、运行目录、内部 ID 或原始协议类型。

本条只约束最新活动这一条单行投影。过程步骤 DTO 的对象与输出边界由「过程步骤投影出可辨认对象」与「步骤输出在投影时即有界」两条 Requirement 定义。

#### Scenario: 较新并发工具完成

- **GIVEN** 较早工具 A 仍运行且较新工具 B 已开始
- **WHEN** B 产生完成事件
- **THEN** 最新活动显示 B 的完成态
- **AND** 后续无新事件时不闪回 A 的开始态

## ADDED Requirements

### Requirement: 过程步骤投影出可辨认对象

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 为每个过程步骤投影一个用户可辨认的对象：命令取执行引擎自带的用途说明，缺失时取剥离 shell 包装后的命令原文；skill 调用取 skill 名称；工具与 MCP 取去除 server 前缀后的工具名；读取与修改文件取文件名；搜索取原始查询；思考取思考文本首句。

系统 MUST NOT 产出只有动作、没有对象的步骤，MUST NOT 对搜索查询与 URL 施加路径压缩，也 MUST NOT 让 shell 包装挤掉命令本身。秘密剥离对全部类型保持生效。

#### Scenario: 带 description 的命令步骤

- **GIVEN** Claude run 发起一次带用途说明的命令调用
- **WHEN** runtime 投影该步骤
- **THEN** 步骤对象是该用途说明原文
- **AND** 不出现 `zsh`、`-lc` 等包装 token

#### Scenario: skill 调用步骤

- **GIVEN** run 调用名为 skill 的工具且参数中带 skill 名称
- **WHEN** runtime 投影该步骤
- **THEN** 步骤对象是该 skill 名称
- **AND** 不是工具名本身

#### Scenario: 搜索步骤含 URL

- **GIVEN** run 发起一次查询词为完整 URL 的搜索
- **WHEN** runtime 投影该步骤
- **THEN** 步骤对象保留可识别的原始查询
- **AND** URL 未被按路径分隔符压缩成末段

### Requirement: 工具返回并入其调用步骤

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 把工具返回事件关联到对应的调用步骤，作为该步骤的输出与终态。系统 MUST NOT 为工具返回新建独立步骤。

#### Scenario: 一次工具调用的完整往返

- **GIVEN** run 发起一次工具调用并随后收到其返回
- **WHEN** runtime 折叠该 run 的步骤
- **THEN** 该往返只产生一个步骤
- **AND** 不出现对象为空的附加步骤

### Requirement: 步骤输出在投影时即有界

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 在投影阶段把单个步骤的输出裁剪到有界规模，并记录被省略的数量。裁剪 MUST 优先保留含错误信息的行，再按原顺序补足。系统 MUST NOT 把未裁剪的原始输出送入步骤 DTO 或终局持久化步骤。

#### Scenario: 超长命令输出

- **GIVEN** 一次命令返回远超单步上限的输出
- **WHEN** runtime 投影该步骤
- **THEN** 步骤输出被裁剪到上限内并带有剩余数量
- **AND** 完整内容仍只能从过程记录取得

#### Scenario: 失败输出中错误不在开头

- **GIVEN** 一次失败命令的输出前段是无关启动日志、错误在后段
- **WHEN** runtime 裁剪该步骤输出
- **THEN** 保留下来的内容包含错误信息
- **AND** 不是机械截取的最前若干行

### Requirement: 步骤区分成功与失败

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 在执行引擎提供失败信号时把对应步骤标记为失败，并投影错误中第一句有内容的说明；只有退出码而无可读说明时才投影退出码。步骤失败 MUST NOT 改变该 run 的终局判定。

#### Scenario: 工具返回带失败标志

- **GIVEN** 一次工具返回被执行引擎标记为错误
- **WHEN** runtime 投影该步骤
- **THEN** 该步骤为失败态并带有可读错误说明
- **AND** run 自身的终局不因此改变

### Requirement: 三种执行引擎都返回可读思考文本

Source: docs/product/pages/agent-conversation.md#过程步骤

系统 MUST 以能取得可读思考文本的方式调用 Claude、Codex 与 Kimi。系统 MUST NOT 用长度估算、加密载荷或空白冒充思考内容。某个引擎在当前调用方式下不返回思考文本时，MUST 视为未满足本条。

#### Scenario: Claude run 产生思考

- **GIVEN** Claude run 在本次调用中产生思考块
- **WHEN** runtime 投影思考步骤
- **THEN** 步骤对象是可读的思考首句
- **AND** 不是 token 估算或空字符串

#### Scenario: Codex run 产生推理

- **GIVEN** Codex run 在本次调用中产生推理
- **WHEN** runtime 投影思考步骤
- **THEN** 步骤对象是可读的推理摘要首句
- **AND** 不是加密载荷
