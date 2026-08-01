# 任务：persist-sidebar-draft-attachment-presence

- [x] 护栏先行：为三态迁移、store 按 key 更新与纯关闭判定增加单元测试，记录实现前红灯。
- [x] 在侧栏草稿 v1 文档增加保守 presence 见证，旧字段缺失 / 非法值迁移为 `unknown`，新草稿为 `absent`。
- [x] 在附件 hook 增加最新 callback ref 和独立 per-key presence generation；保持 `draftRevisionRef` 推进点不变。
- [x] 接通 add/upload/remove/list/clone 的三态生命周期，失败保持 `unknown`，remove 不增加 reconcile list。
- [x] 在 App 按 attachment draft key 持久化 presence，并让同步关闭纯判定 fail closed。
- [x] 扩充 renderer 回归，覆盖重启主时序、legacy 收敛、慢 / 失败异步、重渲染和 callback identity 变化。
- [x] 运行定向测试、非零 scope、typecheck 与 Desktop build；不提前运行完整闸门。
- [ ] 完成三条真实 Electron 验收并记录主证据与辅证。
- [ ] 回写状态组合审计，保留 R-15 开放；完成符合度反思并归档 change。

## 当前验证证据

- guard 红灯：`/tmp/moebius-r14-guard-red.log`，实现前 4/4 失败，分别命中新草稿默认值、legacy 迁移、fail-closed 判定与 store 窄更新。
- 定向测试：3 个文件 30/30 通过，日志 `/tmp/moebius-r14-targeted.log`。
- scope：`pnpm run test --scope 3e3c1cb` 报告受影响测试文件 6 个，58/58 通过；日志 `/tmp/moebius-r14-scope.log`，非假绿。
- 根 typecheck 退出 0，日志 `/tmp/moebius-r14-typecheck.log`；Desktop build 退出 0，日志 `/tmp/moebius-r14-build.log`；仓库未配置 lint。
- `rg -n 'draftRevisionRef\.current\.set' desktop/src/console-page/use-managed-attachments.ts` 仅命中整集替换原有推进点；add/remove 没有推进该 revision。

## 真机验收状态

- **环境**：真实 dev Electron + 真实内嵌 local-console 服务；按主理人裁决，将真实用户操作产生的已注册项目数据根整体克隆到隔离根 `/tmp/moebius-r14-real-clone.TpM5WP`，应用日志 `/tmp/moebius-r14-real-electron-final.log`。所有被验收状态均经真实 UI 创建，未使用网络 mock、storage 注入、fixture 或 dialog stub；用户真实数据根未被写入。
- **入口**：从真实主对话的会话菜单经“在右侧栏分析这段对话”创建分析草稿 A，通过真实拖放加入 `/tmp/moebius-r14-attachment-a.txt` 并等待上传成功，再经真实按钮删除唯一文本胶囊；持久化观察为 `body === ""`、`textFragments.length === 0`、`managedAttachmentPresence === "present"`。同一宿主下从“新建空白标签 → 新会话”创建 B，经真实键盘输入 `R14-B`；重启后页面显示 A 未选中、B 选中，且 B 正文恢复。
- **主证据（部分完成）**：重启后未点击 A，直接点 A 的关闭按钮；renderer 随即被原生系统模态框阻塞，CDP `Runtime.evaluate` 不再返回，而 `Page.handleJavaScriptDialog({ accept: false })` 返回 `No dialog is showing`，证明出现的是 CDP 无法接管的原生确认框而非 renderer / JavaScript dialog。
- **未验证 / 阻塞**：当前执行会话没有 macOS 辅助功能 / 输入控制权限（System Events 报 `-25211`）。CDP 可点击 renderer，但无法读取或点击原生确认框；因此无法完成“取消后 A/B、附件、选中态、焦点保持”“确认后重启不恢复”及可信空草稿无确认三条屏幕观察。按 `docs/protocols/real-app-acceptance.md` 如实保留为未验证，不以自动测试或结构推导抵扣。
