# 设计：align-conversation-relay-rail-dashboard

## 方案

### 目标到技术决策映射

| 决策 | 范围类型 | 与用户“对齐收起态及展开态效果”的关系 |
| --- | --- | --- |
| 参考稿的收起横线尺寸、展开行高、内容驱动宽度、预览宽度与关闭时序 | 直接对齐参考稿 | 都来自 `dashboard.html` / `app.css` 的收起或展开可见效果；其中预览宽度决定卡片密度，关闭时序保证指针能从轨迹跨入预览卡 |
| 用户主干与成员分叉 / 纵向延伸 / 并回 | 直接对齐参考稿 | 是参考稿展开态区别于当前“相邻事件 S 线”的核心视觉；纯模型只是承载该几何的可维护实现方式 |
| 用最大展开行高计算容量，而不是继续按收起行高计算 | 生产环境适配 | 参考稿定义了更舒展的展开行高，但原型容量仍按收起行高估算；生产按展开密度计算，防止长会话在矮窗口中越界 |
| 滚轮 / 方向键只浏览、激活才定位、定位失败保持原位、每会话阅读位置恢复 | 既有行为回归保护 | 这些不是本次新增效果，必须在视觉对齐后保持不变 |

### 1. 纯模型承接轨迹几何

把参考稿中与 DOM 无关的规则收进 `conversation-relay-rail-model.ts`，组件只消费结果：

- `deriveConversationRelayLayout(events, availableWidth)` 返回主干位置、按首次出现排序的 Agent 泳道、实际展开宽度与压缩后的 lane step。
- 用户固定在 `x=14px`；Agent 默认每条泳道向右增加 18px，右侧保留 14px。成员过多或会话过窄时压缩 step，展开宽度封顶 224px。
- `deriveConversationRelayPaths(allEvents, visibleRows, layout)` 返回一条弱化中性用户主干和每名 Agent 的身份色分支。分支从该成员首个可见事件之前的真实可见节点平滑进入，穿过该成员可见节点，再平滑并入其最后一个可见事件之后的真实可见节点。
- 当前窗口边界之外仍有该成员事件时，分支只延伸到面板顶 / 底边；任一方向存在省略行时，路径在该边界终止，绝不跨过省略行直连。
- 路径描述保留在纯数据中，组件不再遍历 JSX 行临时推断几何；模型单测集中覆盖 `user → A → B → A → B`、连续同成员、首 / 尾成员事件、上下双省略和多成员压缩。

成员分支本身属于直接对齐参考稿；把分支计算下沉为纯模型属于生产环境适配，用于把状态规则与 React 渲染分离，并让边界和异常路径可集中单测。

### 2. 收起态

目录宿主仍是主会话中的绝对定位旁路，不参与时间线 flex 布局：

- slot 相对 `parent-conversation-pane` 使用 `left: 12px`，`top: var(--window-header-height)`，底部覆盖到主会话可用区域；不跟随左侧导航栏宽度或正文列居中公式。
- 组件外框宽 44px，事件行高 20px，轨迹整体在可用高度内垂直居中。
- 每条事件按钮继续占满 44px 行命中区；短横线固定 `left: 8px`，普通事件为 `13 × 2px / opacity .7`，当前阅读焦点为 `24 × 3px / opacity 1`。
- 用户横线用 `text-ink` 对应前景色，Agent 横线继续复用 `identityToken(actorKey)`。
- 收起态不绘制节点、面板边框、路径或 hover 卡；省略行保留 `•••`。

### 3. 展开态与图层

展开后仍复用相同的真实事件与浏览焦点，但用 32px 行高重新定位可见行：

1. `z=1`：事件 hover / focus band，使用 `bg-hover`，圆角 6px。
2. `z=2`：SVG 主干与成员分支；主干使用 `text-sub`，成员分支使用各自身份色，默认 1.5px / `.85`，当前检查事件相关路径为 2px / `1`。
3. `z=3`：整行透明按钮与节点；按钮仍是唯一命中区。

面板使用 `bg-sunken`（对应参考稿的 raised neutral）、`border-line`、8px 圆角、零阴影。短横线从共同左端收束并淡出；节点从 `left: 8px` 横向进入目标泳道；路径淡入。参考稿的行高从 20px 过渡到 32px，但不让时间线正文、标题或 composer 参与动画。

节点统一为 9px 圆点，当前焦点为 12px 空心环：面板底色填充、作者色描边。用户与 Agent 的作者差异由主干 / 分支位置与颜色表达，不再用菱形。

### 4. 高度、长会话与响应式

参考稿以 20px 计算容量却在展开时把每行拉到 32px，长会话可能越出视口。生产实现采用同视觉、但用最大展开密度守住边界：

