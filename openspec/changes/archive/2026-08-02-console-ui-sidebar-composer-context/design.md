# 设计：console-ui-sidebar-composer-context

## 方案

### 1. 独立文件与依赖边界

新增四个叶子组件，各自只依赖 React、`lucide-react`、现有 `@/ui/*` 原语、`@/lib/utils` 与现有语义 token：

| 组件 | 职责 | 主要输入 / 输出 |
|---|---|---|
| `ConversationSidebar` | 项目目录名、会话排序、选择态、已完成折叠 | `projects`、`selectedSessionId`、`onSelectSession` |
| `RoleComposer` | 受控消息输入、角色补全、单 mention 插入约束 | `value`、`onValueChange`、可选 `onSubmit` |
| `ConversationEmptyState` | 邀请式空态与 composer 组合 | 透传 composer 的 value/change/submit |
| `SessionContextHeader` | 父会话面包屑、任务状态、进展摘要 | 当前会话 context、可选父会话点击回调 |

组件与 Story 不从共享 `src/index.ts` 获取自身类型，避免为了 Story 修改共享出口。四个组件不导入或包装 `OperatorConsole`，也不复制其整页布局。

规格 delta 以 `spec-delta/console-ui/spec.md` 满足仓库归档约定，同时在 `specs/console-ui/spec.md` 保留逐字一致的兼容镜像供当前 OpenSpec CLI 识别；自审与实现收尾都需比较两份文件，禁止只改其中一份。

### 2. 侧栏数据与排序

`ConversationSidebarProject` 接收稳定 `id`、`path` 和 `sessions`。项目展示名由 path 末级目录推导，兼容 `/`、`\\` 与尾随分隔符；路径无法推导时回退到显式 label。

会话状态只使用本任务确认的四态：

- `waiting`：等你，排序权重 0，使用中性 hand 图标。
- `running`：运行中，排序权重 1，使用中性呼吸点；这是组件唯一持续动效。
- `idle`：静止，排序权重 2，不显示工作流文案。
- `completed`：已完成，排序权重 3，进入独立折叠分组。

排序函数返回新数组，不修改 props；同一状态内保持调用方顺序稳定，不根据消息更新时间或选中态重排。这样既满足四档排序，也避免输出流导致列表跳动。目标会话不进入特殊分组，按自身真实状态参与同一排序。

已完成分组初始关闭，以按钮的 `aria-expanded=false` 表达；展开后显示完成会话数量与行列表。选中会话只使用 `bg-sel` 和 `aria-current`，不改变排序键。

### 3. composer 补全协议

组件内置固定且有类型约束的七角色表：

| handle | 中文名 | 职责短句 |
|---|---|---|
| `ceo` | CEO | 澄清目标并编排任务 |
| `dev` | 开发 | 写方案并实现代码 |
| `qa` | 测试 | 审查方案与测试设计 |
| `dev-manager` | 技术负责人 | 技术决策与质量把关 |
| `product-manager` | 产品 | 确认需求与验收范围 |
| `hermes-user` | 用户代表 | 从用户视角验收体验 |
| `secretary` | 秘书 | 维护 CEO 规则与文档 |

补全面板仅在光标前存在当前 `@query` 触发词、且消息其余部分没有合法角色 mention 时打开。合法 mention 识别采用角色白名单与词边界，不把普通邮箱或未知句柄计为合法角色。

选择角色时，组件只替换当前触发词为 `@<handle> `，保留前后普通文本并通过 `onValueChange` 回传完整协议值。如果消息已含一个合法角色，组件不再打开第二个补全面板，插入函数也返回原值；本任务不静默改写用户手动输入的任意文本。

面板支持鼠标点击，以及方向键移动、Enter 选择、Escape 关闭。它是本任务唯一使用柔和阴影的浮层；输入框、按钮、侧栏和顶栏均无阴影。角色行向用户展示中文名和职责，英文 handle 只作为选择后的协议值出现。

### 4. 空状态与顶栏上下文

