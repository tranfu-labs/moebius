# github-issue-runner spec delta：four-layer-30-github-runner

本 delta 是**域退役指令**，不是在保留的域内逐条修改 Requirement。归档时删除
`openspec/specs/github-issue-runner/spec.md`，不得只删除启动 Requirement 后留下不可达的 intake、
dispatch、publication、state 或 recovery 承诺。

## REMOVED Requirements

### Requirement: GitHub mode startup flag
Source: docs/product/prd.md#产品运行形态

系统 MUST NOT 提供 `--github-mode`、GitHub issue scanning 或后台 GitHub runner 启动路径。所有依赖该
运行入口的 GitHub issue runner Requirements 随域一起退役，不再作为当前产品行为事实。

#### Scenario: 旧启动参数不能复活已退役运行时

- **GIVEN** 用户运行 `pnpm start -- --github-mode`
- **WHEN** 终端入口解析参数
- **THEN** 进程在启动 local server 或任何 GitHub adapter 前以未知参数失败
- **AND** 不读取 issue、comment、repository whitelist 或 GitHub runner state
