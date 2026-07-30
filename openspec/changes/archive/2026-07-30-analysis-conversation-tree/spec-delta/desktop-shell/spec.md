# desktop-shell delta：analysis-conversation-tree

## Requirement: 分析草稿提升为直接父拥有的唯一会话标签
Source: docs/product/pages/main-right-sidebar.md#分析对话标签与跨树路由

desktop renderer MUST 在分析首发成功后把草稿原位提升为已创建分析会话标签，并在根会话的同一外层标签组中按会话标识去重。

### Scenario: 重复激活直接子项

- Given 分析会话 B 已在根会话 A 的标签组打开
- When 用户再次激活 A 面板中的 B
- Then 聚焦既有 B 标签
- And 不创建重复标签

### Scenario: 孙辈打开为兄弟标签

- Given 分析会话 B 在根会话 A 的外层标签组中
- And B 的面板包含直接子项 C
- When 用户激活 C
- Then C 在同一外层标签条打开
- And 不创建嵌套右侧栏

## Requirement: 跨树分析导航原子切换工作现场
Source: docs/product/pages/main-right-sidebar.md#分析对话标签与跨树路由

跨树 `moebius-ref:` 导航 MUST 先解析并准备目标根会话及其标签现场，再一次提交根选择与目标分析标签；失败 MUST 保持原工作现场。

### Scenario: 跨树消息引用成功

- Given 当前位于根会话 A，引用目标属于根会话 B 的分析后代
- When 用户激活引用
- Then 主内容切换为 B
- And 恢复 B 自己的标签组并聚焦目标

### Scenario: 目标准备失败

- Given 目标根会话或目标分析会话不可用
- When 用户激活引用
- Then 当前根会话、标签组、活动标签和阅读位置不变
- And 原链接显示可理解的不可用反馈

## Requirement: 面板开合只在当前应用进程按 session 记忆
Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

renderer MUST 按当前对话 session 分别记忆分析面板开合，MUST NOT 将该状态持久化到跨进程存储。

### Scenario: 切换后返回

- Given 用户在本次应用运行中打开会话 A 的分析面板
- When 切换到 B 再返回 A
- Then A 的面板保持打开

### Scenario: 软件重启

- Given 上次运行结束前 A 的面板打开
- When 应用重新启动
- Then A 的面板默认关闭

## Requirement: 服务端提交后才清理分析入口和标签
Source: docs/product/pages/main-conversation.md#分析对话归属归档与移除

renderer MUST 仅在归档或项目移除服务端提交成功后清理对应面板入口和分析标签；失败或回滚 MUST 保持原工作现场。

### Scenario: 强制项目移除失败

- Given 分析子树在面板与标签组中可见
- When 强制移除的停止或放弃步骤失败
- Then 面板入口、标签顺序和活动标签保持不变
