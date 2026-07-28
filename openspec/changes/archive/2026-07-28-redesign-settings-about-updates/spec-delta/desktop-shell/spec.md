# desktop-shell spec delta：redesign-settings-about-updates

## Requirement: 设置只通过窄 IPC 读取应用信息并复制版本

Source: docs/product/pages/settings.md#关于
Source: docs/product/pages/settings.md#复制版本与公开链接

preload MUST 只暴露读取应用元数据、检查更新和复制固定版本信息的 settings 能力。应用元数据 MUST 只含当前版本与 `Apple Silicon Mac`。复制 MUST 由主进程生成 `Moebius <version> · Apple Silicon Mac` 并写入剪贴板；renderer MUST NOT 提交任意剪贴板文本。失败 DTO MUST 使用稳定 reason，MUST NOT 含路径、环境、原始异常或 Release 响应正文。辅助状态页 MUST NOT 保留已经迁入设置的旧检查更新入口或旧通用检查 IPC。

### Scenario: 复制版本信息

- GIVEN 当前应用版本为 `0.1.4`
- WHEN renderer 调用复制版本能力
- THEN 系统剪贴板收到 `Moebius 0.1.4 · Apple Silicon Mac`
- AND renderer 没有向主进程提交待复制字符串

## Requirement: 手动更新检查在 15 秒内原地收敛

Source: docs/product/pages/settings.md#检查更新

主进程 MUST 只比较当前版本与 GitHub 最新正式桌面 Release，并在 15 秒内返回 latest、available 或 failed。检查本身 MUST NOT 打开浏览器、下载、安装、调用自动更新器或要求重启。HTTP 失败、响应非法、网络异常和超时 MUST 返回 failed，MUST NOT 伪装为 latest。available MUST 返回最新版本与本仓库对应的 HTTPS Release URL。

### Scenario: 检查到新版但不离开应用

- GIVEN 当前版本为 `0.1.4` 且最新正式版本为 `0.1.5`
- WHEN renderer 调用检查更新
- THEN IPC 返回 available、`0.1.5` 与正式 Release URL
- AND `shell.openExternal`、下载和安装均未调用

### Scenario: 请求超过时间上限

- GIVEN GitHub 请求在 15 秒内没有返回
- WHEN 更新检查达到上限
- THEN IPC 返回 failed 且 reason 为 timeout
- AND 同一 renderer 会话可再次发起检查

## Requirement: 设置公开链接继续经过安全系统浏览器边界

Source: docs/product/pages/settings.md#复制版本与公开链接

下载新版、发布记录、反馈问题和开源仓库 MUST 只在用户显式激活后通过既有外链 IPC 交给系统浏览器。主进程 MUST 复验绝对 URL 协议。反馈 Issue 预填 MUST 只含当前产品名、版本和 Apple Silicon Mac，MUST NOT 包含项目、对话、草稿、路径或诊断。

### Scenario: 用户显式下载新版

- GIVEN 更新检查返回 available
- WHEN 用户激活“下载新版本”
- THEN 对应 Release URL 通过安全外链 IPC 打开一次
- AND Moebius 设置弹窗和当前工作区保持原位
