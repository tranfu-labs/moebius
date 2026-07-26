# 设计：onboarding-dual-cli-readiness

## 方案

### 1. 纯契约与状态模型

在 `desktop/src/onboarding/contract.ts` 定义只含白名单字段的双 CLI DTO：

- CLI 枚举固定为 `codex | kimi`。
- readiness 行只公开 `checking | ready | missing | needs-login | unavailable`、
  当次真实版本和安全提示码。
- install 行只公开 `idle | running | succeeded | failed | cancelled | timed-out`、
  受控阶段枚举与 revision。
- renderer 的 mutating 请求只接受 CLI 枚举；页面展示的命令文本永不回传。

console-ui 使用同构的双行视图状态和纯函数判定 `canContinue`、运行安装聚合、团队 CLI
缺口与建队 CLI 选择。跨文件可测规则集中在纯模块，React 只负责渲染与事件派发。

### 2. 双 CLI readiness

主进程 onboarding service 对单套 CLI 先取得版本，再调用既有
`probeExecutionCapabilities` 的 machine-readable 能力面。为避免重复版本调用，允许
能力探针接收已取得的版本结果或拆分成可组合探针，但最终仍保持单行内部“版本 →
能力”顺序。

结果分类：

- 操作系统 `ENOENT` / `ENOTDIR`：`missing`。
- 版本命令不可执行、非零、空版本：`unavailable`。
- 版本成功但能力协议明确表明未认证 / provider 未配置：`needs-login`。
- 能力协议超时、异常或无真实模型：`unavailable`。
- 版本成功且至少一个真实模型可枚举：`ready`。

每套 CLI 的首次检查、shell PATH 后自动复检、安装成功自动复检和手动复检各自递增
revision。renderer 只应用同一 CLI 的最新 revision；两套 CLI 可并行，不互相覆盖。
检查不会发起真实推理、打开交互登录或修改项目。

### 3. 受信任安装任务

新增 main-only `OnboardingCliInstallManager`：

- registry 固定 Codex 为 `npm` + `["install", "-g", "@openai/codex"]`。
- registry 固定 Kimi 为 `curl` + `["-LsSf", "https://code.kimi.com/install.sh"]`
  和 `bash` + `["-s", "--"]` 两个 `shell:false` 子进程；Node stream 把 curl stdout
  接到 bash stdin，禁止 `bash -c`。
- 每套 CLI 至多一个运行任务；Codex 与 Kimi 可并发。
- 任务有单调 revision、阶段枚举、活动心跳、超时和幂等取消；完成后清理 timer、
  listeners 和全部子进程。
- main 通过窄 subscription channel 发布安全 snapshot；preload 把订阅包装成解除
  监听函数。
- 成功仅触发对应 CLI 完整复检；失败、取消和超时不改变另一行状态。
- 关闭应用且仍有任务时阻止本次退出并显示受控选择；“留在应用”不改任务，
  “取消并退出”取消全部并等待回收后退出。

测试使用注入式 process adapter 与 fake clock，不执行真实安装器。

### 4. renderer 与页面

`OnboardingRoute` 维护 `{ codex, kimi }` 两个独立 readiness revision，并订阅 install
snapshot。全局“重新检查”始终可见并同时发起两套检查。任一行 ready 即放行；已经
ready 的行在新检查时显示该行 checking，旧值不冒充当次结果。

`OnboardingShell` 采用已确认原型的双行卡片：

- 缺失行展示随应用发布的官方命令和“安装 … CLI”播放按钮。
- 安装中立即禁用重复动作，显示阶段活动、取消入口和 `aria-live` 更新。
- 需登录与不可验证不展示安装入口，只展示对应终端修复指引。
- 标题栏只在后台安装存在时显示单项或双项聚合，详情可聚焦、可键盘操作。
- footer 始终保留重新检查；另一 CLI ready 时安装不阻断继续。

团队卡、完成页与进入新建对话的兼容提示由同一纯函数根据成员 effective CLI 计算。
全兼容显示准备就绪；部分兼容使用中性图标、受影响人数和修复去向，不显示成功大勾。

### 5. AI 建队 CLI 冻结

