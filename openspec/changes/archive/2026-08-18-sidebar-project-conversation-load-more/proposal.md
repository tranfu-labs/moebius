# 提案：sidebar-project-conversation-load-more

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-left-sidebar.md | 项目内对话的渐进加载 | 项目内未置顶对话从最新 5 条开始，按每次最多 10 条渐进展开，并在折叠后重置 | 已写入 |

## 背景

当前 local console state 与侧栏组件都会承载项目下的完整会话列表，侧栏展开项目后一次渲染全部未置顶根会话。长列表会占据项目导航空间，也没有符合用户预期的分批浏览入口。

## 提案

在现有 `ConversationSidebar` 的项目会话列表上增加视图级渐进加载：默认窗口为最新 5 条，点击底部 ghost 操作后追加最多 10 条；折叠项目时取消待处理加载并清除该项目的批次状态，重新展开回到 5 条。置顶区、项目顺序、会话排序、选中和状态点语义保持不变。

## 影响

- `packages/console-ui/src/console/conversation-sidebar.tsx`：项目会话可见窗口、加载按钮、加载态和折叠重置。
- `packages/console-ui/src/i18n/locales/console.en.ts` 与 `console.zh-CN.ts`：新增显示与加载辅助文案。
- `packages/console-ui/src/console/conversation-sidebar.test.tsx`：边界、重复加载、折叠重置与中英文文案测试。
- `openspec/specs/console-ui/spec.md`：实现并验证后合并本 change 的 spec delta。

不修改 local-console state API、SQLite 查询或持久化格式；本需求约束的是侧栏呈现窗口。
