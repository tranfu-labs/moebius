# 提案：align-onboarding-product-surfaces

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | 页面结构 | 补齐 Codex 已安装但不可运行态，并明确错误卡与固定 footer 的边界 | 已写入 |
| `docs/product/pages/onboarding.md` | 第 1 步通过态、不可运行态、指标与验收 | 正式页面展示最近一次真实版本结果；静态评审表面不固定具体版本号；明确缺失 / 不可运行分类和错误脱敏 | 已写入 |
| `docs/product/pages/onboarding.md` | 区域与信息、重新查看引导 | 将回看第 4 步 CTA 裁决为仍使用「开始使用」，同时保留回看无持久化副作用的语义 | 已写入 |
| `docs/product/pages/onboarding.md` | 页面状态、指标与验收 | 固化两类 Codex 错误与回看返回判据，并沿用既有 AI 调整消息时序作为三方对齐基线 | 已写入 |

## 背景

onboarding PRD、独立单 HTML 原型、Storybook 和正式桌面页面目前存在五处可观察漂移：

1. 正式 `OnboardingShell` 已区分 `missing` 与 `unavailable`，但两个错误分支都展示 `brew install codex`；这会把已安装但暂时不可运行的问题误导成安装问题。
2. PRD 与正式页面已有回看模式，独立原型没有对应入口和返回路径；同时旧规则把回看第 4 步改名为「完成回看」，与本次确认的「仍使用开始使用」不一致。
3. PRD 和正式桌面 AI 建队都要求消息发送后立即显示右侧用户气泡，独立原型的自然语言调整却只在 mock 返回后显示「已调整」，无法评审真实等待时序。
4. 正式 Electron 链路已经执行 `codex --version` 并把结果交给引导组件，但 Storybook 把 `codex-cli 1.0` 写死为可见版本；它与本机真实结果不一致，容易让用户把整个检测理解成假数据。独立 HTML 原型没有真实检测能力，不应补一个示例版本来模拟正式链路。
5. `env-doctor` 当前把所有 spawn 异常都写成“未找到”，renderer route 又通过文案是否包含“未找到”猜测错误类型；权限错误等不可运行情况会误入安装恢复，底层错误 `detail` 还可能进入状态页或 renderer 边界。

这些差异已经跨越产品意图、行为规格与评审交付物，不能只修一个组件或只改生成 HTML。

## 提案

- 以 `docs/product/pages/onboarding.md` 为本次唯一 PRD 切入点，固定以下产品口径：
  - `missing` 保留安装命令、复制操作、「重新检查」和灰置「继续」。
  - `unavailable` 只显示安全的登录 / 排障提示、「重新检查」和灰置「继续」，不显示安装命令、复制操作、底层路径或原始错误。
  - 正式 Electron 页面显示最近一次 `codex --version` 成功结果中的真实版本文本；首次检查、启动环境准备完成后的自动复检或错误态重新检查都以当次结果整体替换旧值，通过态不新增「重新检查」。PRD、独立 HTML 原型和 Storybook 等静态评审表面不固定任何具体版本号。
  - 只有 `ENOENT` / `ENOTDIR` 归为 `missing`；非零退出、`EACCES`、其他启动异常和成功退出但没有版本文本都归为 `unavailable`。错误结果不向 renderer 传递原始 stderr、异常文本或本地路径。
  - 回看第 4 步仍显示「开始使用」；点击后恢复进入前的操作台，不更新 completion marker，也不带出回看中的临时团队选择。
  - AI 调整消息发送后立即出现右侧用户气泡，「正在输入」位于其后；mock 返回后该轮用户正文恰好出现一次。
- 修正正式 `OnboardingShell` 的不可运行错误分支和回看末步文案；在 `env-doctor` 内收紧错误分类与脱敏。保留现有 `codex --version` 和 preload / IPC DTO 形状，只补足真实版本贯通及现有自动复检刷新证据，不给成功态增加按钮。
- 移除 Storybook 的固定示例版本；没有真实检测输入时只展示通用就绪文案。
- 扩展独立原型的状态模型、确定性 review fixture 与 `file://` 验收，补齐不可运行场景、回看进入 / 退出 / 末步返回和 AI 调整消息时序。
- 重新构建并发布 `docs/product/pages/onboarding.prototype.html`，继续保持原型与正式实现双向代码隔离。

## 影响

- 产品事实源：`docs/product/pages/onboarding.md`
- 正式 UI：`packages/console-ui/src/onboarding/`
- 桌面生产检查与 renderer 映射：`desktop/src/env-doctor.ts`、`desktop/src/onboarding/onboarding-route.tsx`、`desktop/tests/env-doctor.test.ts`、`desktop/tests/onboarding-ipc.test.ts`、`desktop/tests/onboarding-app-routing.test.tsx`
- 原型状态、页面与验证：`prototypes/src/`、`prototypes/scripts/verify-onboarding.mjs`
- 生成交付物：`docs/product/pages/onboarding.prototype.html`
- 行为规格增量：`desktop-shell`、`console-ui`、`design-prototypes`

不影响其他页面 PRD、登录态 / provider / 模型调用探测、preload / IPC channel / DTO 字段、completion marker 存储、团队持久化、跨域源码依赖或 onboarding 整体视觉。