AI 建队 start 请求在服务端读取 readiness snapshot，选择 Codex 优先、否则 Kimi。
草稿首次启动时持久化或内存冻结 builder CLI、profile、隔离 cwd 与 provider session
标识；后续 submit/adjust/retry 只复用该引擎。不可恢复失败保留对话与最后有效提案，
不自动切换另一套 CLI。

Codex 继续使用 app-server/exec 的只读隔离；Kimi adapter 使用 Kimi 官方非交互、
只读能力面。两者输出统一进入既有白名单消息/提案 parser，非法结构最多自动修复
一次。若当前 Kimi CLI 没有可满足只读与结构化输出的非交互入口，必须安全失败并
保留草稿，不得用 shell 文本或切回 Codex 冒充 Kimi 成功。

## 测试设计

### 单元与组件测试

- 双 CLI `canContinue` 全组合：Codex-only、Kimi-only、双 ready、双不 ready。
- readiness 分类、无真实模型、needs-login、revision take-latest 与脱敏。
- install 同 CLI 去重、双 CLI 并发、阶段、心跳、成功、失败、取消、超时和回收。
- Kimi 管道必须是两个参数化 spawn，renderer 输入不能影响 command/args。
- 安装成功只复检对应 CLI，旧检查/安装事件不覆盖新 revision。
- 标题栏聚合 0/1/2 任务；`aria-live`、键盘和 reduced-motion 状态。
- 团队兼容人数、全兼容/部分兼容结果和修复后自动消失。
- builder CLI 选择、草稿冻结、同引擎恢复、失败不跨 CLI 降级和一次结构修复。

### AI 验证流程

- Electron fixture 覆盖缺失、需登录、不可验证、Codex-only、Kimi-only、双 ready。
- 以 fake installer 覆盖双安装并发、离开第 1 步继续、标题栏聚合、取消与失败重试。
- 验证第 1 步 → 团队卡 → 完成页 → 新建对话的兼容提示一致。
- 先跑功能断言，再在亮暗主题、窄窗口和 reduced-motion 下做视觉/可访问性检查。
- 根测试、typecheck、console-ui Storybook build 与 desktop build 必须退出码 0。

## 权衡

- 直接复用能力探针而非只测 `--version`，会增加几秒延迟，但“可用”才能真实表示
  已认证且可运行 Agent；不发送推理请求，避免费用、测试会话和额外隐私影响。
- 安装由应用直接执行比复制命令更方便，但必须承担子进程生命周期与退出协调；
  选择 main-only registry 和枚举 IPC，换取可审计且不可注入的执行边界。
- AI 建队 Codex 优先而非用户每次选择，保持默认路径稳定；Kimi-only 不再被阻断。
  草稿冻结牺牲运行中自动容灾，避免同一对话跨引擎导致上下文和输出协议漂移。
- readiness 和 install 各自 revision 比单一全局 loading 复杂，但能严格阻止双并发、
  自动复检与用户复检之间的乱序覆盖。

## 风险

- 官方安装入口可能变化：命令只随版本发布并在发版前校准，不支持运行时远程下发。
- Kimi 非交互只读接口可能与 Codex 能力不对称：实现先做能力检查，无法满足隔离时
  安全失败并保留草稿；不得放宽 sandbox 或跨 CLI 降级。
- 应用退出与子进程信号存在平台竞态：manager 必须有幂等 cancel、最终 SIGKILL
  上限和可注入进程测试；真实验收检查没有孤儿进程。
- capability probe 的既有安全错误过于粗粒度，可能无法区分未登录与协议不可用：
  只增加安全错误码，不把原始 stderr 或 provider 数据交给 renderer。
- 改动横跨 main/preload/renderer/component：契约放在无 Node 依赖模块，业务纯规则
  与 IO adapter 分层，防止 console-ui 反向依赖 Electron。

回退时可整体移除双 CLI onboarding service/install manager 和新 IPC，恢复 Codex-only
页面；completion marker、团队定义与会话数据不迁移。产品决策已写入 PRD，若回退
产品行为必须重新采访并同步事实源，不能只回滚代码。