`ConversationEmptyState` 使用一句「描述你的目标，@ 一个角色开始」及 `RoleComposer`。空态不出现插画、「未读」、报错式文案或额外实心按钮；发送能力由 composer 的单个扁平主按钮承载。

`SessionContextHeader` 只渲染：

- 可选的「属于：<父会话>」面包屑；存在回调时为幽灵按钮，否则为静态文字。
- 当前任务 label 与中性状态 label。
- 通过、运行中、等你三项进展摘要；零值仍可读，但不使用红点或彩色状态块。

顶栏不渲染全局「等你 / 运行中」计数、新会话按钮或清单浮层。状态颜色保持中性，靛紫只用于可操作的焦点、链接或主按钮。

### 5. 视觉约束

以 `accept-card.tsx` 为组件库活参考，并复用 `tokens.css` 的 `canvas / rail / card / input / ink / sub / hint / line / sel / hover / accent` 语义变量。实现遵循：

- 近方角、小半径、0.5–1px 细边与紧凑间距。
- 页面内普通容器零阴影，仅角色补全面板使用一层柔和阴影。
- 一屏至多一个实心强调按钮；其余动作使用 outline 或 ghost。
- 状态不用装饰性色；等你靠排序和 hand 图标，运行中靠中性呼吸点。
- 字号不低于 12px，侧栏会话行约 36px 高，长名称单行截断。
- 深浅模式全部使用现有语义 token，不在组件源码写裸色值。

### 6. Story 与自动验证

每个组件各有独立 Story 文件：

- 侧栏 Story 提供路径、乱序四态会话与已选会话，初始截图不显示完成会话，点击分组后可展开。
- composer Story 使用受控 wrapper，用户键入 `@` 后能看到七角色面板，选择后画布内直接显示生成值；另提供已有 mention 的阻止样例。
- 空状态 Story 展示邀请式文案和可交互 composer。
- 顶栏 Story 展示父会话面包屑、任务状态与三项进展摘要。

共置 Vitest / Testing Library 测试覆盖目录名推导、稳定四档排序、完成分组初始折叠、选中态不重排、七角色可见、鼠标与键盘选择、合法 mention 生成、第二个 mention 插入被阻止，以及空态 / 顶栏必需上下文和非目标元素缺失。

实现阶段至少运行：

- `pnpm --filter @moebius/console-ui test`
- `pnpm --filter @moebius/console-ui typecheck`
- `pnpm --filter @moebius/console-ui build-storybook`
- `pnpm typecheck`

## 权衡

1. **稳定四档平铺，不增加目标档**：严格采用需求侧确认的最小范围。放弃 `conversation-console/design.md` 较宽的「目标会话特殊置顶」规则，避免本子任务扩展验收口径。
2. **组件内部提供默认角色表**：保证 Story 与未来消费者开箱即用、句柄不会由调用方拼错；同时可把角色表导出为只读常量供测试或后续接入使用。本任务不修改共享出口。
3. **只阻止控件插入第二个 mention**：控件不应悄悄删改用户文本；最终发送链路的协议校验仍属于集成任务，本组件负责不制造非法值。
4. **独立组件先行，不接入整页**：符合并行 conflict group 边界，也允许后续整合任务在明确数据 adapter 后组合这些组件。代价是本任务的验证入口以 Storybook 为主。
5. **不另建 wireframes.md**：本任务不创造新页面或版式事实，只实现既有 `conversation-console/wireframes.md` 的局部组件；重复字符图会造成事实源漂移。

## 风险

- 独立组件状态类型与后续 local console API 状态可能不完全同构；通过窄四态展示模型隔离，集成时由 adapter 映射，不在本任务扩大状态枚举。
- Storybook 的视觉通过不能替代行为测试；因此排序和 mention 插入必须有单元测试，Story 负责交互和视觉验收。
- 项目路径在不同平台使用不同分隔符；目录名 helper 明确覆盖 POSIX、Windows 与尾随分隔符。
- 不修改共享出口意味着包外消费者暂时不能从 package root 导入；这是已确认的并行边界，后续整合任务统一处理。
- 回滚只需删除本 change 新增的独立组件、测试和 Story，不影响现有 operator console。
