# 实现符合度反思：support-claude-cli

## 结论

实现与已批准的 proposal、design、三个 spec delta 及 PRD 锚点一致。Claude Code 已作为
local-console 的第三套硬路由执行引擎接入，Fable/Sonnet/Opus 静态配置、`2.1.170`
引导与运行时双重版本门、原生普通 Agent 配置边界、隔离 AI 建队、受信任安装/更新动作
和三 CLI onboarding 均已落地。GitHub runner、附件管理边界和默认 Codex profile 没有
被扩张或改写。

## 验收影响

- 真实 Claude Code `2.1.220` adapter 验收通过 full、同 ID resume、managed PNG、
  managed 普通文件和有限取消；脱敏证据位于系统临时目录。
- 隔离 Electron 首启确认三行 readiness、Claude ready 与可继续；Agent Team 配置确认
  Claude 默认 `sonnet/high`、Fable effort 集合和保存重开；真实 Fable 会话确认首轮与
  同 session 续接。
- 真实桌面验收发现 onboarding 副标题仍写“双 CLI”，以及 Claude run 的完整输出不可用
  说明误写 Kimi。两处均改为三 CLI / 执行引擎中性文案，并经同一隔离桌面复验。
- 自动化覆盖 exact argv/env、普通 Agent 不干预配置、内部 Agent/team inventory、
  旧版本先于 session 写入失败、错误分类、协议上限、取消升级、schema 迁移、readiness、
  安装/更新 IPC、AI 建队优先级及 UI 异步环境假设。

## 范围与未验证项

- 未真实执行安装或更新，以免修改本机 Claude Code；固定 URL、分进程管道、绝对路径
  `["update"]`、renderer 不可注入、并发/取消/超时由主进程 fake 测试验证。
- 本仓库未提供可调用的 OpenSpec CLI，事实源合并、PRD/wireframe 回流和归档按
  `openspec/changes/AGENTS.md` 人工核对完成。

## 补充真实兼容验收

主理人复核指出 6.6 不能以自动化回归代替后，change 从暂存归档恢复为 active，并在新的
隔离 Electron 数据根与干净临时 Git workspace 中完成以下真实入口：

- Codex-only：三名成员均冻结 Codex profile，从项目侧栏打开真实会话后可见
  `CODEX_ONLY_OK`；唯一 attempt 为 completed，实际 engine 为 `codex`。
- Kimi-only：三名成员均冻结 Kimi profile；即使 onboarding 的 GUI PATH 检查显示
  missing，runtime 仍从受信任默认位置启动 Kimi，主时间线可见 `KIMI_ONLY_OK`；
  唯一 attempt 为 completed，实际 engine 为 `kimi`，没有跨 CLI fallback。
- Codex/Kimi 混合：`dev-manager=codex`、`dev=kimi`、`qa=codex`。真实 Codex 主理人
  输出 `MIXED_CODEX_OK` 并交棒 `@dev`，真实 Kimi 成员输出 `MIXED_KIMI_OK`，随后
  Codex 主理人按既有 handback 规则收尾。实际 engine 序列为
  `codex → kimi → codex`，三个 attempt 均 completed。

三条会话均在真实桌面时间线可见，workspace 保持 clean；混合会话完全收敛后无活动 run，
页面横向溢出为 0。脱敏 JSON 与三张 UI 证据位于
`/tmp/moebius-cli-compat.JVjaXL/`。

## Kimi readiness 缺陷修正与复验

首次兼容验收暴露 onboarding 直接调用命令名 `kimi`、runtime 则使用
`resolveKimiExecutable` 的语义分裂：GUI PATH 不含 Kimi 时引导误报 missing，但 runtime
仍能从受信任默认位置运行。change 因此再次恢复为 active，并完成以下修正：

- onboarding 与 runtime 现在共用 PATH-first/default-location resolver；解析一次后，
  `--version` 与 `provider list --json` 都固定调用同一 absolute path。
