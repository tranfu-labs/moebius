# 任务：desktop-auto-update-and-shutdown-guard

## 方案阶段

- [x] 核对仓库 `AGENTS.md`、`openspec/changes/AGENTS.md`、设置/侧栏产品文档、desktop-shell/console-ui 规格与现有 updater/lifecycle 实现。
- [x] 将自动检查、后台下载、侧栏就绪按钮、独立安装弹窗、共享任务保护和单次 `Command + Q` 产品意图写回 `docs/product/pages/settings.md` 与 `main-left-sidebar.md`。
- [x] 完成 proposal、design、wireframes、architecture 快照、spec delta 与逐条真实验收矩阵；本轮不修改实现代码。

### 本轮复核修正（已完成文档同步）

- [x] 设置“关于”收敛为检查、进度、已准备好和失败状态；移除设置内安装按钮，安装入口只保留侧栏。
- [x] 明确无运行任务时 `Command + Q` 无确认直接安全退出；有运行任务时才出现普通退出保护。
- [x] 将 Dock 验收改为进程结束、Dock 无运行中指示；未固定应用时才观察图标消失。
- [x] 增加已下载更新跨普通重启恢复 `ready` 且不重新下载完整包、侧栏按钮重新出现的验收。
- [x] 将更新触发收敛为启动后自动检查和手动立即检查，移除周期调度承诺。

## 实现阶段（待方案核验后）

- [x] 以 `electron-updater` 接入正式 macOS arm64 的启动自动检查、手动立即检查、自动下载、进度、校验完成、失败和重试事件；不增加周期调度；开发态/不支持平台安全降级。
- [x] 更新发布配置与 release 门禁，确认最终签名、公证 ZIP、`latest-mac.yml`、YML 引用的 ZIP blockmap 来自同一版本；用 `pnpm release:prepare-update` 生成干净 staging，再用 `pnpm release:validate-update` 拒绝中间文件和不一致元数据。
- [x] 将 Release 上传收敛为最终 DMG、最终 ZIP、`latest-mac.yml` 与明确白名单 sidecar；通过 `pnpm release:upload-assets` 按精确路径上传，本地和远端均校验 YML 到最终 ZIP 的版本、文件名、大小和 SHA-512。
- [x] 扩展主进程更新 DTO、IPC/preload 与 renderer 状态机，覆盖状态单飞、迟到事件、进度边界和失败回退。
- [x] 实现设置“关于”状态（无安装按钮）、侧栏并列“安装更新”入口、两套独立确认弹窗和完整中英文可访问文案；更新不再触发完成/失败通知。
- [x] 保留并恢复更新器已下载包的身份与就绪元数据；普通重启后恢复 `ready` 和侧栏安装按钮，不重新下载完整包；缓存校验失败才回到可重试失败。
- [x] 修复已安装版本遗留 ready marker 的版本比较与清理；安装器未使进程退出时由有界看门狗恢复可用应用、保留 marker 并解除安装单飞锁；available/downloading 阶段禁止重复检查；清理异常复位退出协调器。
- [x] 抽取共享退出/重启安装协调器，覆盖 local Agent/provider、AI 建队和 CLI 安装任务；停止失败时保持应用打开并保留记录。
- [x] 修正 `before-quit`、主窗口 `close`、`window-all-closed` 的终止意图和共享 Promise；无运行任务时一次 `Command + Q` 无确认直接退出，有运行任务时才显示退出保护，最终调用不重复。
- [x] 增加纯逻辑、IPC、renderer 异步环境和 Electron lifecycle 测试；不写镜像测试，不以读取文档/页面源代码代替行为断言。
- [ ] 在独立临时应用实例中完成 `acceptance.md` 全部真实运行验收，记录系统临时 evidence 路径；严禁触碰当前承载会话。
- [x] 按 `pnpm run test --scope`、定向测试、typecheck、必要 build 与 release metadata 校验收口；完整 `pnpm test` 留给 QA/主理人复核通过后的合并点。

## 归档阶段（实现完成后）

- [ ] 将 spec delta 合并回 `openspec/specs/desktop-shell/` 与 `openspec/specs/console-ui/`，核对 PRD 与最终实现。
- [ ] 将 `architecture/after.svg` 回流 `docs/architecture/` 并按真实模块职责更新 `module-map.md`；移动 change 到归档目录。
