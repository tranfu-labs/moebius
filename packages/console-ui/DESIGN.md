# console-ui 设计语言

本文件是 `@moebius/console-ui` 的包内设计语言事实源：新组件与组件修改必须组合这里记录的令牌、状态语义与模式，不得引入临时视觉值。引入本目录未收录的新模式时，必须在同一个 change 里回流更新本文件。全局原则见 `docs/product/prd.md`「视觉语言原则」，本文件是令牌与组件级的执行细则。

灵感来源（仅溯源，不复制其内容）：Linear 的产品界面（行结构、冷灰阶、字重层级、图标精度）与近黑底暗色 SaaS dashboard（状态 tinted pill、大圆角、可见描边卡片）。视觉参数自 2026-07 起对齐 `moebius-desktop-spec.html` v1.1（灰阶梯、零阴影零渐变、侧栏与主区同底、圆角分级）；与该规范冲突时以 `docs/product/prd.md` 为准的两条已登记裁决：accent 保持靛蓝 `#5E6AD2`（不采用规范薰衣草紫 `#c090ff`）、completed 保持中性灰（不采用规范亮绿 Done pill）。

## 令牌纪律

- 组件内禁止裸 hex / rgba 色值；一律走 Tailwind 语义工具类（`bg-canvas`、`text-ink`、`text-sub`、`text-hint`、`border-line`、`bg-hover`、`bg-sel`、`bg-accent`、`text-pass`、`text-danger` 等），这些类全部映射到 `src/styles/tokens.css` 的 CSS 变量。
- 新增令牌判据：同一视觉角色在 ≥2 个组件中出现，或需要亮暗双主题分别取值；否则用既有令牌近似。新增令牌必须亮暗双主题同时定义。
- 中性层为五档明度阶梯实色（暗色 `#101010 → #171717 → #1C1C1C → #242424 → #2D2D2D`，亮色 `#FAFAFA / #FFFFFF / #F0F0F0 / #EDEDED / #E4E4E4`）：`--canvas` 页面底、`--card` 卡面、`--sunken` 嵌套/输入面、`--hover` 悬停、`--sel` 选中；侧栏与主区同底（`--rail` = `--canvas`），分区只靠 1px `--line` 与内容密度。
- accent 双主题统一靛蓝 `#5E6AD2`；hover 一律向「更强存在感」方向走：亮色加深 `--accent-hover: #4B57C8`，暗色变亮 `--accent-hover: #828FFF`。
- 暗色画布近纯黑（`--canvas: #101010`）、卡面微亮（`--card: #171717`）、描边可见（`--line: #262626` 实色）；亮色为同结构镜像（灰底白卡，`bg→surface` 向亮走，`hover/sel` 向灰走）。
- 状态色相族令牌：`--status-{run,info,violet,neutral}-{fg,bg,line}` 及裁决 `--pass` / `--danger` 配套 tint，亮暗双主题成对定义；tint 底为实色（暗色如 `--status-run-bg: #2B2612`，亮色为 12% 浅洗底），fg 在其上满足正文对比度。
- 桌面窗口顶层 header 统一使用 `--window-header-height: 46px`；macOS 交通灯、sidebar 展开/折叠按钮和会话 sticky 标题都由该高度容器配合 `items-center` 自然居中，禁止为单个控件追加 `top`、`padding-top` 或 translate 补偿。
- 会话 sticky 标题、Agent 历史消息正文与主时间线活动 run 的角色名/实时正文使用同一条左边界；活动 run 的操作贴住同一正文列右边界。已有会话 composer、待发射区与新对话 composer 复用该列的 `840px` 最大宽度和 `px-8` 页面 gutter，窄窗一起收缩；右侧子任务 composer 保留自己的可用宽度。该正文列由 `conversation-layout.ts` 和宿主建立，通用 `RunBlock` 与 `RoleComposer` 不内置主时间线宽度。**用户消息是唯一的例外**：按聊天惯例走右泳道（who 行右对齐 + 右侧气泡），不占用左正文列。
- 主侧栏默认 252px，保留 220–360px 拖动边界；窗口控制行为 46px、品牌与导航行为 34px、项目与会话行为 32px，会话标题左缩进 28px。窗口控制、品牌、应用导航和底部操作固定，只有项目列表纵向滚动；侧栏和主区共用 `bg-canvas`，只用 1px `border-line` 分区。
- 圆角分级：卡片/表格 14px（`--radius`，Tailwind lg）、chip/菜单 12px（md）、控件/按钮/输入 10px（sm）、药丸与轻跳转全圆角、头像正圆；同一层级圆角必须一致。

