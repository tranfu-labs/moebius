# 设计：redesign-settings-about-updates

## 方案

### 生产 UI 与会话状态

- `SettingsDialog` 继续作为纯受控生产组件，渲染常规、关于、更新、复制和外链结果，不读取 Electron 或网络。
- `OperatorConsole` 持有弹窗开关、当前分类、外链局部失败和轻量通知队列；关闭后仍保持挂载，因此重开可恢复当前分类与终态。
- `desktop/src/console-page/settings-state.ts` 提供纯 reducer。`OperatorConsoleApp` 用 request id 与 in-flight ref 驱动元数据读取、更新检查和复制，避免父级重渲染、回调身份变化或慢返回创建重复请求或让旧结果覆盖新结果。
- 主窗口最小内容高度同步降为 480，使已确认的 `900 × 480` 短窗规则成为真实可达状态；标题固定，只有内容区纵向滚动。
- 语言保存沿用现有 `language-state.ts`；`OperatorConsole` 观察 saving → idle/failed 与 checking → terminal，只在弹窗关闭时追加一次不抢焦点通知。

### settings IPC

- 新建 `settings-contract.ts`，只暴露：
  - 读取 `{ version, platform: "Apple Silicon Mac" }`；
  - 检查更新并返回 `latest | available | failed` 的安全 DTO；
  - 复制由主进程按固定格式生成的版本信息。
- 新建 `settings-ipc.ts` 注册三个窄 channel。renderer 不提交命令、URL、剪贴板文本或网络参数。
- `updater.ts` 保留版本比较并增加带 `AbortSignal` 的 GitHub latest release 请求与 15 秒有界检查。HTTP 非成功、响应非法、网络失败和超时都映射为安全失败 reason，不返回原始错误、路径或响应正文。
- `main.ts` 不再在检查完成后自动调用浏览器，也不从设置旅程调用 `electron-updater`。返回的下载 URL 先限制为本仓库 GitHub Releases 路径，并只在用户显式点击后通过既有 `openValidatedExternalLink` 再次复验。
- 更新能力迁入设置后，辅助状态页移除旧“检查更新”按钮及 `action:check-updates` preload/main IPC，避免保留没有结果投影的第二入口。

### 公开链接

- renderer 只从受控常量和安全 DTO 生成四类 URL：Release 列表、Issue 创建、仓库首页和具体 Release。
- Issue body 仅包含 `Moebius <version> · Apple Silicon Mac`；不读取项目、对话、草稿、路径或诊断。
- 外链失败留在当前设置分类并显示本地化反馈；不关闭弹窗、不移动焦点。

### 真实运行验证

- 扩展现有 `scripts/acceptance/desktop-i18n-settings.ts`：真实 Electron 中读取版本、切换关于、验证复制、拦截并核对四类外链、注入更新检查结果、验证关闭后通知/重开恢复，以及 900×640、560×640、900×480 布局。
- 自动化不访问真实 GitHub；网络成功、失败和超时由 updater/IPC 单元测试覆盖。

## 权衡

- 选择 renderer 会话内存而非 SQLite/文件：符合“不跨重启保留更新结果”，也不会把瞬时网络状态写入事实存储。
- 选择窄 IPC 而非复用 `status:snapshot`：设置动作需要明确请求/响应、去重和安全失败分类，避免状态广播与用户动作形成双事实。
- 复制文本在主进程生成而非 renderer 任意写剪贴板：能力最小化，确保内容只含公开版本与平台。
- 继续复用通用安全外链 IPC，而不为四个链接各建 channel：main 已复验绝对 `http/https/mailto` URL；renderer 只生成受控公开地址。

## 风险

- GitHub 请求可能迟到：request id 和 timeout 后终态阻止迟到结果覆盖；AbortController 尽力取消底层请求。
- 弹窗关闭与异步终态同时发生：通知判定使用最新 open ref，结果始终先进入会话状态，通知只是附加入口。
- 多个异步操作同时完成：通知使用队列而非单槽，避免互相覆盖。
- 回滚时可移除 settings IPC/controller 并恢复旧语言-only props；PRD 与 change 保留未交付状态，不提前回流 specs。
