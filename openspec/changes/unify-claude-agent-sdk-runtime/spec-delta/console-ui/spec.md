# console-ui 规格增量

## MODIFIED Requirements

### Requirement: Claude 运行块只显示结构化活动与 native history 入口

Source: `openspec/specs/console-ui/spec.md`#运行块与完整输出

Claude 的活动运行块 MUST 使用现有结构化 activity、process steps、最终 Markdown 和
完整输出入口；MUST 保留停止/取消、耗时、错误和局部 unavailable 语义。运行块、侧栏
会话与组合根 MUST NOT 渲染 Claude raw PTY bytes、xterm terminal surface、登录/信任/MCP
确认输入或为此轮询 `claude-terminal` API。

完整过程、thinking、工具、错误和 usage 继续由 provider-native JSONL resolver 通过
右侧栏读取；native record 不可用时只显示该 attempt 的 provider-specific unavailable，
不得用 raw stdout/stderr 或最终回复复制替代。

#### Scenario: Claude run 在页面中运行

- **GIVEN** 当前活动 run 的 engine 是 Claude
- **WHEN** 用户查看会话时间线
- **THEN** 页面显示结构化最新活动、状态和停止动作
- **AND** 不出现 terminal surface、PTY 滚动区域或隐藏原生交互
- **AND** 用户仍能从完整输出入口打开同一 native JSONL attempt。