## 排版

- 拉丁字体：自托管 Inter Variable（`src/styles/fonts/inter-var-latin-cv01.woff2`，latin 子集，wght 100-900 轴，OFL 1.1，license 同目录 `OFL.txt`）；CJK 回退 PingFang SC 等系统字体，取最近字重档。会话 sticky 标题、品牌名、空状态邀请语等展示性标题使用 `--font-display`（`font-display` 工具类）：Inter Tight 优先、未安装时自然回落 InterVar，配 `tracking-[-0.01em]`。
- 字重梯度：UI 强调 `font-medium`（wght 510）、标题 `font-semibold`（wght 590）、正文 400。Tailwind 的 `fontWeight.medium/semibold` 已映射到 510/590，禁止 700+。
- 全局 `font-feature-settings: "cv01", "ss03"`；13px 正文字距为 0，负字距只用于 ≥16px 标题。
- 数字与相对时间用 `.tnum`（tabular-nums）。

## 图标

- 一律 lucide-react，默认 16px（`h-4 w-4`），`strokeWidth={1.5}`；高密度上下文可用 14px（`h-3.5 w-3.5`）；状态 pill 内图标 12px（`h-3 w-3`），`strokeWidth={2}` 保持可读。图形由既有按钮或文本行宿主自然居中，不缩小宿主，也不为单枚图标追加 `top`、额外上内边距或 transform 位移补偿。
- running 的半满饼图为自绘 12px SVG（lucide 无对应精度图形），见 `src/ui/badge.tsx`；除此之外不为同一语义引入第二种图标集。

## 状态语义与色相预算

Badge 渲染为「12px 状态图标 + 文字 + tinted 底 + 同色描边」的全圆角 pill（实现见 `src/ui/badge.tsx`），语义映射是全包统一的状态语言：

| 状态 | 图标 | 色相 |
| --- | --- | --- |
| running | 半满饼图 | 琥珀（`--status-run-*`） |
| pending | `Clock` | 蓝（`--status-info-*`） |
| waiting | `Circle` 空心 | 紫（`--status-violet-*`） |
| interrupted / idle | `CircleDashed` | 中性描边 |
| completed / displayed | 实心圆 | 中性灰底 |
| failed / stuck | `CircleX` | 红（danger tint） |
| pass | `CircleCheck` | 绿（pass tint，仅裁决面） |

- 绿 / 红只用于验收裁决与危险事实；唯一例外是未读计数允许使用红色圆角标。
- 侧栏会话状态点（red / blue / blink / none）是独立于 Badge 的信号体系，见 `src/console/status-dot.ts` 与 `conversation-sidebar.tsx`，不套用 pill 形态。推导优先级固定为「未确认 attention fact > 控制工作仍在运行 > Agent 或手动未读 > 静止」；颜色只作增强，行辅助名称必须同步表达状态。

## elevation / focus / 动效红线

