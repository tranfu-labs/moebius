# 设计：align-onboarding-product-surfaces

## 目标状态

| 场景 | 正式页面与原型共同表现 | 放行 / 去向 |
| --- | --- | --- |
| Codex 通过 | 正式 Electron 页面显示最近一次真实 `codex --version` 结果；原型、PRD 字符图和 Storybook 不显示具体版本号 | 可以进入第 2 步 |
| Codex 缺失 | 「未找到 Codex」+ `brew install codex` +「复制」；footer 显示「重新检查」与灰置「继续」 | 成功重新检查后才能进入第 2 步 |
| Codex 已安装但不可运行 | 「Codex 暂时无法运行」+「请在终端运行 codex，完成登录或按终端提示修复后，再回来重新检查。」；不得出现安装命令、复制操作、路径或原始错误；footer 与缺失态相同 | 成功重新检查后才能进入第 2 步 |
| 首次启动第 4 步 | CTA 为「开始使用」 | 完成首启并进入带所选团队的新建对话 |
| 回看第 4 步 | CTA 仍为「开始使用」 | 恢复进入前的操作台；不写 marker、不交接临时团队选择 |
| AI 自然语言调整等待中 | 右侧立即出现本轮用户气泡，后面显示「正在输入」 | mock 返回后移除等待态，用户正文仍只出现一次 |

## 方案

### 正式 UI

`OnboardingShell` 继续消费现有
`{ status: "error", kind: "missing" | "unavailable" }` 契约，不扩展
desktop route、preload 或 IPC。

`EnvironmentCard` 按 `kind` 分开渲染恢复内容：

- `ready` 原样显示调用方提供的最近一次检测 `detail`；未提供 `detail` 时只显示通用就绪文案，绝不在组件内补固定版本。
- `missing` 沿用安装命令与复制回调。
- `unavailable` 渲染固定安全提示，不渲染安装命令容器或复制按钮。
- 两种错误仍由 shell 的全局 footer 提供「重新检查」和 disabled
  「继续」，错误卡自身不新增动作。

第 4 步 CTA 不再按 `mode` 改名：非 saving 状态统一为「开始使用」；
saving / 返回中的进行态文案可以继续区分首启与回看。回看完成仍调用既有上层
`onComplete` 回调，由 desktop renderer 的 replay 分支关闭临时展示态；不改
marker、pending team 或 last-used team 的现有所有权。

### 桌面路由边界

生产链路继续由 `env-doctor` 执行唯一的 `codex --version`，取退出码为 0 时 stdout
的首个非空行作为既有成功 `detail`。onboarding IPC 与 preload 不增加字段或
channel，只透明传递该值；`OnboardingRoute` 每次检查成功都以当次
`result.detail` 整体替换 renderer 中的 environment 状态，禁止合并旧值或使用
renderer 占位版本。

成功态继续只显示「继续」，不新增「重新检查」。版本 A → B 的刷新证据使用生产中
已经存在的自动二次检查链路：首次检查返回 A；主进程完成 shell PATH 准备并通过
`status:snapshot` 提供非空 `shellPath` 后，route 自动再检查一次并收到 B；最终只
显示 B。若 A 与 B 并发且 B 先返回，route 以单调请求序号执行 take-latest，只允许
最后发起的 B 更新页面；A 后返回时不得覆盖 B。错误态的手动「重新检查」另行保留
失败 → 成功的硬门恢复用例。

`env-doctor` 是 `missing | unavailable` 分类的唯一所有者，但不扩展现有 IPC / DTO
形状：

- spawn 异常的 `code` 为 `ENOENT` 或 `ENOTDIR` → 返回稳定、安全的
  `Codex 未找到` 错误结果；
- 命令非零退出、`EACCES` 及其他启动异常 → 返回稳定、安全的
  `Codex 不可用` 错误结果；
- 退出码为 0 但 stdout 没有非空版本文本 → `Codex 不可用`；
- 所有错误结果都省略 `detail`，不让原始 stderr、异常消息或本地路径进入
  status snapshot、onboarding IPC 或 renderer。

`OnboardingRoute` 只对上述稳定错误结果做精确映射：`Codex 未找到` →
`missing`，`Codex 不可用` 与未知 / 抛错结果 → `unavailable`；禁止继续使用
`includes("未找到")` 之类的模糊文案判断。测试证明两类安全结果到达正确展示分支，
并证明底层错误文本没有进入 DOM。不新增登录检查、provider 检查、模型执行探针、
DTO 字段、错误透传或 IPC channel。

