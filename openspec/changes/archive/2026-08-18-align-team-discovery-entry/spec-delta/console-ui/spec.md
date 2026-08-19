# console-ui 规格增量

## MODIFIED Requirements

### Requirement: Agent 团队首页分开寻找与新建任务

Source: docs/product/pages/agent-teams.md#页面标题与任务入口
Acceptance: agent-teams#4

系统 MUST 在 Agent 团队首页常驻显示「找现成团队」和「新建团队」两个任务入口。「新建团队」菜单 MUST 只提供「跟 AI 聊出一支新团队」与「从空白开始」；系统 MUST 让 AI 建队占用当前页面主体并提供返回 Agent 团队列表的动作，且 MUST 继续让从空白开始使用短字段 `TeamInformationDialog`。系统 MUST 只在已有团队详情中提供复制入口；AI 建队、从空白开始和复制团队成功后 MUST 都以普通用户团队进入既有团队详情。`console-ui` MUST 通过宿主回调表达寻找现成团队的导航意图，不得自行访问 GitHub、读取本机登录态或执行安装。

系统 MUST 按是否继续接收作者更新，把团队分为「持续接收更新」和「独立维护」，不得用“跟随上游”或“只在本地”作为这两个分组的用户可见名称。

#### Scenario: 首页直接进入团队发现

- GIVEN Agent 团队首页已载入且宿主提供团队发现回调
- WHEN 用户点击常驻的「找现成团队」
- THEN 组件调用团队发现回调一次
- AND 用户无需展开「新建团队」菜单

#### Scenario: 新建菜单只包含两条创建路径

- GIVEN Agent 团队首页已经载入
- WHEN 用户展开「新建团队」
- THEN 菜单显示 AI 建队与从空白开始
- AND 菜单不显示寻找、安装或复制已有团队的入口

#### Scenario: 从新建菜单进入 AI 建队主体

- GIVEN Agent 团队首页已经载入
- WHEN 用户展开「新建团队」并选择「跟 AI 聊出一支新团队」
- THEN 当前页面主体显示共享的 `TeamBuilderView`
- AND 桌面 console 顶部导航和 Agent 团队上下文仍然保留
- AND 页面没有打开新建团队 dialog

#### Scenario: 从空白开始保持既有短表单

- GIVEN Agent 团队首页已经载入
- WHEN 用户展开「新建团队」并选择「从空白开始」
- THEN 页面打开只含团队名称和一句话描述的 `TeamInformationDialog`
- AND 菜单中没有复制入口

#### Scenario: 首页按更新关系分组

- GIVEN 首页同时有包含来源仓库和不包含来源仓库的团队
- WHEN 团队列表渲染
- THEN 两组标题分别为「持续接收更新」和「独立维护」

### Requirement: GitHub 团队页面复用 Agent 团队生产结构

Source: docs/product/pages/github-team-discovery.md#页面结构
Source: docs/product/pages/github-team-preview.md#页面结构
Source: docs/product/pages/agent-teams.md#持续接收更新的团队详情

`console-ui` MUST 导出 GitHub 团队发现、安装前预览和持续接收更新团队详情三个生产页面组合，并为三个组合提供 fullscreen Page Story。发现页 MUST 复用 Agent 团队页的滚动面、页头、卡片、按钮和响应式间距；安装前预览 MUST 复用只读 `AgentTeamDetail`，同时保留仓库身份、主 Agent、成员总数、逐名完整 `AGENT.md`、推荐运行配置、三项安装后果与常驻安装操作；持续接收更新团队详情 MUST 复用可编辑 `AgentTeamDetail`，同时保留来源仓库、同步结果、来源失效、成员编辑、运行配置与单一保存主操作。

三个页面组件 MUST 只通过 props 与回调表达 GitHub 查询、打开仓库、安装、同步、保存和导航意图；Story MUST 使用确定 fixture，MUST NOT 连接真实 GitHub、gh 登录态、文件系统、IPC 或用户数据。

#### Scenario: 发现页使用产品任务名称

- GIVEN 宿主打开 GitHub 团队发现页
- WHEN 页面初始渲染
- THEN 页面标题为「找现成团队」
- AND 搜索框提示用户搜索团队名称或用途

#### Scenario: 安装前预览完整呈现将要安装的内容

- GIVEN 宿主传入一支含四名成员的可安装团队
- WHEN 安装前预览以正常状态渲染
- THEN 页面显示仓库身份、star、更新时间、语言、主 Agent 与成员总数
- AND 用户可以逐名切换并阅读完整 `AGENT.md` 与推荐运行配置
- AND 三项安装后果与唯一「安装」主操作常驻在视口底部

#### Scenario: 持续接收更新团队详情沿用既有编辑层级

- GIVEN 宿主传入一支持续接收更新且可编辑的团队
- WHEN 团队详情渲染
- THEN 页面沿用 `AgentTeamDetail` 的成员、运行配置、画像、Markdown 与保存控件
- AND 来源仓库、同步结果或来源失效说明出现在同一详情结构中
- AND 不存在第二套同语义详情组件

#### Scenario: 停止接收更新说明动作后果

- GIVEN 一支持续接收更新的团队来源已失效
- WHEN 详情页显示解除更新关系的操作
- THEN 操作名称为「停止接收更新」
- AND 团队内容仍保持可编辑和可使用

#### Scenario: Storybook 覆盖页面边界状态

- GIVEN Storybook 构建 GitHub 团队页面目录
- WHEN 检查发现页、安装前预览与持续接收更新团队详情的 Page Story
- THEN 每页均有确定 fixture 覆盖正常状态及适用的空、加载、失败、无权限和长文本状态
- AND Page Story 不依赖本机登录态、网络、磁盘或桌面 renderer
