# console-ui delta：sidebar-conversation-management

说明：这是 `spec-delta/console-ui/spec.md` 的 OpenSpec CLI 可验证镜像，两者语义保持一致。

## MODIFIED Requirements

### Requirement: Conversation status dot semantics

The console UI MUST satisfy the following status-dot contract.

Source: docs/product/pages/main-left-sidebar.md#对话状态点与顺序

会话点 MUST 以未确认 attention、控制工作、任意未读依次派生 red、blink、blue、none；项目聚合 MUST 排除置顶会话并按 red、blue、blink、none 选择。点与菜单辅助名称 MUST 分别为“需要你处理”“未读”“正在运行”。

#### Scenario: 手动未读不是 Agent 新结果
- GIVEN 用户把静止会话标记为未读且没有 Agent 新结果
- WHEN 侧栏渲染该行
- THEN 行显示蓝点且辅助名称为“未读”
- AND 不声称 Agent 有新结果。

## ADDED Requirements

### Requirement: 置顶迁移与菜单矩阵

The console UI MUST satisfy the following pinned-section and menu contract.

Source: docs/product/pages/main-left-sidebar.md#置顶区

侧栏 MUST 在应用级入口下方和项目区上方显示非空置顶区。置顶会话 MUST 只出现一次；菜单 MUST 按最终点显示对应阅读操作。持久化失败或陈旧状态 MUST 保留原行、原点和原菜单语义。

#### Scenario: 取消置顶回到折叠项目
- GIVEN 置顶会话所属项目已折叠
- WHEN 用户通过键盘取消置顶成功
- THEN 会话按原创建时间归位且不重复
- AND 焦点落到所属项目展开控件。

### Requirement: 一份共享对话信息浮层

The console UI MUST satisfy the following shared-preview contract.

Source: docs/product/pages/main-left-sidebar.md#对话行

整份侧栏 MUST 同时最多渲染一份对话信息浮层，并在目标行变化时沿纵轴跟随、原位替换完整标题、文件夹名称和实际工作空间分支。非 Git MUST 省略第三行；detached 与不可读 MUST 使用明确文本。菜单、重命名、离开区域和 reduced-motion MUST 按 PRD 收敛。

#### Scenario: 从 A 连续移动到 B
- GIVEN A 与 B 的文件夹或分支不同
- WHEN 指针从 A 移到 B
- THEN 可见浮层 DOM 数量始终不超过一
- AND 最终内容和位置只对应 B。

### Requirement: 重命名在所有生产入口一致呈现

The console UI MUST satisfy the following canonical-title contract.

Source: docs/product/pages/main-left-sidebar.md#重命名对话

重命名弹层 MUST trim 非空输入、允许重名、保存失败保留输入。成功后侧栏、主标题、搜索和右栏标签 MUST 使用 canonical 新标题；任何局部读取失败 MUST NOT 回显旧标题，并 MUST 显示非阻断说明、自动重读路径及持续失败时可用的手动重试入口。

#### Scenario: 标题已经保存但右栏暂时不可读
- GIVEN canonical 标题已变为 B 且某会话标签无法解析
- WHEN 标签组呈现
- THEN 原标签显示“标题更新中”和稳定区分信息
- AND 重试成功后同一标签原位显示 B。

### Requirement: 同名会话标签稳定可辨并保持横向位置

The console UI MUST satisfy the following same-title tab contract.

Source: docs/product/pages/main-right-sidebar.md#会话重命名同步

同名会话标签 MUST 显示稳定、用户可读且辅助名称一致的区分信息；同项目、同分支、同一分钟或多个标题无法解析时 MUST 使用稳定“同刻第 N 个”最终兜底。标题宽度变化时，选中或键盘聚焦标签 MUST 完整可见；后台标签更新 MUST NOT 抢占横向位置。

#### Scenario: 两个标题更新中标签
- GIVEN 同一组两个不同会话均无法读取标题
- WHEN 标签条显示两个“标题更新中”
- THEN 可见第二行和辅助名称均以不同“同刻第 N 个”稳定区分两者。
