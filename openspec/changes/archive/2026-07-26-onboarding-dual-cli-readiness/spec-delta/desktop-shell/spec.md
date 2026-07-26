# desktop-shell 规格增量

## MODIFIED Requirements

### Requirement: 引导环境检查验证 Codex 与 Kimi 真实就绪

Source: docs/product/pages/onboarding.md#第-1-步-环境就绪至少一个-cli-可用

桌面引导 MUST 分别检查 Codex 与 Kimi 的真实版本、认证/provider 配置及至少一个真实
可用模型，且 MUST NOT 为检查发送真实推理请求、打开交互登录、修改项目文件或产生
测试会话。只有版本和能力检查都成功的 CLI 才为 ready；任一 CLI ready 时 MUST 放行，
两者都不 ready 时 MUST 阻断。

每套 CLI MUST 独立递增检查 revision；首次检查、shell PATH 自动复检、安装成功复检
和手动复检只允许同一 CLI 最后发起的完整结果替换该行。结果 DTO MUST NOT 包含原始
stderr、异常文本、本地路径、PID、provider 密钥、token 或 session id。

#### Scenario: Kimi-only 放行

- **GIVEN** Codex 缺失且 Kimi 的版本与模型能力检查成功
- **WHEN** 双 CLI 检查收敛
- **THEN** Kimi 行展示当次真实版本和 ready
- **AND** 第 1 步允许继续
- **AND** Codex 行保留独立安装入口。

#### Scenario: 旧检查乱序返回

- **GIVEN** 同一 CLI 的检查 A 尚未返回且检查 B 已发起
- **WHEN** B 先返回后 A 才返回
- **THEN** renderer 只应用 B 的完整结果
- **AND** A 不改变该 CLI 的状态或版本。

#### Scenario: 检查不产生推理

- **GIVEN** 用户进入第 1 步
- **WHEN** 主进程检查两套 CLI
- **THEN** 只调用版本和 machine-readable 能力枚举
- **AND** 不发送真实对话或创建测试 session。

### Requirement: 引导安装仅执行内置受信任动作

Source: docs/product/pages/onboarding.md#第-1-步-cli-缺失与安装中

主进程 MUST 以随应用发布的 registry 执行 Codex 或 Kimi 安装。renderer MUST 只能提交
`codex | kimi` 枚举，MUST NOT 提交或影响 command、URL、args 或脚本文本。Codex
安装 MUST 参数化 spawn npm；Kimi 安装 MUST 以独立 curl 和 bash 进程通过 Node stream
连接，MUST NOT 使用 `exec`、`execSync`、`shell:true` 或 `bash -c`。

同一 CLI MUST 去重，Codex 与 Kimi MUST 可并发。任务 MUST 提供安全阶段、活动反馈、
取消、超时和幂等进程回收；成功 MUST 只自动复检对应 CLI。失败、取消和超时 MUST
保留独立重试且不得泄露底层输出。

#### Scenario: 两套安装并发

- **GIVEN** Codex 与 Kimi 都缺失
- **WHEN** 用户依次启动两套安装
- **THEN** 主进程存在两个独立任务
- **AND** 再次启动任一运行中的 CLI 不会创建重复进程。

#### Scenario: renderer 不能注入命令

- **GIVEN** 恶意 renderer 调用 onboarding install IPC
- **WHEN** 请求包含非白名单值或额外 command、URL、args
- **THEN** 主进程拒绝请求
- **AND** 不启动任何子进程。

#### Scenario: Kimi 安装管道

- **GIVEN** 用户启动 Kimi 安装
- **WHEN** 主进程创建安装任务
- **THEN** curl 与 bash 分别以参数数组和 `shell:false` 启动
- **AND** 下载输出只通过 Node stream 输入 bash stdin。

### Requirement: 引导后台安装受退出协调

Source: docs/product/pages/onboarding.md#操作与反馈

安装 MUST 在用户离开第 1 步后继续，并通过全局安全 snapshot 提供单项或双项聚合状态。
应用关闭且仍有运行任务时 MUST 阻止本次退出，允许用户留在应用或取消全部并退出。
取消退出 MUST 等待所有子进程回收，MUST NOT 遗留孤儿安装进程。

#### Scenario: 安装中离开第 1 步

- **GIVEN** Kimi 安装运行且 Codex 已 ready
- **WHEN** 用户进入第 2 步
- **THEN** Kimi 安装继续
- **AND** 标题栏展示 Kimi 活动状态
- **AND** 页面不得把 Kimi 显示为安装成功。

#### Scenario: 取消安装并退出

- **GIVEN** 两套安装都在运行
- **WHEN** 用户关闭应用并选择取消安装后退出
- **THEN** 主进程取消并回收两套任务后退出
- **AND** 不遗留安装子进程。

### Requirement: AI 建队使用并冻结当前可用 CLI

Source: docs/product/pages/onboarding.md#第-2-步-ai-建队子流程

AI 建队首次启动 MUST 在当前 ready CLI 中选择 Codex，若 Codex 不 ready 且 Kimi ready
则选择 Kimi。两者都不 ready 时 MUST 拒绝启动。选定 CLI、execution profile、隔离
cwd 与 provider session MUST 在草稿生命周期内冻结；submit、adjust、retry 与恢复
MUST 继续使用同一 CLI，失败 MUST NOT 静默切换另一 CLI。

#### Scenario: Kimi-only AI 建队

- **GIVEN** 只有 Kimi ready
- **WHEN** 用户打开 AI 建队
- **THEN** 草稿冻结 Kimi profile 并显示使用 Kimi
- **AND** 后续轮次继续使用 Kimi。

#### Scenario: Codex 优先

- **GIVEN** Codex 与 Kimi 都 ready
- **WHEN** 用户首次打开 AI 建队
- **THEN** 草稿冻结 Codex profile。

#### Scenario: 失败不跨 CLI

- **GIVEN** 草稿已冻结 Kimi 且 Codex 也可用
- **WHEN** Kimi turn 失败
- **THEN** 对话和最后有效提案保持可恢复
- **AND** 系统不自动改用 Codex。
