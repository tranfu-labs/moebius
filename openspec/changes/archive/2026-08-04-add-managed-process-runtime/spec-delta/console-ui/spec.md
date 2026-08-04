# console-ui 规格增量：主会话托管运行项

## 新增：主会话顶栏按当前会话展示运行项入口

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

主会话应用顶栏 MUST 在当前 session 存在 managed-process DTO 时显示运行项入口，并置于分析面板开关与右侧栏开关之前。只有一个 active 条目时 MUST 显示可读 label 与状态；多个 active 条目时 MUST 显示数量。没有任何 active 或本次应用生命周期内尚未确认的 exited 条目时 MUST 不渲染空占位。最后一个 active 退出后入口 MUST 保持可达并显示单项 `label · 已退出` 或多项 `N 个已结束`，直到用户明确确认清除；active 数量 MUST NOT 把 exited 计入。

入口与面板 MUST 只消费宿主提供的 serializable DTO、loading/error/log state 和 callbacks；console-ui MUST NOT 调用 HTTP、Electron IPC、Provider、child process 或 local-console runtime，也 MUST NOT 从 Agent 正文、elapsed 或 URL 文本推导运行项状态。

managed-process active count MUST 与 Agent `runningCount` 分离。它 MAY 禁用普通归档并触发项目移除确认，但 MUST NOT 点亮侧边栏“正在运行”状态点、使结果卡冒充 Agent run，或让 ChangeTab 进入 Agent 工作中状态。

### Scenario: 单项与多项入口

- **GIVEN** 当前 session 先有一个 ready 运行项，随后增加第二个 running 运行项
- **WHEN** OperatorConsole 重渲染
- **THEN** 单项时入口显示 label 与“已就绪”状态
- **AND** 多项时显示“2 个运行项”
- **AND** 分析面板和右侧栏开关仍是独立可聚焦控件。

### Scenario: 切换会话不显示旧条目

- **GIVEN** 会话 A 有运行项且会话 B 没有
- **WHEN** 宿主切换到 B 并进入 loading
- **THEN** UI 不继续显示 A 的 label、endpoint 或日志
- **AND** 不用 A 的旧数据填充 B 的面板
- **AND** B 确认无条目后入口不占位。

### Scenario: 只有托管运行项时不冒充 Agent run

- **GIVEN** Agent run 已结束且当前会话只剩一个 ready managed process
- **WHEN** 用户观察侧边栏、结果卡、ChangeTab 与归档菜单
- **THEN** 侧边栏不显示“正在运行”状态点，结果卡和 ChangeTab 不进入 Agent 工作态
- **AND** 普通归档仍然禁用，运行项顶栏入口继续可见。

### Scenario: 窄窗口仍可操作

- **GIVEN** 顶栏宽度不足以显示完整 label
- **WHEN** 运行项入口收敛
- **THEN** 可见内容 MAY 只保留图标或数量
- **AND** aria-label 仍包含当前 active 数量和状态
- **AND** 键盘仍能打开面板、逐项操作并把焦点返回入口。

### Scenario: 最后一个运行项退出后确认清理

- **GIVEN** 当前 session 的最后一个 active 条目自行退出，且没有其他 active 或 stopping 条目
- **WHEN** 顶栏收到 exited summary
- **THEN** 入口不瞬间消失，而显示该条目“已退出”或退出条目数量
- **AND** 用户能打开面板查看退出事实与有限日志
- **WHEN** 用户激活“清除已退出”且宿主确认成功
- **THEN** exited 条目与入口立即消失，不留下空 gap
- **AND** 焦点移动到下一个可用顶栏控件；确认失败时入口、面板和日志保持并原位显示可重试原因。

## 新增：运行项面板区分生命周期、地址、日志与停止

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

面板 MUST 按创建顺序稳定展示 label、kind、starting/running/ready/unhealthy/stopping/exited 状态、可选 endpoint、日志状态和安全 exit code/signal。spawn 存活与 readiness ready MUST 使用不同可读状态，不得只靠颜色区分。没有 endpoint 的 service/task/watcher MUST 保留 logs 与 stop；只有服务端 DTO 提供已校验 loopback endpoint 时才显示 open。

每项 open、view logs 与 stop MUST 有包含 label 的独立可访问名称。stop 进行中 MUST 禁止重复激活，并保留其他条目操作。日志 MUST 使用可选择等宽文本、转义控制字符并显示 truncated/dropped 事实；loading、failed 与 empty MUST 彼此可区分，失败后可重试且不隐藏条目状态。

面板存在 exited 条目时 MUST 提供明确的“清除已退出”动作。该动作只提交宿主 intent；宿主 MUST 只清除当前 session 已 settled 的 exited 内存记录，不影响 active/stopping 条目、会话 JSONL 或进程。确认 pending 时防止重复提交；失败时保留全部退出事实并允许重试。

### Scenario: readiness 与健康异常可辨认

- **GIVEN** 同一条目依次收到 starting、ready、unhealthy DTO
- **WHEN** 面板更新
- **THEN** 用户分别读到“启动中”“已就绪”“健康异常”
- **AND** processId 对应的条目不重复或换位
- **AND** unhealthy 时 logs 与 stop 保持可用。

### Scenario: 无 URL 的 watcher 可管理

- **GIVEN** watcher 状态 running 且 endpoint=null
- **WHEN** 用户展开该条目
- **THEN** 不显示 open 动作
- **AND** 显示 view logs 与 stop
- **AND** 可访问名称不声称它是网页服务。

### Scenario: 日志截断与失败恢复

- **GIVEN** 日志 DTO 表示 truncated 且下一次增量读取失败
- **WHEN** 面板展示日志
- **THEN** 保留已经读取的安全尾部和“前文已截断”说明
- **AND** 原位显示读取失败与重试
- **AND** 不清空条目、endpoint 或 stop 操作。

### Scenario: 停止只提交一次

- **GIVEN** 用户激活某条目的 stop，宿主随后以新 callback identity 重渲染
- **WHEN** 用户重复点击或按键且旧 promise 尚未完成
- **THEN** 组件只提交一次该 session/process 的 stop intent
- **AND** 目标显示 stopping
- **AND** 其他条目不被禁用或改成 stopping。

## 新增：异步运行项状态对父级重渲染与迟到响应安全

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

宿主 MUST 以 session-scoped request revision 管理 summary、detail、logs 与 stop。切换 session、父级重渲染、callback identity 变化、慢返回、失败或旧请求迟到 MUST NOT 将旧 session 条目提交给当前 UI、重复 stop、覆盖较新的状态或丢失已读取日志。面板关闭 MAY 降低轮询频率，但 active 状态变化 MUST 继续在顶栏收敛；exited 后 MUST 停止无意义的高频日志轮询。

### Scenario: 旧 session 慢响应被丢弃

- **GIVEN** 会话 A 的 list 请求未返回
- **WHEN** 用户切换到会话 B，B 请求先返回，随后 A 才返回
- **THEN** 当前入口与面板只显示 B 的条目
- **AND** A 响应不覆盖 B 或产生闪现。

### Scenario: 面板关闭仍更新退出状态

- **GIVEN** active 条目存在且面板已关闭
- **WHEN** 目标进程自行退出
- **THEN** 顶栏在下一次 summary refresh 后不再把它计入 active 数量
- **AND** 重新打开面板仍能查看 exited 事实与有限日志
- **AND** settled 后日志不继续高频轮询。