Storybook 没有连接主进程检测，因此 `ready` story 不传具体版本 `detail`，只展示
组件已有的通用就绪副本。测试代码可以使用显式版本 fixture 验证数据贯通，但评审
可见的 PRD、Storybook 和独立 HTML 不得固定某个数字版本。

### 独立原型

原型继续只读取 PRD 口径并维护本地 fixture，不 import 正式组件、设计令牌或
desktop 契约。

1. 环境状态增加 `unavailable` review scenario；`ready`、`missing`、
   `unavailable` 和中性的 `checking` 都由原型状态机显式建模。三种非 ready
   状态均保持硬门，`checking` 不临时复用任何一种错误卡，避免重新检查时闪出错误
   类型不匹配的恢复内容。`ready` 使用通用就绪文案，不伪造版本检测结果。
2. 增加确定性 replay fixture。`mode=replay` 从一个带固定项目、对话与未提交草稿
   的 mock 主页面进入四步回看；“退出”和第 4 步“开始使用”都回到同一 fixture。
   回看中选择另一支团队只影响第 3 步演示，不改 fixture 的团队或草稿。默认无参数
   场景仍是首次启动，并继续在第 4 步进入新建对话。
3. review controls 增加 `unavailable` 与 replay 的可达入口，但仍明确标注为评审
   控件，不混入产品表面。
4. AI 调整 turn 拆成“已提交的用户消息”“AI pending”“AI 回复”三个可观察状态。
   submit 时先持久到原型本地消息列表，再开启 timer；渲染顺序固定为用户气泡在前、
   typing 在后。mock 回复使用不重复用户正文的确认文案，返回后输入正文只保留在
   用户气泡中一次。
5. 通过既有构建 / 发布脚本生成单 HTML；不手工编辑生成物，不提交
   `prototypes/dist/`。

## 测试与验收

### 单元 / 组件用例

- `prototypes/src/onboarding-state.test.ts`
  - `missing`、`unavailable`、`checking` 都不能越过第 1 步，成功 recheck 后放行。
  - 首次启动仍从四步进入带所选团队的新建对话。
  - replay 的“退出”和末步「开始使用」都返回同一进入前 fixture；临时团队选择不
    泄漏。
- `packages/console-ui/src/onboarding/onboarding-shell.test.tsx`
  - `ready` 原样显示调用方给出的版本文本；未给版本时只显示通用就绪文案。
  - `missing` 展示安装命令与复制操作，footer 的「继续」disabled。
  - `unavailable` 展示正式排障文案和「重新检查」，但不含安装命令或复制按钮，
    footer 的「继续」同样 disabled。
  - replay 第 4 步显示「开始使用」；first-run 文案与完成回调保持不变。
- `desktop/tests/onboarding-app-routing.test.tsx`
  - 初次成功检查展示版本 fixture A；随后模拟带非空 `shellPath` 的
    `status:snapshot`，自动二次检查返回 B 后页面只显示 B，不残留 A 或占位值；
    成功态始终没有「重新检查」；同时断言检查恰好按“首次 A → shell PATH 事件 →
    自动复检 B”的次数与顺序发生。
  - 用 deferred promise 保持 A pending，触发自动复检 B 并先返回新版，再让 A
    晚返回旧版；页面仍只显示 B，证明最后发起的检查独占更新权。
  - 稳定的 `Codex 未找到` 失败精确映射到 `missing`；`Codex 不可用` 与未知 /
    抛错结果映射到 `unavailable`。
  - 错误态仍可通过「重新检查」从失败恢复成功，且底层 stderr、异常文本和本地路径
    不进入 DOM。
- `desktop/tests/env-doctor.test.ts` 与 `desktop/tests/onboarding-ipc.test.ts`
  - 生产检查只调用 `codex --version`，成功输出的版本文本通过既有 `detail` 原样
    穿过 IPC；不增加其他探测命令或契约字段。
  - 用显式设置真实 `error.code` 的 errno fixture 证明 `ENOENT` / `ENOTDIR`
    返回无 `detail` 的缺失结果；非零退出、`EACCES`、其他启动异常和空版本文本
    返回无 `detail` 的不可运行结果。
  - 使用包含本地路径和原始 stderr 的 fixture，证明 IPC 返回值与状态快照只含安全
    分类消息。

