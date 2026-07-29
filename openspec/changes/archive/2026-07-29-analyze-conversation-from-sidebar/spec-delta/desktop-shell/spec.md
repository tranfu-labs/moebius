# desktop-shell delta：analyze-conversation-from-sidebar

## ADDED Requirements

### Requirement: 非当前对话分析采用原子组合路由
Source: docs/product/pages/main-left-sidebar.md#在右侧栏分析这段对话

用户从左侧栏非当前对话触发分析时，desktop renderer MUST 先准备目标来源视图、对话级片段、可归并草稿与右侧栏标签，全部成功后再提交唯一选中行、主内容和右侧栏状态。任一步失败时 MUST 保留进入前的选中行、主内容、右侧栏标签、草稿与阅读现场，MUST NOT 留下半切换状态或无来源片段的草稿。

#### Scenario: 非当前对话成功切换

- GIVEN 主内容显示对话 A 且用户从对话 B 的菜单触发分析
- WHEN B 的来源视图、片段、草稿与标签全部准备成功
- THEN B 成为左侧栏唯一选中项
- AND 主内容显示 B，右侧栏显示 B 的分析草稿
- AND A 的右侧栏标签、草稿和阅读状态按 A 保留

#### Scenario: 非当前对话准备失败

- GIVEN 主内容显示对话 A 或全局新对话页，且用户从对话 B 的菜单触发分析
- WHEN B 的读取、片段生成、草稿准备或页面呈现任一步失败
- THEN 进入前的选中项、主内容与右侧栏保持不变
- AND B 不留下新草稿或半套标签
- AND 用户看到可理解且可访问的失败原因

### Requirement: 分析发送条件只取草稿当前项目
Source: docs/product/pages/main-conversation.md#右侧栏中的分析新会话

来源项目目录不可用但记录路径可取得时，renderer MUST 允许打开完整分析草稿，并 MUST 保留且标明不可用的来源项目，根据草稿当前选择的项目重新计算工作空间与发送条件。用户改选可用项目后 MUST 立即恢复发送；原来源项目之后不可用 MUST NOT 继续阻止发送。

#### Scenario: 改选项目恢复发送

- GIVEN 分析草稿来源项目不可用且草稿内容与片段完整保留
- WHEN 用户把草稿当前项目改为可用项目
- THEN 工作空间与发送条件按新项目重新计算
- AND 来源片段保持不变