- 测试覆盖 GUI PATH 缺失但默认路径存在、PATH 候选优先、权威候选不可执行且不
  fallback、完全缺失四类边界。
- 隔离真实 Electron 的 GUI PATH 不含 `~/.kimi-code/bin` 时，环境页显示
  `Kimi CLI 可用 / 0.29.2`；团队兼容警告在 readiness 收敛后消失。
- 另一隔离真实 Electron 中 Codex 缺失而 Kimi/Claude ready，AI 建队可见文案明确为
  “AI 将使用 Kimi 帮你把成员组齐”，保持 `Codex → Kimi → Claude`。
- 修正后再次执行 Codex-only、Kimi-only、Codex/Kimi 混合真实会话，时间线分别可见
  `CODEX_ONLY_FIXED_OK`、`KIMI_ONLY_FIXED_OK` 与完整三棒 marker；实际 engine 序列为
  `codex`、`kimi`、`codex → kimi → codex`，均无 error 或 fallback。

修正后的脱敏 JSON 与 onboarding、三类会话截图位于
`/tmp/moebius-kimi-readiness-ui.00VD2S/`；AI 建队选择截图位于
`/tmp/moebius-kimi-builder-fixed.B0I4px/`。自审补充了 readiness 在检查时读取
shell-enriched live PATH 的边界后，最终 desktop build 又在 Codex/Kimi 都不在 PATH 的
隔离 Electron 中确认 Kimi ready、AI 建队选择 Kimi、兼容警告为 0；证据位于
`/tmp/moebius-kimi-final-ui.7kL4CP/`。自动门禁最终通过 root 767、附加 51、
desktop 350、console UI 415 项测试，以及 typecheck、Storybook 和 desktop build。

## 事实源闭环

- 三个 spec delta 已合并至 `openspec/specs/console-ui`、`desktop-shell` 与
  `local-console`。
- `wireframes.md` 的三行 onboarding、并发安装和窄窗口结构已由
  `docs/product/pages/onboarding.md` 的「页面结构」接管。
- proposal 中列出的 onboarding、Agent Team、主会话、右侧栏和总 PRD 锚点均与最终
  实现一致；不需要 architecture SVG。

## 独立 QA 三 CLI 文案缺陷修正

独立 QA 在 Claude-only 真实 Electron 中发现两处 Codex/Kimi 二分遗留：AI 建队卡片
正确显示 Claude Code，但设计器 context label 错误显示 Kimi；退出协调也会把单独
Claude 安装误写成 Kimi，并把任意多项固定写成 Codex 与 Kimi。change 因此再次恢复
active，并完成以下闭环：

- AI 建队卡片与设计器 context label 统一复用 console UI 的三 CLI label helper。
- 主进程退出协调改由纯函数生成完整 dialog options，按固定
  `Codex → Claude Code → Kimi` 顺序规范化并逐项列出实际 running CLI。
- 表驱动测试覆盖三套单项、三种双项和三项共 7 种非空组合，并逐项断言中英文文案；
  Claude-only 组件测试同时断言卡片与设计器文案一致。
- 最终 Electron 在 Codex missing、Claude `2.1.220` ready、Kimi 权威 PATH candidate
  unavailable 的环境中，卡片可见“AI 将使用 Claude Code”，设计器可见
  “使用 Claude Code CLI”，不存在 Kimi context label，横向溢出为 0。

本轮定向测试为 desktop 8 项、console UI 14 项；最终全量为 root 767、附加 51、
desktop 357、console UI 416 项，typecheck、Storybook 与 desktop build 均通过。脱敏
JSON 与真实 Electron 截图位于 `/tmp/moebius-claude-only-label.MGQNnx/`。现有
desktop-shell Requirement 已明确退出时“逐项列出任务”，因此该修复恢复既有事实，
无需新增或修改 spec 判据。
