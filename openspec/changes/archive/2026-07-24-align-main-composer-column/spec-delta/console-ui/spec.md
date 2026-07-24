# spec-delta: console-ui / align-main-composer-column

## Requirement: 主会话输入器复用正文列
Source: docs/product/pages/main-conversation.md#页面结构

系统 MUST 让已有会话 composer、其上方的待发射区和新对话 composer 与主会话正文列使用相同的最大宽度和左右边界，并在可用宽度不足时一起响应式收缩。系统 MUST NOT 因统一主会话列而改变右侧子任务栏 composer 的独立宽度约束。

### Scenario: 已有会话输入器与正文列对齐
- GIVEN 主时间线显示历史消息和底部 composer
- WHEN 主内容区宽于正文列最大宽度
- THEN composer 的左右边界与正文列一致

### Scenario: 待发射区与输入器对齐
- GIVEN 主理人运行期间存在至少一条待发射消息
- WHEN 待发射区显示在 composer 上方
- THEN 待发射区、composer 与正文列使用相同的左右边界

### Scenario: 新对话与窄窗口保持同一列
- GIVEN 用户位于新对话状态
- WHEN 主内容区宽于正文列上限或缩窄到不足该上限
- THEN 新对话 composer 与主会话列使用相同上限并随可用宽度收缩
- AND 页面不产生由该 composer 引起的横向滚动
