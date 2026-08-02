# 0003. SQLite driver 与 Worker 生命周期

## 状态
proposed

## 背景
项目从 T2/T3 开始使用 SQLite 保存本地会话时间线、session、role thread、agent context、GitHub intake 与 goal ledger。相关设计见
[`local-console-t3-sqlite-persistence`](../../openspec/changes/local-console-t3-sqlite-persistence/design.md)。当前实现使用 Node 内置的
`node:sqlite`，并通过 `DatabaseSync` 执行同步数据库操作。

同步 SQLite 不能直接运行在 runner、local console 或 observer 的主事件循环中：数据库锁、慢查询或底层永久挂起会阻止主线程 timeout
触发，并可能长期占用 session / issue 推进锁。因此现有状态层把每次 `runSqliteStateCommand()` 调用放入一个新 Worker：Worker 打开数据库、
检查 schema、执行一条状态命令、关闭连接后退出；主线程超时后可以终止该 Worker。

这个实现满足了有界失败要求，但也带来以下问题：

- 每条状态命令都会承担 Worker 启动、TypeScript loader、SQLite 连接建立和 schema 检查成本。
- 每个 Worker 首次加载 `node:sqlite` 都会重复打印 `ExperimentalWarning`，使正常启动看起来像持续报错。
- 临时通过进程级 `NODE_OPTIONS=--disable-warning=ExperimentalWarning` 可以隐藏日志，但会同时屏蔽进程内其他同类实验警告，且没有解决重复创建 Worker 的开销。

讨论过用 `better-sqlite3` 替换 `node:sqlite`。它提供成熟的同步 API，不会产生 `node:sqlite` 的实验警告，现有 SQLite 文件与大部分
`exec` / `prepare` / `run` / `get` / `all` 调用也可继续使用。但它是原生 Node addon，会给本项目的双运行时与发布链路增加约束：

- 终端模式使用系统 Node，桌面模式使用 Electron 内嵌 Node，两者可能需要不同 ABI 的二进制构建产物。
- Electron 开发态需要针对 Electron 版本 rebuild；esbuild 必须把原生模块标记为 external。
- electron-builder 必须把 production dependency 带入安装包，并正确 rebuild、按平台/架构打包及从 ASAR 解出 `.node` 文件。
- 正式桌面交付只覆盖 macOS arm64，但该架构仍需验证对应 prebuild 或本地编译工具链；升级 Electron 时也要重新验证兼容性。

`better-sqlite3` 同样是同步 API。仅替换 driver 并不会自动解决 Worker 生命周期问题；如果移除 Worker，反而会破坏当前数据库操作有界失败的保证。

## 决策
当前不为了消除 `ExperimentalWarning` 单独迁移到 `better-sqlite3`，继续使用 Node/Electron 自带的 `node:sqlite`，保持零第三方原生数据库依赖和
现有 macOS arm64 打包路径。

在持久 Worker 改造落地前，根 `package.json` 的 `start` 与 `desktop` 开发入口通过 `cross-env` 设置
`NODE_OPTIONS=--disable-warning=ExperimentalWarning`，作为减少终端与桌面开发态重复 SQLite 实验警告的临时运维例外。该设置覆盖入口进程及其 Node
子进程，因此也会隐藏非 SQLite 模块产生的同类实验警告；这是已接受的过渡期可观测性损失，不扩展到其他 warning 类型。

状态层后续应从“每条命令一个 Worker”演进为“每个运行时、每个 SQLite 文件一个持久 Worker”：

1. 主线程通过 request / response 协议把状态命令发送到持久 Worker。
2. Worker 持有并复用 SQLite connection，按队列串行执行命令和事务。
3. 主线程继续为每条命令维护 timeout；命令超时、Worker 崩溃或无响应时终止整个 Worker。
4. 失败后的下一条操作按需创建新 Worker、重新打开数据库并执行幂等 schema migration。
5. Worker 重建期间不得伪造成功，不得永久占用 local session、active run 或状态读取。

持久 Worker 改造落地时，应把警告屏蔽收窄到 SQLite Worker 边界，并移除根启动脚本的全局 `NODE_OPTIONS`。不得把上述临时例外当成持久 Worker
改造的替代品，也不得因此屏蔽其他类型的运行时 warning。

若未来出现以下任一条件，可以用新的 ADR 重新评估 `better-sqlite3`：

- `node:sqlite` 的稳定性、API 或性能无法满足已测量的产品需求。
- 需要 `better-sqlite3` 独有的扩展或能力。
- Electron 与系统 Node 的原生模块 rebuild、ASAR、macOS arm64 CI 已有稳定且持续验证的交付链路。

## 后果
正面后果：

- 保留当前标准 SQLite 数据文件、schema、迁移逻辑和事务语义。
- 不增加原生 addon、Node/Electron ABI、node-gyp 或额外 macOS arm64 打包维护成本。
- 持久 Worker 能消除正常路径上重复创建 Worker、连接和 schema 检查的大部分开销。
- 保留同步 SQLite 卡死时通过终止 Worker 实现硬超时的能力。
- SQLite 实验警告可被限制在实现边界内处理，不再污染正常启动日志。

负面后果：

- 持久 Worker 需要新的命令队列、请求关联、生命周期、崩溃恢复和并发调用测试。
- Worker 被终止时，所有尚未完成的排队命令都必须收到明确失败，调用方需要按既有规则重试或进入可见失败路径。
- 在该改造落地前，当前实现仍会为每条状态命令创建 Worker；本 ADR 不把拟议结构描述为现状。
- 项目暂时继续依赖仍带实验标记的 Node API，需要固定并验证支持 `node:sqlite` 的 Node/Electron 最低版本。
- 过渡期根启动脚本会屏蔽进程树内全部 `ExperimentalWarning`，可能降低发现非 SQLite 实验 API 使用的可见性。
