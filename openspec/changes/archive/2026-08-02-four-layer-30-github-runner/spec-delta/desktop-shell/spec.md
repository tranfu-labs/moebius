# desktop-shell spec delta：four-layer-30-github-runner

## ADDED Requirements

### Requirement: Desktop 只装配本地运行形态
Source: docs/product/prd.md#产品运行形态

Desktop MUST 由 main process 持有 exactly one local console server，MUST NOT 派生 GitHub runner child、
启动 observer server 或监管这些已退役进程。关闭应用 MUST 有界关闭 local server 与仍在运行的 local
provider/SQLite worker 资源，且 MUST NOT 留下孤儿进程。

#### Scenario: Desktop 启动

- **GIVEN** 用户启动 Desktop
- **WHEN** 主窗口完成初始化
- **THEN** local console 可用且主页面能读取 local 状态
- **AND** 进程树没有 `runner-child.js` 或 observer server

### Requirement: 辅助状态面只呈现仍存在的能力
Source: docs/product/prd.md#产品运行形态

Desktop status snapshot、preload 与辅助状态页 MUST 继续呈现 local console、环境、数据根、seed、版本
和更新事实，MUST NOT 暴露 runner/observer 状态字段、打开 observer 动作或对应占位 UI。

#### Scenario: 打开辅助状态页

- **GIVEN** Desktop 的 local console 正常运行
- **WHEN** 用户打开辅助状态页
- **THEN** 页面显示 local 与环境诊断
- **AND** 页面不存在 GitHub runner、observer 或“打开观察页”动作

### Requirement: 退役运行形态不得破坏历史数据
Source: docs/product/prd.md#产品运行形态

Desktop 与终端 local 入口 MUST NOT 为退役 GitHub runner 执行 destructive migration 或自动删除历史
GitHub state。启动与退出过程中，未被 local runtime 使用的旧 GitHub state 文件/表 MUST 保持原内容。

#### Scenario: 带历史状态启动

- **GIVEN** 临时数据根包含代表性旧 GitHub state 文件或表
- **WHEN** Desktop 启动并退出
- **THEN** local console 可用
- **AND** 旧 GitHub state 的内容哈希或表行数保持不变
