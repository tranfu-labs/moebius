# 提案：onboarding-dual-cli-readiness

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | `第 1 步 · 环境就绪（至少一个 CLI 可用）` 至 `第 1 步 · CLI 已安装但未就绪` | Codex / Kimi 独立检查、任一就绪放行、真实版本与恢复分流 | 已写入 |
| `docs/product/pages/onboarding.md` | `第 2 步 · 选团队` 与 `第 2 步 · AI 建队子流程` | 团队兼容提示与可用 CLI 驱动的 AI 建队 | 已写入 |
| `docs/product/pages/onboarding.md` | `操作与反馈`、`指标与验收` | 后台安装生命周期、退出协调、无障碍与组合验收 | 已写入 |

PRD 在 2026-07-26 的产品采访与只读评审中完成；用户确认产品命题、核心旅程、
就绪判据、后台安装行为和 AI 建队 CLI 选择，并在原型及实施摘要交付后明确回复
“开始开发”。

## 背景

正式首次引导目前把 `codex --version` 作为唯一硬门，只能展示 Codex 的成功、缺失
或不可运行状态，并提供复制安装命令。产品其余执行配置已经允许团队成员选择 Codex
或 Kimi，因此 Kimi-only 用户会在入口被错误阻断，团队选择和 AI 建队也无法与本机
真实可用引擎保持一致。当前安装入口缺少直接执行、持续反馈、取消、超时和退出协调。

独立高保真原型已经覆盖双 CLI 主要状态和组合旅程，但生产 Electron、console-ui
组件与行为事实源仍停留在 Codex-only 基线。

## 提案

- 复用桌面端现有 Codex / Kimi capability probe，在首次引导中对两套 CLI 分别执行
  版本与无推理模型能力检查；每套 CLI 使用独立 revision，只接受最后发起的结果。
- 把第 1 步改为两行独立状态；Codex 或 Kimi 任一完整就绪即可继续，两者都未就绪
  才阻断。
- 新增主进程拥有的受信任安装任务 registry。renderer 只提交 `codex | kimi` 枚举；
  Codex 以参数化 npm spawn 安装，Kimi 以下载进程到 bash stdin 的流式管道安装。
  两套可并发，同一套去重，持续发布安全阶段、成功、失败、取消和超时状态。
- 安装可在用户离开第 1 步后继续；标题栏聚合活动任务。应用退出时由主进程协调
  留在应用或取消全部任务，绝不遗留孤儿进程。
- 根据本次就绪状态提示团队成员 CLI 兼容性；AI 建队在只有 Kimi 可用时使用 Kimi，
  Codex 可用时优先 Codex，并在草稿生命周期内冻结 CLI/profile/session，失败不跨
  CLI 静默降级。
- 以已确认原型作为视觉和交互基线，补齐正式页面的亮暗主题、窄窗口、键盘、焦点、
  `aria-live` 与 reduced-motion 验收。

## 影响

- 业务域：`desktop-shell`、`console-ui`、`design-prototypes`。
- 主要实现：`desktop/src/onboarding/*`、`desktop/src/preload.ts`、
  `desktop/src/console-page/app.tsx`、`desktop/src/ai-team-builder/*`、
  `packages/console-ui/src/onboarding/*`，以及对应测试。
- 复用：`desktop/src/execution-capabilities.ts` 与团队执行 profile 纯规则。
- 安全边界：不新增 renderer 任意命令、URL 或参数入口；不把 PID、路径、stderr、
  token、provider 密钥或 session id 放进 DTO；不引入 shell 字符串执行。
- 不影响：terminal runner、GitHub mode、local-console 会话事实源、observer 只读
  边界、completion marker 语义和既有四步路由。