### `file://` AI 验证流程

扩展 `prototypes/scripts/verify-onboarding.mjs`，从本轮新构建产物验证：

1. 默认 first-run 完整走完四步，仍进入带所选团队的新建对话。
2. ready 原型只显示通用就绪文案，生成 HTML 不含冒充真实检测的固定数字版本。
3. `scenario=missing` 与 `scenario=unavailable` 都保留灰置「继续」和可成功恢复的
   「重新检查」；只有 missing 含安装命令 / 复制，unavailable 含正式排障文案且不
   含安装命令、复制、路径或模拟原始错误。
4. `mode=replay` 从确定性 mock 主页面进入回看：
   - 点击「退出」返回原项目、对话、草稿和团队展示态；
   - 重新进入，临时选择另一团队并走到第 4 步，点击「开始使用」仍返回完全相同的
     进入前展示态。
5. 发送 AI 调整后、mock 返回前，右侧用户气泡立即可见，typing 节点在 DOM 顺序中
   位于其后；返回后 typing 消失，输入正文的全文匹配数恰好为 1。
6. 所有新增上下文继续监听并拒绝 HTTP(S) 请求；原有宽 / 窄窗口、亮 / 暗主题、
   reduced-motion 和固定 footer 检查保持通过。

实现阶段在依赖可用后至少运行：

```text
pnpm --filter @moebius/console-ui test -- onboarding-shell.test.tsx
pnpm --filter @moebius/desktop test -- env-doctor.test.ts onboarding-ipc.test.ts onboarding-app-routing.test.tsx
pnpm --filter @moebius/prototypes check
pnpm test
pnpm typecheck
pnpm --filter @moebius/console-ui build-storybook
pnpm --filter @moebius/desktop build
```

长命令输出重定向到临时日志，只回读退出码和关键失败行；原型验收证据写入既有
`artifacts/acceptance/onboarding-prototype/`。

## 权衡

- 不共享原型与正式组件：保留双向隔离，代价是两份实现都要维护；用共同 PRD、
  spec scenario 和 file:// 门禁控制漂移。
- 不扩环境检查协议形状：当前 `codex --version` 成功结果已经通过 `detail` 到达
  renderer；本次收紧既有错误分类和脱敏语义、移除 Storybook 假版本并补自动复检
  刷新证据，不增加登录态、provider 或模型探针，也不增加 IPC channel / DTO 字段。
- 回看沿用「开始使用」而不新增专用完成文案：降低文案分叉，回看身份由标题栏
  表达；返回语义由 mode 决定，测试必须防止它误走首启完成副作用。
- replay 使用确定性 mock 主页面而不接真实应用状态：能够在单 HTML 内证明回看
  契约，同时不破坏原型沙盒边界。

## 风险与回退

- 分支渲染失误可能让 `unavailable` 再次露出安装操作：组件测试和 file:// 否定
  断言同时覆盖。
- Storybook 固定版本、renderer 状态合并或并发复检乱序返回可能再次产生假版本 /
  旧版本：静态表面否定断言、“首次版本 → shell PATH 就绪后的自动复检版本”与
  deferred take-latest 路由测试共同覆盖。
- spawn 错误分类失误可能把权限问题引向安装提示，或让原始错误进入 renderer：
  env-doctor 的错误码矩阵、IPC 精确值断言和路由 DOM 否定断言共同覆盖。
- 相同 CTA 文案承载不同去向，容易误接首启完成回调：desktop renderer 测试必须
  继续断言 replay 不调用 `onboarding:complete` 且不交接团队。
- timer 测试可能因只等最终态而漏掉即时反馈：验收在 mock promise / timer 释放前
  先断言用户气泡和 DOM 顺序。
- 生成 HTML 较大：只 review 可维护源码和产物哈希 / 验收 evidence。

本变更无数据迁移。若实现需要回退，可一起撤销组件分支、原型状态 / 验收与本轮
生成 HTML；completion marker、IPC 和团队数据从未改变。若产品裁决本身需要回退，
必须重新审查并同步 PRD 与三个行为域，不能只回滚其中一个表面。
