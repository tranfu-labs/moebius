# 提案：add-desktop-i18n-settings

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/settings.md` | `页面目标`、`页面结构`、`操作与反馈`、`指标与验收` | 设置改为主工作区模态弹窗，首期提供简体中文与英文，并规定先保存后全局切换 | 已写入并确认 |

本次产品决定记录于 `docs/product/pages/settings.md` 的 2026-07-27 决策说明；高保真对照件为 `docs/product/pages/settings.prototype.html`。

## 背景

当前侧栏“设置”仅是无交互入口，桌面 renderer、状态页和 Electron 主进程提供的静态文案直接散落在 TypeScript、TSX、HTML 与 JavaScript 中。应用没有语言资源、语言偏好存储或跨窗口同步能力，也无法在不离开当前任务的情况下修改界面语言。

## 提案

1. 在 `console-ui` 建立 `zh-CN` 与 `en` 独立资源、类型安全翻译函数和 React provider；产品静态文案只按 key 读取，组件不得通过 locale 分支生成文案。
2. 把侧栏设置入口接成覆盖当前工作区的受控模态弹窗，首期只显示“常规 → 语言”，并实现焦点圈定、焦点归还、键盘关闭和窄窗布局。
3. 在 desktop-shell 建立版本化语言偏好 store、窄 preload/IPC 契约和跨窗口广播；启动时恢复已保存语言，缺失、损坏或不支持值回退简体中文。
4. 切换语言时先原子持久化；成功后一次提交全局语言并广播，失败保持原语言、给出可重试反馈。
5. 迁移桌面客户端由 Moebius 提供的静态文案；用户输入、Agent 回复、项目名、文件内容、文件名、本地路径和原始诊断保持原文。

## 影响

- `packages/console-ui/src/i18n/`、设置弹窗、`OperatorConsole` 及其测试。
- `desktop/src/i18n/`、语言偏好 store/contract、`main.ts`、`preload.ts`、console renderer 和状态页。
- `prototypes/src/settings/`、settings 单 HTML 构建发布与离线/交互验证。
- `console-ui`、`desktop-shell` 与 `design-prototypes` 三个行为域；不改变 local-console、runner、会话存储或用户内容。
- `docs/architecture/` 在归档时新增语言偏好链路图；根 `AGENTS.md` 无新增命令、顶层目录、红线或域指针，不触发更新。
