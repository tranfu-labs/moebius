# 提案：align-conversation-relay-rail-dashboard

## 需求基线

需求采访对照：

- **现状**：`docs/product/pages/main-conversation.md#会话目录轨` 记录的是收起 / 展开共用固定行距、用户菱形、按主会话宽度插值的面板，以及只连接相邻可见事件的曲线；生产组件与这份旧基线一致。
- **期望**：用户明确要求对齐 `packages/console-ui/design-refs/dashboard.html` 的收起态与展开态；新基线改为主会话左缘固定目录、展开后内容驱动宽度、用户主干与按首次出现排列的成员分支。
- **落点**：只影响主页面会话区，更新 `docs/product/pages/main-conversation.md#会话目录轨`。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `# 会话目录轨` | 用 dashboard 参考稿替换旧轨迹几何、尺寸、锚点与响应式规则，并修正当前实现状态说明 | 已写入 |

参考实现来自 2026-07-28 的 `packages/console-ui/design-refs/dashboard.html` 与 `app.css`；它晚于生产目录轨最后一次更新，是本次视觉对齐的直接依据。

## 背景

生产目录轨已经具备事件投影、滚轮 / 键盘浏览、预览、精确定位、阅读位置恢复和 reduced-motion 支持，但收起与展开效果仍停留在上一版方案：

- 轨迹槽位跟随正文列计算，不是参考稿的主会话左缘固定内缩。
- 展开前后沿用相同行距，面板宽度按容器插值，少量成员时留下过多空白。
- 用户和 Agent 被等距铺到整个面板；连接线只逐段连接相邻事件。
- 参考稿已经改为更接近 `git log --graph` 的用户主干与成员分支，并补充更舒展的展开密度、内容驱动宽度、抬升底面、行 hover 带和当前节点描边环。

若只改 Tailwind 样式而保留现有纯模型，展开态仍无法得到参考稿的泳道顺序、成员分支和省略区收束，因此本次需要同时调整纯几何模型与组件渲染。

## 提案

- 保留现有消息事件投影、阅读焦点、浏览 / 激活、预览文案、定位失败恢复和每会话阅读位置契约。
- 收起态对齐参考稿：目录在主会话左缘保持克制内间距，普通横线与当前阅读横线形成明确层级；用户使用前景色，Agent 使用身份色。
- 展开态使用更舒展的行距、无阴影抬升底面、细描边与轨迹下方 hover 带；面板宽度由实际成员数决定并受可用空间约束。
- 纯模型固定用户主干，按 Agent 首次出现顺序分配成员泳道，并产出用户主干、成员分叉 / 纵向延伸 / 并回路径；路径遇省略区必须在边界收束，不能跨区虚构交接。
- 所有展开节点使用圆点，当前阅读焦点使用身份色描边环；检查事件时只增强关联轨迹，不改变几何。
- 预览卡保持紧凑正文、相对面板的固定间距与允许指针跨入的延迟关闭。
- 可见窗口按展开态实际行距约束，保证变矮视口下展开面板不越界；窄窗口优先压缩成员泳道间距与预览宽度 / 方向，不重排正文。

## 影响

- `packages/console-ui/src/console/conversation-relay-rail-model.ts`：泳道、内容宽度、轨迹分支与可见容量的纯模型。
- `packages/console-ui/src/console/conversation-relay-rail.tsx`：收起 / 展开尺寸、图层、节点、路径、预览和关闭交互。
- `packages/console-ui/src/console/operator-console.tsx`：目录槽位改为当前主会话左缘锚定，保持正文与 composer 不重排。
- `packages/console-ui/src/console/conversation-relay-rail*.test.tsx`、`operator-console.test.tsx` 与 Storybook：覆盖几何、长会话、交互、窄视口与明暗主题可视状态。
- `packages/console-ui/DESIGN.md`：更新主会话目录轨模式。
- `openspec/specs/console-ui/spec.md`：归档时合并本 change 的行为 delta。
- 不改消息 / 会话 / 团队数据契约、local-console API、桌面 IPC、preload bridge、SQLite / JSONL、阅读位置持久化格式或模块依赖方向。
- 不重设计项目 / 会话侧栏、右侧栏、子会话、onboarding 或其他页面；不向 desktop 业务层暴露 Story-only 控制项。
- 不需要 architecture 图或 ADR。
