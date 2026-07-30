# 任务：sidebar-conversation-management

- [x] 建立 proposal、design、tasks、wireframes、架构图与三个域的 spec delta
- [x] 增加 SQLite 兼容迁移、会话元数据 DTO 与 store commands
- [x] 实现 attention/read-state、pin、title runtime 与 HTTP mutations
- [x] 实现侧栏置顶区、菜单矩阵、重命名和共享信息浮层
- [x] 实现 renderer mutation 编排、显式查看生命周期与搜索失效
- [x] 实现右栏 canonical title、同名区分、读取失败和横向定位
- [x] 更新中英文文案、DESIGN.md、module-map 与确定性 Story
- [x] 补齐 store/runtime/server、console-ui、renderer 单元与竞态测试
- [x] 运行定向测试、全量测试、typecheck、Storybook 门禁和 desktop build
- [x] 在真实生产 Page Story 与 Electron 页面观察核心路径并记录临时证据
- [x] 对照 proposal/design/spec delta 做符合度反思并修正偏差

## 交付记录

- 最终全量测试四段分别为 769、51、375、437 项，均退出码 0。
- 根、desktop、console-ui 三套 typecheck、Storybook 门禁、desktop build、change strict validation 与 `git diff --check` 均退出码 0。
- 功能验收首轮发现四项问题；返工后复验闭合，并以最终生产 Page Story 观察置顶聚合及右栏标题恢复。
- 视觉验收由用户明确要求跳过；本 change 不把视觉验收记录为通过。
