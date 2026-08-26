# 任务：workspace-preference-direct-selection

## 变更基线

- [x] 读取并更新 `docs/product/pages/main-conversation.md` 产品事实源。
- [x] 创建 proposal、design 与 spec-delta，保留当前 `openspec/specs` 直到归档回流。
- [x] 用户确认偏好写入方案 A：显式选择后立即保存项目偏好。

## 模块实现

- [x] 移除 `NewConversationPage` 独立工作空间确认弹窗，补直接选择与无弹窗测试。
- [x] 扩展 desktop project mutation port、browser adapter 和 application 错误/刷新链路。
- [x] 接入主新对话与侧栏新对话草稿的项目偏好写入，固定快速连续选择的最后写入顺序。
- [x] 补齐 launcher、project mutation、local-console API/store 测试，覆盖项目隔离、重启持久化与已有会话不变。
- [x] 完成功能单元验收标准落位自查并提交模块交接证据。

## 真实验收与归档

- [x] 在真实 Electron 中从新建会话入口验证无弹窗直接选择。
- [x] 在真实 Electron 中验证两个项目偏好互不污染、重启后保持、已有会话不变。
- [x] 步骤 4 生成边界矩阵并执行全量回归。
- [ ] 步骤 5 通过用户验收后归档 change，并将 spec-delta 回流事实规格。

## 交付记录：真机验收

执行命令：`pnpm exec tsx /tmp/moebius-workspace-preference-real.ts`，退出码 0。

环境：真机（真实 Electron + production desktop dist + preload/local-console/SQLite + 临时 Git 项目 + 临时 fake Codex）。证据文件与截图写入系统临时目录，路径由命令输出报告。

1. 入口：新建对话 → 项目选择器。操作：通过真实项目选择器先后添加 `project-a` 与 `project-b`。屏幕观察：两个 Git 项目均在生产新对话页面中成为可选项目。与承诺一致：是。
2. 入口：新建对话 → `project-a` → 消息内容。操作：发送首条消息创建已有 direct 会话。屏幕观察：真实回复显示，记录的会话工作空间为 direct。与承诺一致：是。
3. 入口：新建对话 → `project-a` → 工作空间菜单。操作：点击“独立工作空间”。屏幕观察：按钮立即显示“独立工作空间”，额外 dialog 数量为 0。与承诺一致：是。
4. 入口：新对话草稿 → 项目切换菜单。操作：从 `project-a` 切到 `project-b`，再切回 `project-a`。屏幕观察：`project-b` 显示默认工作空间，`project-a` 恢复独立工作空间，偏好未互相污染。与承诺一致：是。
5. 入口：重启 Electron → 新建对话 → 项目选择。操作：重启应用后分别选择两个项目。屏幕观察：`project-a` 恢复独立工作空间，`project-b` 保持默认工作空间。与承诺一致：是。
6. 入口：重启 Electron → 已有会话侧栏。操作：读取并打开重启后的既有会话。屏幕观察：既有会话仍为 direct。与承诺一致：是。