- 容量按 `floor(availableHeight / 32px)` 计算；正常窗口至少保留 7 行，极矮窗口允许降到“首条边界 + 当前焦点 + 末条边界”3 行。同一批 rows 同时服务收起和展开，避免 hover 时省略窗口换页。
- 可用高度不足 7 行时，先减少可见事件，再把展开行高从 32px 有界压缩到不低于 20px；不新增轨内滚动条，也不让面板越过可用视口。
- 主干、首尾边界和当前浏览焦点始终保留；收起态会比旧实现更留白，但展开不会被 composer 或窗口底边裁掉。
- 宽度先按实际 Agent 数计算；超过可用宽度时压缩 18px lane step，最终不超过 `min(224px, availableWidth - previewBudget)`。
- Radix Popover 保持相对整个面板的 12px side offset；优先整卡翻转，其次把 240px 宽度约束到 `calc(100vw - 24px)`，不跟随节点 lane x 漂移。

### 5. 交互、焦点与动效

- hover 或 `focus-within` 展开；离开面板后延迟 120ms 收起，进入预览卡会取消计时，保证指针能跨过 12px 间隙。
- mouse / pointer 检查只更新 `inspectedId`；滚轮和方向键只移动 `browseId`，不滚主时间线；点击、Enter、Space 才调用现有 `onActivate`。
- 预览卡固定 240px，头部为作者色点、可读名称和时间，正文最多三行；Agent 不显示关联用户标题或 slug。
- 关闭、会话切换、事件被移除和异步 rows 重算时清理失效的 inspected / pending focus，避免 Popover 锚到不存在的行。
- `prefers-reduced-motion` 下取消宽高、top、节点、路径和预览内容的过渡；定位继续使用现有 auto scroll，信息与标准模式一致。

### 6. Story 与真实页面验收入口

- Block Story 增加 `Collapsed`、`ExpandedReference`、`LongConversationMiddle`、`ManyMembersNarrow`；Story 仍直接渲染生产组件，不复制参考 HTML。
- `ExpandedReference` 通过 Storybook `play` 对真实事件行执行 hover / focus 进入展开态，不为生产组件增加 Story-only prop，也不向 desktop renderer 或业务层暴露控制项。
- Page Story 使用包含 `user → manager → dev → manager → qa → dev` 的确定 fixture，验证主会话内锚点、侧栏开合与正文无重排。
- 正式桌面验收进入任一有多成员历史回复的根会话；在明暗主题、常规宽度、窄宽度和矮窗口下逐条核对 `tasks.md` 的真实运行验收语句。

## 范围护栏

- 不修改消息、会话、团队或阅读位置的数据结构；`ConversationRelayEvent` 继续由当前消息投影得到，不新增后端字段或第二事实源。
- 不新增或修改 local-console API、desktop IPC、preload bridge、SQLite / JSONL 持久化格式或阅读位置 localStorage schema。
- `OperatorConsole` 只调整目录 slot 的呈现锚点，现有 `initialReadingMessageId` / `onReadingMessageChange` 调用和恢复语义原样保留。
- 不重设计项目 / 会话侧栏、右侧栏、子会话、onboarding 或其他页面；Story 只为当前主会话目录增加确定 fixture。
- 不向 desktop renderer、业务 controller 或组件生产 API 暴露 Story-only 强制展开开关；展开证据通过真实 hover / 键盘 focus 产生。
- 不新增运行时依赖、全局视觉令牌、架构依赖方向、API 或外部动作。

## 权衡

- **选择用户主干 + 成员分支，而不是保留相邻事件曲线**：这是参考稿最明显的展开效果，也是用户本次指定的目标；代价是路径模型更复杂，因此必须下沉到纯模块集中测试。
- **使用生产语义令牌近似参考变量**：`bg-sunken / border-line / text-sub / bg-hover` 分别承接 `--raised / --border / --muted / --hover`，不复制参考稿裸色值。
- **用最大展开密度计算窗口，而不是照抄参考稿的 20px 容量**：普通会话视觉完全对齐，同时避免长会话展开后被窗口底边裁切。
- **不复用参考稿 JavaScript**：参考稿从 DOM 反查消息且缺少键盘 / 滚轮路径；生产继续使用现有事件数据和 React 焦点契约，只迁移已经确认的视觉与纯几何规则。
- **不改阅读位置与定位链路**：本次目标是目录呈现；现有 `OperatorConsole` 的持久化、失败反馈和滚动恢复已有测试，扩大到数据层没有收益。

## 风险

- 成员长期交错时，单成员竖向分支可能与其他节点交叠；通过稳定 lane、图层顺序和当前路径强调保证可读，Story 使用往返 fixture 对抗验证。
- rows 同时受高度与焦点影响，hover 展开时重算可能使键盘焦点丢失；实现必须先得出稳定 rows，再只切换 rowHeight，并保留 `pendingFocusId` 恢复。
- 参考稿的 32px 展开行高会降低长会话可见事件数；省略窗口与滚轮 / 方向键必须继续可达全部事件。
- Popover 在极窄窗口翻转后可能遮住左侧栏；碰撞策略必须以主窗口边界为准，且不得推动正文。
- 生产 Tailwind 动态类若无法静态收集会导致样式缺失；尺寸与颜色使用现有静态工具类或受控 inline style，Storybook build 是必要门禁。
