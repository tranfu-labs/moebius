# 设计：require-codex-cli-0-145

## 方案

在根运行时新增无 IO 的 Codex 版本契约模块，统一导出最低版本和严格的
三段版本解析 / 比较函数。desktop 能力探针在取得真实 `codex --version`
文本后先执行兼容判定；旧版本直接产生稳定的
`CLI_VERSION_UNSUPPORTED` failure code，不启动 app-server 或模型能力枚举。

首次引导把该 failure code 映射为现有 `unavailable` 状态下更具体的
`version-unsupported` code，并把真实版本与稳定 code 传给 renderer。
renderer 对该 code 显示“需要 0.145.0 或更高版本”的升级文案。桌面 doctor
使用同一版本契约，旧版本返回 error 和安全提示。

Codex 公共执行参数只保留 `-c agents.enabled=false` 作为内部 Agent
工具的权威禁用开关，同时删除 `--disable multi_agent`。full、resume、
本地对话、GitHub runner 与 AI 建队继续共享同一参数构建器。

## 权衡

- 不兼容 Codex `0.144.x`：该版本没有可靠的内部 Agent 禁用配置，继续兼容
  会破坏 Moebius 的外层交接模型。
- 不用 prompt 约束内部 Agent：prompt 不是工具级硬门，不能作为运行时隔离。
- 不引入 semver 依赖：Codex CLI 输出只需要提取并比较 `major.minor.patch`；
  同最低版本号的 prerelease 按低于稳定版处理，更高版本的 prerelease
  仍按数字版本比较。
- 不在每个对话 run 前重复执行版本命令：首次引导、AI 建队探针和显式
  doctor 负责环境检测；实际旧 CLI 仍会被不支持的权威配置 fail closed。

## 风险

- 非标准版本输出会被判为不兼容；界面保留真实版本文本并提供重新检查。
- 用户在 readiness 之后替换为旧 CLI 时，后续 run 会配置解析失败；回滚方式
  是恢复受支持 CLI，而不是移除内部 Agent 隔离。
- 若 Codex 后续再次改变配置契约，需要同步提高最低版本并更新本模块测试。
