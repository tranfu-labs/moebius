# desktop-shell 规格增量

## MODIFIED Requirements

### Requirement: 已完成用户可非破坏性回看引导

Source: docs/product/pages/onboarding.md#重新查看引导

桌面 renderer MUST 允许 marker 已完成的用户从主页面进入完整 onboarding 回看。回看 MUST 作为非持久化展示态保持进入前的操作台挂载；退出或在第 4 步点击“开始使用”后 MUST 恢复进入前的项目、对话、草稿和应用页面状态。

进入、退出和结束回看 MUST NOT 删除、覆盖或重写 `.onboarding-completed`，MUST NOT 调用首启完成 IPC，MUST NOT 生成 `pendingAgentTeamKey`，并 MUST NOT 更新上一次成功创建会话所用团队。应用在回看中关闭后，下次启动 MUST 继续按有效 marker 进入主页面。

#### Scenario: 退出回看

- **GIVEN** 有效 completion marker 已命中且用户从一个带未提交草稿的主页面进入回看
- **WHEN** 用户点击“退出”
- **THEN** 原操作台重新可见且草稿、当前项目、当前对话和应用页面保持不变
- **AND** completion marker 内容未改变。

#### Scenario: 从第 4 步结束回看

- **GIVEN** 用户在回看第 2 步临时选择了不同团队
- **WHEN** 用户在第 4 步点击“开始使用”
- **THEN** renderer 返回进入前的操作台
- **AND** 不调用 `onboarding:complete`
- **AND** 不把临时团队选择交给新建对话或 last-used team。

#### Scenario: 回看中关闭应用

- **GIVEN** 有效 completion marker 已命中且用户正在回看第 2 步
- **WHEN** 应用关闭并重新启动
- **THEN** renderer 按原有效 marker 进入主页面
- **AND** 不恢复或强制继续回看。

### Requirement: Codex 未就绪时第 1 步硬门禁

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#3`

第 1 步 MUST 在 Codex 缺失或不可运行时保留全局 footer 中的“重新检查”和 disabled “继续”。Codex 缺失时 MUST 展示固定安装命令 `brew install codex` 及复制操作；Codex 已安装但不可运行时 MUST 只展示“请在终端运行 codex，完成登录或按终端提示修复后，再回来重新检查。”，MUST NOT 展示安装命令、复制操作、底层路径或原始错误。只有一次新的检查返回可运行状态后才能放行。

#### Scenario: 修复缺失的 Codex

- **GIVEN** 第一次 Codex 检查返回缺失
- **WHEN** 用户尚未完成一次成功的重新检查
- **THEN** 页面展示 `brew install codex` 与复制操作
- **AND** footer 的“继续”保持禁用且“重新检查”可用
- **WHEN** 用户安装后点击“重新检查”且检查成功
- **THEN** “继续”变为可用。

#### Scenario: 修复不可运行的 Codex

- **GIVEN** 第一次 Codex 检查确认 CLI 已存在但当前不可运行
- **WHEN** 第 1 步展示错误恢复
- **THEN** 页面展示固定登录 / 排障提示和“重新检查”
- **AND** 页面不展示 `brew install codex`、复制操作、底层路径或原始错误
- **AND** footer 的“继续”保持禁用
- **WHEN** 用户修复后点击“重新检查”且检查成功
- **THEN** “继续”变为可用。

### Requirement: 引导环境检查只检查 Codex

Source: docs/product/pages/onboarding.md#指标与验收
Acceptance ID: `onboarding#4`

引导环境门禁与桌面环境诊断 MUST 只执行 `codex --version` 检查。检查成功时，正式 Electron 引导页 MUST 通过既有 `detail` 链路展示当次检查返回的真实版本文本，MUST NOT 使用硬编码版本、占位版本或上一次检查缓存的版本。首次检查、shell PATH 就绪后的既有自动复检或错误态手动重新检查成功后，renderer MUST 用最后发起的检查结果整体替换旧版本；并发检查乱序返回时，较早发起的结果 MUST NOT 覆盖较晚发起的结果。成功态 MUST NOT 为刷新版本新增“重新检查”。`env-doctor` MUST 仅将 `ENOENT` / `ENOTDIR` 分类为缺失，并将非零退出、`EACCES`、其他启动异常及退出码为 0 但无非空版本文本分类为不可运行。错误结果 MUST NOT 经状态快照或 onboarding IPC 向 renderer 传递原始 stderr、异常文本或本地路径。`env-doctor`、状态快照和辅助状态页 MUST NOT 检查或展示 gh CLI、gh 登录态、Claude 或 Node 环境；本需求 MUST NOT 增加登录态、provider、模型调用探针、IPC channel 或 DTO 字段。

#### Scenario: 首次成功检查展示真实版本

- **GIVEN** `codex --version` 成功返回版本文本 A
- **WHEN** 结果通过既有 onboarding IPC 到达 renderer
- **THEN** 第 1 步通过态展示版本文本 A
- **AND** 页面不以固定示例版本替换 A。

#### Scenario: shell PATH 就绪后的自动复检刷新版本

- **GIVEN** 第 1 步首次检查成功并展示版本文本 A
- **WHEN** shell PATH 就绪状态到达 renderer 并触发既有自动二次检查，且检查成功返回不同的版本文本 B
- **THEN** 第 1 步展示版本文本 B
- **AND** 页面不再展示版本文本 A
- **AND** 成功态不显示“重新检查”。

#### Scenario: 并发复检只接受最后发起的结果

- **GIVEN** 首次检查 A 尚未返回，shell PATH 就绪又触发自动复检 B
- **WHEN** B 先成功返回新版文本，A 随后才返回旧版文本
- **THEN** 第 1 步只展示 B 的新版文本
- **AND** A 的晚到结果不改变页面环境状态。

#### Scenario: 操作系统明确报告 Codex 缺失

- **GIVEN** 启动 `codex --version` 时操作系统返回 `ENOENT` 或 `ENOTDIR`
- **WHEN** 检查结果到达 renderer
- **THEN** 第 1 步展示缺失态及安装恢复
- **AND** 结果不包含原始异常文本或本地路径。

#### Scenario: Codex 存在但检查不可用

- **GIVEN** `codex --version` 非零退出、返回 `EACCES` / 其他启动异常，或成功退出但没有非空版本文本
- **WHEN** 检查结果到达 renderer
- **THEN** 第 1 步展示不可运行态而不是安装恢复
- **AND** 结果不包含原始 stderr、异常文本或本地路径。

#### Scenario: 不扩展可运行性探针

- **GIVEN** 用户进入引导第 1 步或触发重新检查
- **WHEN** 主进程执行环境检查
- **THEN** 唯一被探测的命令是 `codex --version`
- **AND** 登录态、自定义 provider 和模型请求不属于本次检查。