- 零阴影零渐变：`--shadow-pop` 恒为 `none`，浮层（dropdown / popover / 对话框）只靠 1px 描边与 `bg-sunken` 亮一档的底色分层；禁止任何投影与渐变（包括滚动淡出渐变）。
- 不设置组件库级全局 `:focus-visible` 样式；需要可视键盘焦点的控件由组件按交互语义局部声明。
- 动效只走令牌：`--dur-fast: 100ms`、`--dur: 150ms`、`--ease: cubic-bezier(0.25,0.46,0.45,0.94)`、入场 `--ease-enter: cubic-bezier(0.165,0.84,0.44,1)`；默认只做颜色过渡，不做位移缩放飞入。右侧辅助工作区是登记的空间动效例外：允许在 150ms 内以宽度裁切完成并排开合、以右缘位移完成覆盖开合，中途反向从当前进度继续；内容不得缩放，响应式布局切换不得追加开关动画，`prefers-reduced-motion` 下立即完成。禁止 bounce / elastic 曲线；按钮按下用 `active:scale-[0.98]`，不做更夸张的形变。持续加载 pulse 必须在 `prefers-reduced-motion: reduce` 下取消动画并保留等价静态骨架。
- Card 维持无默认阴影的中性面：可见细边、圆角基线 `--radius: 14px`（Tailwind lg/md/sm 由 calc 派生）。

## 组件模式目录

