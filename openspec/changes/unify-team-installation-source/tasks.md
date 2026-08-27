# 任务：unify-team-installation-source

## 模块 1：来源记录与团队发现

- [x] 增加 `InstallationSource` 类型与 record 编解码，兼容旧 `upstream`。
- [x] 让普通团队列表返回来源元数据；旧 `.system` 官方团队以 `moebius` 兼容展示。
- [x] 新增来源解析、旧记录和团队发现测试。

## 模块 2：统一安装与 seed

- [x] GitHub 安装改为普通用户团队目录、来源 record 和显式执行绑定。
- [x] 内置 seed 改为普通用户团队安装；不写 official state，旧 system seed 不覆盖。
- [x] 覆盖安装事务、重复安装、冲突和失败回滚测试。

## 模块 3：启动与运行兼容

- [x] 移除启动 baseline migration/auto-sync 调用及 wiring。
- [x] 新 user 团队运行绑定只消费显式绑定；旧 system 团队保留兼容 fallback。
- [x] 覆盖启动无 ENOENT、旧团队会话、修订/文件路径和默认 profile 测试。

## 模块 4：IPC 与 UI

- [x] 删除团队与 GitHub 的 detach/check/sync/revert 契约、handler、hook 和调用。
- [x] 删除同步 banner、失联、最近同步、撤销确认和更新分组 UI，保留来源展示。
- [x] 更新 console-ui、desktop renderer、i18n、Story 和行为测试。

## 模块 5：验收与事实源

- [x] 更新 GitHub Electron 验收为搜索→预览→安装→打开→重启后仍可用，不执行更新动作。
- [x] 更新产品 PRD、OpenSpec spec delta、相关文档、边界矩阵与差异清单。
- [x] 执行定向测试、typecheck、build、边界检查、全量回归和真实 Electron 验收。
