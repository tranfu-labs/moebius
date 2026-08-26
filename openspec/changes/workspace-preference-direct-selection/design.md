# 设计：workspace-preference-direct-selection

## 方案

### 数据与应用边界

- 复用 `projects.worktree_mode` 作为项目级新对话默认值。`sessions.workspace_mode` 仍保存每段会话的实际工作空间；不新增 SQLite 字段、迁移或 renderer localStorage 偏好。
- 复用 local-console 已有 `PATCH /api/local-console/projects/:projectId` 的 `worktreeMode` 分支与 `updateProject` store 操作。
- 在 desktop project mutation port 增加 workspace preference mutation；成功后刷新项目投影，失败沿用项目 mutation 错误控制器。

### 主新对话数据流

1. `OperatorProject.worktreeMode` 作为目标项目的初始 workspace mode；现有 launcher 的项目切换和新建入口继续从该字段解析。
2. `NewConversationPage` 的 workspace menu 直接发出 `direct` / `worktree` intent，不再拥有确认弹窗状态。
3. desktop application 立即提交当前项目偏好，并同步更新草稿；偏好请求按项目串行，避免快速连续选择时旧响应覆盖新选择。
4. 偏好写入失败时保留当前草稿选择并显示既有错误，不创建或修改会话；用户可再次选择重试。
5. 创建会话仍显式传递草稿的 workspace mode，已有会话不重新读取项目偏好。

### 侧栏新对话草稿

侧栏草稿复用同一个 `NewConversationPage`。草稿本地状态更新与项目偏好 mutation 通过 desktop view/application 层接线；项目切换和恢复草稿只更新草稿，不因为恢复动作写入偏好。

### UI 与可访问性

- 继续使用现有 Radix `DropdownMenuCheckboxItem` 和语义 token，不引入新的 modal 或视觉模式。
- 独立工作空间说明放在菜单项的描述行；非 Git 项目沿用 disabled 状态和原因文案。
- 已开始会话继续使用不可点击的 workspace context，不增加切回入口。

## 权衡

- 选择现有 `worktreeMode` 而不是新建 `workspace_preference` 表：已有项目字段、PATCH 接口和 session 默认链路已经满足项目级持久化；代价是字段名称继续承载“新会话默认模式”语义。
- 选择显式选择后立即写入，而不是创建会话成功后写入：用户已确认偏好在选择时生效，且该写入可逆；代价是用户放弃草稿时也会保存最后一次显式选择。
- 选择保留菜单内说明而不是完全删除说明：用户要求移除额外弹窗，但产品仍需说明未提交改动不会进入副本；代价是菜单项高度略增。
- 选择保留当前草稿选择并报告写入失败，而不是静默回退：用户可见选择与失败事实不互相伪装；代价是失败后再次进入新对话仍可能读取旧项目偏好。

## 风险

- 现有 project mutation 刷新与新对话草稿更新可能产生竞态；通过按项目串行 mutation 和 launcher model 测试固定最后一次选择优先。
- 项目偏好与会话 workspace mode 可能被错误合并；通过 API/store 测试验证偏好更新不改已有 session。
- Page 单测不能替代带副作用的真实入口；交付前必须运行真实 Electron 验收并留系统临时 evidence。