- **inbox 行**：`src/console/agent-message.tsx`——32px 圆形角色头像（右下角 15px stage 角标）+ 行 1（角色名 510 + stage muted + 右侧状态图标与 tnum 时间）+ 行 2 结论 + 行 3 箭头 + handoff；行间发丝线（行内 `border-t`），hover 行底色，无常驻卡片边框。
- **Agent 首字头像与角色标签**：`src/console/agent-initial-avatar.tsx`（团队页 20/32px）与 `src/console/role-tag.tsx`（时间线 who 行 20px）共用同一身份体系——彩底正圆 + 深色首字，底色按 slug/toneKey 稳定取自身份色板（`--ident-1…6`，moebius-desktop-spec 6.6 采样，亮暗共用），同一角色全产品同色；头像自身保持装饰性，旁边必须保留可读名称。
- **主会话消息层级**：`operator-console.tsx` 的 `TimelineEntry`——主会话用户与 Agent 使用 24px 身份头像；Agent / system 正文左缩进 32px且最长 68ch。「你」的消息 who 行右对齐，正文包在右侧 `rounded-[10px] border bg-card` 气泡内（max-w 75%）。右侧子任务的 `SubtaskTimelineEntry` 保持 embedded 密度，不继承这些主会话参数。
- **主会话目录轨**：`src/console/conversation-relay-rail.tsx` + `conversation-relay-rail-model.ts`——只固定在当前根会话面板左缘；收起为共同左端对齐的紧凑短横线，用户使用前景色、Agent 使用稳定身份色，当前阅读位置以更长更强的横线突出。展开时面板从同一左锚点向右打开，用户事件留在固定主干，Agent 圆点按成员首次出现顺序进入内容驱动的泳道；成员色分支从前一可见事件平滑分叉、纵向穿过该成员回复并在后一可见事件并回，省略区两侧必须收束断开。hover band 在轨迹下方、整条事件行在轨迹上方作为唯一节点命中区；当前节点使用身份色描边环。预览 Popover 相对整个面板边缘保持固定间距并沿事件行纵向跟随，只显示可读成员名、时间与有限行原文。目录滚轮 / 方向键只浏览，点击、Enter 或 Space 后才定位主时间线；不得使用全宽等距散点、逐相邻事件 S 线、居中膨胀或邻近项金字塔，reduced-motion 必须即时呈现等价静态信息。
- **侧栏共享会话信息面**：`src/console/conversation-sidebar.tsx`——整个对话列表始终复用一个位于 rail 外侧的信息面 DOM；指针或键盘焦点切换行时只替换名称、文件夹和可用的真实分支，并以 150ms `transform` 沿纵轴跟随。信息面组合 `bg-sunken`、`border-line` 与包内 shadow 级别，不复制刻度轨、邻项缩放或金字塔形变；离开列表、打开菜单或弹层时收起，`prefers-reduced-motion` 下即时定位。
- **历史消息轻操作**：`operator-console.tsx` 的成功 Agent 历史消息——完整输出入口保持在正文下方原有左边界，使用 24px `FileText` 图标按钮；按钮绝对定位在消息间隙中，默认透明，整条消息 hover / focus-within 或按钮 focus-visible 时显示，不占常驻操作行、不移动到 who 行右侧，也不使用 `ghost` 文字按钮。
- **本地调试披露组**：`src/console/process-tab.tsx` + `process-event.tsx`——每次 attempt 以状态、计时、执行引擎、模型元数据和原始 run/thread/session 标识开头，常驻本地敏感信息提示，再按 provider 原生分区渲染 disclosure：Codex 使用 `SYSTEM_PROMPT` / `DEVELOPER_PROMPT` / `USER_INPUT`，Claude 使用 transcript 的 user / assistant / session metadata，Kimi 使用 system / turn / context / request；逐事件原文 disclosure 保留 provider 与协议类型。披露面只组合 `bg-card` / `bg-sunken` / `border-line`，原文使用可选择的等宽 `<pre>`；长内容默认折叠，HTML / Markdown / 终端控制字符只以转义文本呈现。token usage 使用中性 `Cpu` 图标；Codex reasoning 继续过滤，Claude/Kimi 原生文件中已持久化为可读事件的 thinking 使用中性 `Brain` 卡片，opaque / encrypted payload 不解密。
- **完整文件阅读面**：`src/console/file-source-view.tsx` + `workspace-file-view.tsx`——普通源码只显示一列当前行号与可选择的等宽原文，不继承 diff 的增删色、双行号或行 kind；目标行以 `border-accent`、`bg-sel` 和 `aria-current` 共同定位。完整 Markdown 在同一文件头用紧凑分段控件切换 Preview / 源码，选中态沿用 `bg-sel` + `text-accent`；工作空间外内容不进入该模式，只在独立有界预览中明确披露范围。
- **右侧辅助工作区**：`src/console/right-sidebar.tsx` + `right-sidebar-layout.ts`——以扣除左导航后的内容面计算 50% 默认宽度、双面 480px 下限和 960px 并排/覆盖边界；并排分隔线使用 1px `border-line` 与扩大的透明命中区，hover / drag / focus / 抵边只增强为 accent。开合遵循上方唯一空间动效例外，关闭开始即 inert 并保留最后内容到退场结束，不引入阴影、渐变、弹跳或内容缩放。
- **Agent 运行活动与时间**：`src/console/run-block.tsx` + `src/console/run-time.tsx`——who 行右侧常驻语义明确的「已进行」时长，下一行只保留最新一条安全活动并截断对象；终态改为「耗时」，完成时刻通过 title、键盘焦点与可访问名称提供。`main` 变体使用 24px 身份头像与 32px 正文缩进，`embedded` 保留原密度；活动记录不显示百分比、不轮播旧工具、不堆积工具日志；无稳定过程能力的执行引擎原位显示不可用说明，不渲染空入口。
- **主 / embedded composer**：`src/console/role-composer.tsx`——`main` 使用 14px card、10/12px 内间距、单行起步且最多 120px 的 textarea，并把附件、发送和主理人停止保持为 32px 方形操作；`embedded` 保留 76px 起步与右侧栏自己的可用宽度。两者只隔离视觉密度，不改变发送、停止、附件、mention、输入法或待发射规则。
- **属性面板头**：`src/console/session-context-header.tsx`——label（12px muted）在上、value（13px 510 + 14px 图标）在下。
- **分析对话入口面板**：`src/console/analysis-panel.tsx`——所在对话右上角的轻量入口面，只显示直接子分析对话的可读标题与必要的同名消歧；宽容器为 288px 并排面，窄容器覆盖所在对话而不改正文宽度。空、加载、失败与长列表都留在面板内部，条目只触发外层右侧栏唯一会话标签，不承载时间线、状态、摘要或管理操作。
- **运行项入口面板**：`src/console/managed-process-panel.tsx`——仅在当前会话存在托管进程或未确认的结束事实时占用 46px 顶栏，位于分析入口之前；单项显示名称与状态，多项显示数量。Popover 只展示服务端事实、loopback 打开入口、有限日志、停止与结束确认，不提供 restart、命令编辑或工作流编排；最后一项结束后保留到用户明确确认，确认后由 Radix 焦点回返顶栏触发器再移除入口。
- **状态 pill**：`src/ui/badge.tsx`（见状态语义表）。
- **裁决段**：`src/console/accept-card.tsx` 的 `DecisionSegment`——pass / failed pill，未选中项为中性描边 pill。
- **浮层**：`src/ui/dropdown-menu.tsx`、`src/ui/popover.tsx`——细边 + `rounded-md`（12px）+ `bg-sunken`，无阴影。
- **团队版本追溯与应用**：`src/console/agent-team-option.tsx`、`session-team-update-notice.tsx`、`agent-run-info-popover.tsx`、`agent-team-save-feedback.tsx`——团队选项用用途、来源、主 Agent 与可展开成员建立选择依据；composer 更新提示按定义/运行配置/团队信息保持独立中性行，但任一操作都应用完整版本；历史头像 Popover 只展示 run 冻结事实并通过只读 Dialog 延迟读取完整 `AGENT.md`。浮层沿用 Radix collision handling、视口边界与焦点回返，不显示内部摘要、路径、mtime 或 diff。
- **空状态**：`src/console/conversation-empty-state.tsx`——中性插画图标 + 短句邀请，无彩色引导。
- **需要修复面板**：`src/console/agent-team-detail.tsx`——危险事实使用红色图标与细边浅底，正文用普通语言列出不可用范围；修复动作保持 outline，只有“移除记录”等不可逆应用状态变更使用 danger 按钮，并在确认层明确磁盘文件不受影响。
- **AGENT.md 变化标记与时间线**：`src/console/agent-markdown-mention-editor.tsx`（`changeMarkers`）、`agent-markdown-revision-timeline.tsx`——变化段落左侧 2px 色条（`color-mix(in srgb, var(--accent) 50%, transparent)`：accent 是纯 CSS 变量，Tailwind 的 `accent/<n>` 透明度修饰不生成任何规则，`bg-accent/50` 会静默失效，色条必须以 color-mix 派生），色条所在的 12px 命中带常驻可 hover；来历署名与展开按钮默认 `opacity-0` 且指针不可达，只在 `group-hover` / `group-focus-within`（Tab 聚焦到展开按钮时）显形并恢复指针可达，展开按钮聚焦时带同色 40% ring，不常驻抢注意力；点击就地展开原文用 `bg-sunken` 块，不跳转、不开第二界面；时间线是纯列表，只有一句摘要 + 作者 + 相对时间，不渲染指纹、mtime 或逐行对比。段落切块只服务这里的呈现定位，不作为任何合并单位。
- **官方同步横幅与常驻入口**：`src/console/agent-team-detail.tsx`（`officialSyncBanner`）、`agent-teams-page.tsx`（`RecentOfficialSyncPanel`、团队首页“官方有新变化”标记）——横幅用 `border-l-2 border-accent/50 bg-sunken`，同一内容会在横幅关闭后原样出现在“更多”菜单的常驻入口里；首页标记复用既有 `TeamStatusBadge` 的中性描边样式，不新增色相。
- **侧边栏底部同步态**：`src/console/operator-console.tsx` 的 `SidebarAction`（`iconSpinning`、`tooltip`）——与“安装更新”共用同一插槽，进行中用 `LoaderCircle` + `animate-spin motion-reduce:animate-none`，完成态用中性 `CircleCheck`，不借用状态色相族表格之外的颜色。

## 生长机制

新组件必须组合上述令牌、状态语义与模式；确需破例或新增模式时，在同一个 change 里更新本文件对应章节，并在 PR 描述中说明判据。
