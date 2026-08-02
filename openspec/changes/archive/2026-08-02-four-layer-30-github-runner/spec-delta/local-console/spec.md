# local-console spec delta：four-layer-30-github-runner

## MODIFIED Requirements

### Requirement: Local default startup
Source: docs/product/prd.md#产品运行形态

`pnpm start` MUST 启动 local console，并 MUST NOT 要求 GitHub authentication、repository whitelist 或
GitHub runtime state。终端入口 MUST 拒绝任何非空未知参数；系统 MUST NOT 保留可切换到另一运行形态
的隐藏 flag。

#### Scenario: 干净环境启动唯一运行形态

- **GIVEN** 没有 GitHub auth、repository config 或历史 GitHub state
- **WHEN** 用户运行 `pnpm start`
- **THEN** local console server 成功启动
- **AND** 没有 GitHub issue adapter 或后台 child process 被调用

#### Scenario: 旧 GitHub flag fail closed

- **GIVEN** 用户运行 `pnpm start -- --github-mode`
- **WHEN** 参数被解析
- **THEN** 进程在 local server 启动前报告未知参数并退出
- **AND** 不读取或写入 local/GitHub runtime state

## REMOVED Requirements

### Requirement: Local and GitHub runtime isolation
Source: docs/product/prd.md#产品运行形态

移除 local/GitHub 双运行形态与双 runtime state channel 的产品承诺。历史 GitHub state MAY 留在磁盘，
但 local runtime MUST NOT 读取、迁移、镜像或写入它。

### Requirement: Operational startup documentation
Source: docs/product/prd.md#产品运行形态

移除 `--github-mode`、`pnpm start -- --github-mode`、GitHub runner 运维和双模式选择文档；运维文档只
保留 `pnpm start` 的 local 入口。

### Requirement: 辅助只读 observer 入口
Source: docs/product/prd.md#产品运行形态

移除 `pnpm observer`、GitHub state 聚合页面及其只读 HTTP 入口。local console 的主页面、状态 API 与
调试过程读取不受影响。
