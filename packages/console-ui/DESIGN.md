# console-ui 设计语言

本文件是 `@moebius/console-ui` 的包内设计语言事实源：新组件与组件修改必须组合这里记录的令牌、状态语义与模式，不得引入临时视觉值。引入本目录未收录的新模式时，必须在同一个 change 里回流更新本文件。全局原则见 `docs/product/prd.md`「视觉语言原则」，本文件是令牌与组件级的执行细则。

灵感来源（仅溯源，不复制其内容）：Linear 的产品界面（行结构、冷灰阶、字重层级、图标精度）与近黑底暗色 SaaS dashboard（状态 tinted pill、大圆角、可见描边卡片）。视觉参数以本文件与 `src/styles/tokens.css` 为唯一事实源（灰阶梯、零阴影零渐变、侧栏与主区同底、圆角分级），不再引用外部规范文件；以 `docs/product/prd.md` 为准的两条已登记裁决：accent 保持靛蓝 `#5E6AD2`（不采用薰衣草紫 `#c090ff`）、completed 保持中性灰（不采用亮绿 Done pill）。

## 令牌纪律

- 组件内禁止裸 hex / rgba 色值；一律走 Tailwind 语义工具类（`bg-canvas`、`text-ink`、`text-sub`、`text-hint`、`border-line`、`bg-hover`、`bg-sel`、`bg-accent`、`text-pass`、`text-danger` 等），这些类全部映射到 `src/styles/tokens.css` 的 CSS 变量。
- 新增令牌判据：同一视觉角色在 ≥2 个组件中出现，或需要亮暗双主题分别取值；否则用既有令牌近似。新增令牌必须亮暗双主题同时定义。
- 中性层为五档明度阶梯实色（暗色 `#101010 → #171717 → #1C1C1C → #242424 → #2D2D2D`，亮色 `#FAFAFA / #FFFFFF / #F0F0F0 / #EDEDED / #E4E4E4`）：`--canvas` 页面底、`--card` 卡面、`--sunken` 嵌套/输入面、`--hover` 悬停、`--sel` 选中；侧栏与主区同底（`--rail` = `--canvas`），分区只靠 1px `--line` 与内容密度。
- accent 双主题统一靛蓝 `#5E6AD2`；hover 一律向「更强存在感」方向走：亮色加深 `--accent-hover: #4B57C8`，暗色变亮 `--accent-hover: #828FFF`。
- 暗色画布近纯黑（`--canvas: #101010`）、卡面微亮（`--card: #171717`）、描边可见（`--line: #262626` 实色）；亮色为同结构镜像（灰底白卡，`bg→surface` 向亮走，`hover/sel` 向灰走）。
- 状态色相族令牌：`--status-{run,info,violet,neutral}-{fg,bg,line}` 及裁决 `--pass` / `--danger` 配套 tint，亮暗双主题成对定义；tint 底为实色（暗色如 `--status-run-bg: #2B2612`，亮色为 12% 浅洗底），fg 在其上满足正文对比度。
- 桌面窗口顶层 header 统一使用 `--window-header-height: 46px`；macOS 交通灯、sidebar 展开/折叠按钮和会话 sticky 标题都由该高度容器配合 `items-center` 自然居中，禁止为单个控件追加 `top`、`padding-top` 或 translate 补偿。
- 会话 sticky 标题、Agent 历史消息正文与主时间线活动 run 的角色名/实时正文使用同一条左边界；活动 run 的操作贴住同一正文列右边界。已有会话 composer、待发射区与新对话 composer 复用该列的 `840px` 最大宽度和 `px-8` 页面 gutter，窄窗一起收缩；右侧子任务 composer 保留自己的可用宽度。该正文列由 `conversation-layout.ts` 和宿主建立，通用 `RunBlock` 与 `RoleComposer` 不内置主时间线宽度。**用户消息是唯一的例外**：按聊天惯例走右泳道（who 行右对齐 + 右侧气泡），不占用左正文列。
- 主侧栏默认 252px，保留 220–360px 拖动边界；窗口控制行为 46px、品牌行 34px，其余可点击条目统一为 28px（应用导航、项目、会话、项目行内操作与底部命令）；项目名到首条会话保持 2px，同一项目的会话之间保持 2px，不同项目组之间保持 8px，会话标题左缩进 28px。窗口控制、品牌、应用导航和底部操作固定，只有项目列表纵向滚动；侧栏和主区共用 `bg-canvas`，只用 1px `border-line` 分区。
- 圆角直接使用 Tailwind 原生默认尺度，`tailwind.config.ts` 不覆盖 `borderRadius`：卡片、对话框与浮层使用 12px（`rounded-xl`），内嵌内容面与菜单项使用 8px（`rounded-lg`），控件、按钮、输入以及项目/会话行使用 6px（`rounded-md`），药丸与轻跳转使用 `rounded-full`、头像正圆；同一层级圆角必须一致。新代码只使用 `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-full` / `rounded-none`（结构性继承允许 `rounded-[inherit]`），禁止覆盖 Tailwind 圆角尺度或使用重复现有令牌的任意像素圆角。

## 排版

- 字体只保留两族：界面、标题和富文本统一使用自托管 Inter Variable（`font-sans`，CJK 回退 PingFang SC 等系统字体）；代码、路径、终端输出和机器标识使用 `font-mono`。不再设置 display 字体或标题专用字体族，标题层级由字号和 600 字重建立。
- 字重只使用两档，避免靠“稍微粗一点”制造含混层级：

  | 字重 | Tailwind | 用途 |
  | --- | --- | --- |
  | 400 | `font-normal` | 正文、说明、导航、标签、按钮、选中项与普通操作文案。选中态由背景、前景色或图标表达，不因 active 升字重。 |
  | 600 | `font-semibold` | 品牌、页面/弹窗/内容标题、富文本中的 `strong` / `b` 真正强调，以及头像里的单字符 fallback。项目名、分区标签、角色名、悬浮卡标题、状态标签和选中项仍使用 400。 |

  禁止使用 500、700+ 或任意字重值；Tailwind 中历史 `medium` / `bold` 等别名也只映射到 400 / 600，防止第三方内容产生第三档实际字重，但新代码不得继续使用这些别名。
- UI 字号只使用五档：

  | 角色 | 字号 / Tailwind | 用途 |
  | --- | --- | --- |
  | Meta | 11px / `text-meta` | 时间、计数、紧凑状态和代码辅助信息。 |
  | Caption | 12px / `text-xs` | 辅助标签、表头、字段说明。 |
  | Body | 13px / `text-sm` | 默认正文、导航和控件文案。 |
  | Section | 15px / `text-base` | 分区标题、对话标题和较强标签。 |
  | Page | 18px / `text-lg` | 页面级标题和主要空状态标题。 |

  Markdown 内容保留语义例外：H1 / H2 / H3 分别为 20 / 18 / 16px；这三档只属于用户内容渲染，普通 UI 不得借用 20px 或另造任意字号。字号表达结构，前景色表达优先级，背景表达交互状态，字重只表达真正强调。
- hover / focus / active 不改变字重，避免文字宽度变化和布局抖动；交互状态用前景色、背景色、描边或图标表达。
- 前景色按信息职责分三层，不能把“未选中”直接等同于“次要文字”：

  | 前景 | 用途 |
  | --- | --- |
  | `text-ink` | 正文、标题，以及用户需要直接识别和选择的默认操作标签：应用导航、会话标题、文件/文件夹名、标签页名、底部命令。选中态主要由 `bg-sel` 表达，默认态不得等到 hover 才变得清晰。 |
  | `text-sub` | 时间、路径、阶段、计数、状态说明、补充描述，以及随主标签出现的非必要图标；它必须依附于同屏的主信息，不能独自承担导航名称。 |
  | `text-hint` | placeholder、尚未激活的工具条和最低优先级提示；禁用态在既有前景上使用 opacity，不另造一档灰。 |

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

- 默认界面仍是零阴影零渐变：`--shadow-pop` 恒为 `none`，dropdown / popover / 对话框只靠 1px 描边与 `bg-sunken` 亮一档的底色分层。`OperatorConsole appearance="focused"` 是登记过的页面组合例外：主面板、composer 与排队浮岛只能使用 Tailwind 的 `shadow-panel` / `shadow-composer` / `shadow-pending` 命名令牌，不得在 Story 或组件里重新写投影值；只读悬浮信息面统一采用 shadcn 的 `border border-line shadow-md` 组合，暗色覆盖为 `shadow-none` 并改用更亮的 `--focused-floating-surface` 实色区分层级。仍禁止渐变（包括滚动淡出渐变）。
- 不设置组件库级全局 `:focus-visible` 样式；需要可视键盘焦点的控件由组件按交互语义局部声明。
- 动效只走令牌：`--dur-fast: 100ms`、`--dur: 150ms`、`--ease: cubic-bezier(0.25,0.46,0.45,0.94)`、入场 `--ease-enter: cubic-bezier(0.165,0.84,0.44,1)`；默认只做颜色过渡，不做位移缩放飞入。**显式动画浮层的入场 / 退场是第二条登记的空间动效例外**（2026-08-08 按产品决定加入）：`AnimatedPopoverContent` 入场是**容器自己长大**：`clip-path: inset()` 从「它被锚定的那个角」的零尺寸方块展开到全尺寸，时长 `--dur-overlay`，曲线 `--ease-spring`；关闭是同一段动画倒放，缩回同一个角，不是另换一段淡出。普通 `PopoverContent` 不带容器裁切或自定义 presence；只需跟随锚点、或已有局部内容动效的预览面使用普通版本，避免裁切边框与外投影。

**必须可打断且位置连续**：全过程由 Web Animations API 驱动，每次状态翻转都以元素**当前计算值**为起点新建动画。不要退回 CSS keyframes——CSS 动画只能从自己的首帧重启，实测中途反向会让面板从 39% 直接弹到全尺寸再淡出。代价是 presence 必须自己持有（Radix 靠 CSS `animationend` 决定卸载，WAAPI 不会触发它），所以 `AnimatedPopoverContent` 的 `Portal` 用 `forceMount`，`open` 经 context 传给动画内容层；jsdom 无 WAAPI、以及 `prefers-reduced-motion` 下直接落到终态。新挂载时计算值是 `none`，兜底必须跟方向走（开→收起态、关→展开态），否则入场会从展开动到展开、等于没播。

**退场不是入场的倒放**：临界阻尼弹簧的长尾倒过来播会变成「起步几乎不动、末尾撞停」——实测倒放到 240ms 时才走了 7.7%。退场走 `--ease` + `--dur-overlay-out`，第一帧就动。

**同组抢占**：`<Popover group="...">` 声明所属集合，一个组 = 一个「同时可能有多个实例」的组件（如每条消息的 run 信息浮层）。组内另一个打开时，其余成员的退场缩短到 `--dur-overlay-preempt`；已经在退场的用 `updatePlaybackRate` 原地提速，不重启。**只有被抢占的退场才快**：无人接管的关闭仍走全程，因为那时它就是屏幕上的主体。接管者的入场同样不压缩——它是新焦点。不要改成「排队」（等前一个退完再开）：那是纯延迟，切换会变迟钝。

用 clip 而不是 `scale`：scale 会把面板内容一起缩放，读成整体放大而不是「卡片长出来」。角的位置由 Radix **碰撞处理之后**的 `data-side` / `data-align` 两个轴共同决定（side 定贴哪条边、align 定靠那条边的哪一端），映射写在 `globals.css` 的 `[data-overlay-clip]` 规则里，翻转时自动跟着换角。**触发器本身不参与动画**：它是另一个元素，任何让它缩放或被当作动画起始快照的做法（例如与面板共用 `view-transition-name`）都会把它拉伸并盖住原点，已验证不可取。

`--ease-spring` 是**临界阻尼**弹簧（等价于 SwiftUI `spring(duration:0.36, bounce:0)`）采样成的 CSS `linear()`，定义与重算公式在 `tokens.css`。**它不违反上面的「禁止 bounce / elastic」**：bounce = 0 的弹簧数学上永不过冲，实测 scale 全程不超过 1.000。选弹簧而非贝塞尔的理由是速度剖面——贝塞尔的结束是硬停，弹簧起步有加速度、收尾像真实物体一样停住；WWDC23《Animate with springs》给的默认建议也是 bounce = 0，bounce > 40% 被明确点名为 UI 里应避免。仍然禁止：任何 bounce > 0 的弹簧、goo / clip-path morph、以及为动效引入 framer-motion 之类运行时（`linear()` 在 Electron 38 / Chromium 140 上原生可用，不需要）。右侧辅助工作区是登记的空间动效例外：并排布局只动画一条共享边界——右栏内容固定锚定右缘，外层轨道在 220ms 内从 `0` 展开到目标宽度并裁切内容，主面板由同一条 flex 边界自然收缩；不得让主面板和右栏各自计算、各自动画。覆盖布局只沿右缘位移。中途反向从当前进度继续，内容不得缩放，响应式布局切换不得追加开关动画，`prefers-reduced-motion` 下立即完成。禁止 bounce / elastic 曲线；按钮按下用 `active:scale-[0.98]`，不做更夸张的形变。持续加载 pulse 必须在 `prefers-reduced-motion: reduce` 下取消动画并保留等价静态骨架。
- Card 维持无默认阴影的中性面：可见细边、使用 Tailwind 原生 `rounded-xl`（12px），不再维护包级圆角基线变量。

## 组件模式目录

- **inbox 行**：`src/console/agent-message.tsx`——32px 圆形角色头像（右下角 15px stage 角标）+ 行 1（角色名 400 + stage muted + 右侧状态图标与 tnum 时间）+ 行 2 结论 + 行 3 箭头 + handoff；行间发丝线（行内 `border-t`），hover 行底色，无常驻卡片边框。
- **Agent 画像与角色标签**：`src/console/agent-portrait.tsx`（团队页 20/28/32px）与 `src/console/role-tag.tsx`（时间线 who 行 20px）共用同一身份体系——36 张预生成的拟人猫画像组成固定池，按 slug 稳定哈希取脸，底色按 slug 另取一套独立哈希从身份色板（`--ident-1…6`）取色（两套哈希必须互不整除，否则脸与色绑死），同一角色全产品同脸同色；画像占比已烘焙进素材（主体宽 86%、顶部留白 7%），UI 只负责底色与裁切形状——个体用正圆、团队用 `rounded-md` 圆角方（容器与个体的形状区分）；「你」是对话里唯一的人，保持首字而非画像；画像自身 `aria-hidden`，旁边必须保留可读名称。画像素材位于 `src/assets/portraits/`，扩容或换风格走 `.claude/skills/generate-avatar-set/`（跨批风格一致与占比烘焙都有既定做法，别逐张重画）。
- **画像选择器**：`src/console/agent-portrait-picker.tsx`——触发器就是当前成员的画像本身，不加独立按钮；popover 内 6×6 平铺整池，**每个候选都用该成员现有的身份色渲染**（底色不可选，中性底色挑完再上色会让一半候选是假预览）。选中项用 `border-accent` 环，roving tabindex + 方向键把 36 个候选收成一个 tab stop（`role="radiogroup"` / `role="radio"`）；**选中与 roving 焦点必须同移**，否则屏上同时亮两个 accent 圈，方向键还会从打开时那一格续走。面内顶部居中常驻 `preview` 档（80px）画像 + 其下角色名的纵向组，显示该成员当前的样子（含引擎角标）；**选中不关闭浮层**，预览原地更新，用户才能连着比较几个候选，点选即关会让人只能在做完选择之后看清一张。候选本身恒定 40px（六列 352px 面：列宽 48px − 2px 选中环 = 44px 内径，给 40px 的脸留出两侧各 2px；再挤下去环就贴死在脸上，读起来变成粗描边而不是选中），28px 下画像风格会直接失效（见 `.claude/skills/generate-avatar-set/`）；再往上的可读性交给这个常驻预览，不用 hover 放大——预览对指针、键盘、触摸一视同仁，且选完仍在。格子用 `aspect-square w-full` 跟随栅格列宽，不写死宽度，否则列宽一变就溢出。选中默认那张时回调 `null` 而不是它的 id，否则「跟随默认」会被冻成一次显式选择——但这个区别只存在于存储层：**不做「恢复默认」按钮，也不给任何一格标注「默认」**，默认那张就在候选里，而「显式选过 / 跟随默认」用户看不见。面内也不写画像的设计意图，那是给我们自己看的。存的是稳定 id 不是下标——扩池会让下标整体错位；读到池里不存在的 id 时回落默认而不是渲染空框。
- **执行引擎标识**：`src/console/provider-mark.tsx`——四种引擎（codex / claude / kimi / pi+provider）的 provider 图形，作为角标由 `AgentPortrait` 按尺寸档位自动渲染，调用点只传 `engine`，不手工定位。图形一律 `aria-hidden`：给它可访问名会折进容器的可访问名，SVG `<title>` 还会计入 `textContent`。图形来自 models.dev（MIT），但商标属各厂商，仅用于标示某个 Agent 运行在哪个引擎上，NEVER 当作品质或背书标记。**会话时间线一侧的角标依赖 desktop renderer 在构造 `memberIdentities` 时填入 `engine` 字段**；未填时不报错，只是不显示。
- **主会话消息层级**：`operator-console.tsx` 的 `TimelineEntry`——主会话用户与 Agent 使用 24px 身份头像；Agent / system 正文左缩进 32px，占满 840px 内容列（68ch 限宽于 2026-08-06 按产品决定移除）。「你」的消息 who 行右对齐，正文包在右侧 `rounded-lg border bg-card` 气泡内（max-w 75%）。右侧子任务的 `SubtaskTimelineEntry` 保持 embedded 密度，不继承这些主会话参数。
- **主会话目录轨**：`src/console/conversation-relay-rail.tsx` + `conversation-relay-rail-model.ts`——只固定在当前根会话面板左缘；收起为共同左端对齐的紧凑短横线，用户使用前景色、Agent 使用稳定身份色，当前阅读位置以更长更强的横线突出。展开时面板从同一左锚点向右打开，用户事件留在固定主干，Agent 圆点按成员首次出现顺序进入内容驱动的泳道；成员色分支从前一可见事件平滑分叉、纵向穿过该成员回复并在后一可见事件并回，省略区两侧必须收束断开。hover band 在轨迹下方、整条事件行在轨迹上方作为唯一节点命中区；当前节点使用身份色描边环。省略行不选择事件，但属于轨道整体的 hover 保持区：关闭计时只由轨道整体离开触发，不得由内部事件行之间的移动触发。预览 Popover 相对整个面板边缘保持固定间距并沿事件行纵向跟随，只显示可读成员名、时间与有限行原文。外层测量壳在 `useLayoutEffect` 取得首个正高度之前不挂载 nav、Anchor 或 Popover；Anchor 是测量壳下与动画 nav 平级的稳定定位层，始终按最终展开 `stageTop` 与行高计算，首个可见几何因此就是最终几何，ResizeObserver 只驱动后续真实尺寸变化。目录滚轮 / 方向键只浏览，点击、Enter 或 Space 后才定位主时间线；不得使用全宽等距散点、逐相邻事件 S 线、居中膨胀或邻近项金字塔，reduced-motion 必须即时呈现等价静态信息。窄容器下消息列与输入框左缘固定让出收起态目录轨（56px = 12px 内缩 + 44px 收起视口），展开面板以悬浮覆盖层呈现（z-index 高于正文列），正文、标题、输入框位置不随展开变化。
- **侧栏共享会话信息面**：`src/console/conversation-sidebar.tsx`——整个对话列表始终复用一个位于 rail 外侧的信息面 DOM；指针或键盘焦点切换行时只替换名称、文件夹和可用的真实分支，并以 150ms `transform` 沿纵轴跟随。信息面组合 `bg-sunken`、`border-line` 与包内 shadow 级别，不复制刻度轨、邻项缩放或金字塔形变；离开列表、打开菜单或弹层时收起，`prefers-reduced-motion` 下即时定位。
- **一条消息只有一条左边界**：画像占左槽（24px + 8px 间距 = 32px），**名字、正文、事故说明、工具条图标的视觉左缘一律落在 32px**。两个易错点：图标按钮把 14px 图标居中在 24px 盒子里，视觉左缘会右移 5px，需用负外边距抵掉；把画像包进 `<button>` 时按钮必须是 `inline-flex`，默认的 block 会按行高留出下沿空隙、把画像顶到盒子上沿，看起来比同行文字高一截。
- **消息工具条**：`message-toolbar.tsx`。Agent 历史消息在正文下方、与正文同一左边界挂一条 24px 高的工具条：动作一律是图标按钮 + tooltip（不用文字按钮，不铺满整行），默认透明，整条消息 hover / focus-within 或按钮 focus-visible 时浮出。
- **事故说明与动作分离**：出了事只加**一行**事故说明（`incident-card.tsx` 的 `IncidentNotice`：`bg-sunken` 圆角、按内容宽度、有色警告图标 + 状态名 + 诊断），它**只陈述事实、不带任何按钮**。**每条终局记录都有主人和表头**：认得成员就用成员表头（画像 + 名字），认不出就落到既有的「系统提示」表头（无画像）——绝不让一条记录既没身份、又不缩进地漂在时间线上。因此**耗时恰好出现在表头一处**（`RunTime` 的 `completed` 态：**时长留在表头**，紧跟成员名——运行中的「已进行 mm:ss」与已完成的「耗时 mm:ss」同一位置，不因运行状态改成右对齐；**墙钟时刻放在工具条末尾**、最后一个动作之后，**常驻可见**、压到最低强度——工具条里的内容一律看得见但安静，没有只靠 hover 才存在的信息（看不见的完成时刻等于丢失）。跑过的记录写「完成于 …」，从未启动的写「触发于 …」：任何时刻都必须自带名头，光一串数字读者认不出说的是什么）。**时刻也只出现一次**：有运行时间就由 `RunTime` 表达，没有（用户消息、启动前就失败的记录）才退回 hover 显示的消息时间戳，二者互斥。，事故行不重复。正文一律 `pl-8` 与其它消息对齐。所有动作——查看的（完整输出）、重试、更多操作，以及失败特有的恢复项（换执行配置、迁移会话、前往设置）——统一回到消息底部那条图标工具条，**每条 Agent 消息位置一致、一律图标 + tooltip**，成功、失败、用户停止、运行中都是同一个形状。**「更多操作」也在工具条里**，不再用表头 `ml-auto` 或绝对定位另起一套 hover 机制。不要为一个两个字的状态撑出整宽卡片，也不要让同一种情形因结束方式不同而有两种布局。
- **本地调试披露组**：`src/console/process-tab.tsx` + `process-event.tsx`——每次 attempt 以状态、计时、执行引擎、模型元数据和原始 run/thread/session 标识开头，常驻本地敏感信息提示，再按 provider 原生分区渲染 disclosure：Codex 使用 `SYSTEM_PROMPT` / `DEVELOPER_PROMPT` / `USER_INPUT`，Claude 使用 transcript 的 user / assistant / session metadata，Kimi 使用 system / turn / context / request；逐事件原文 disclosure 保留 provider 与协议类型。披露面只组合 `bg-card` / `bg-sunken` / `border-line`，原文使用可选择的等宽 `<pre>`；长内容默认折叠，HTML / Markdown / 终端控制字符只以转义文本呈现。token usage 使用中性 `Cpu` 图标；Codex reasoning 继续过滤，Claude/Kimi 原生文件中已持久化为可读事件的 thinking 使用中性 `Brain` 卡片，opaque / encrypted payload 不解密。
- **完整文件阅读面**：`src/console/file-source-view.tsx` + `workspace-file-view.tsx`——普通源码只显示一列当前行号与可选择的等宽原文，不继承 diff 的增删色、双行号或行 kind；目标行以 `border-accent`、`bg-sel` 和 `aria-current` 共同定位。完整 Markdown 在同一文件头用紧凑分段控件切换 Preview / 源码，选中态沿用 `bg-sel` + `text-accent`；工作空间外内容不进入该模式，只在独立有界预览中明确披露范围。
- **右侧辅助工作区**：`src/console/right-sidebar.tsx` + `right-sidebar-layout.ts`——以扣除左导航后的内容面计算 50% 默认宽度、双面 480px 下限和 960px 并排/覆盖边界；并排分隔线使用 1px `border-line` 与扩大的透明命中区，hover / drag / focus / 抵边只增强为 accent。开合遵循上方唯一空间动效例外，关闭开始即 inert 并保留最后内容到退场结束，不引入阴影、渐变、弹跳或内容缩放。
- **Agent 运行活动与时间**：`src/console/run-block.tsx` + `src/console/run-time.tsx`——who 行右侧常驻语义明确的「已进行」时长，下一行只保留最新一条安全活动并截断对象；终态改为「耗时」，完成时刻通过 title、键盘焦点与可访问名称提供。`main` 变体使用 24px 身份头像与 32px 正文缩进，`embedded` 保留原密度；活动记录不显示百分比、不轮播旧工具、不堆积工具日志；无稳定过程能力的执行引擎原位显示不可用说明，不渲染空入口。
- **主 / embedded composer**：`src/console/role-composer.tsx`——`main` 使用 `rounded-xl` card、10/12px 内间距、单行起步且最多 120px 的 textarea，并把附件、发送和主理人停止保持为 32px 方形操作；`embedded` 保留 76px 起步与右侧栏自己的可用宽度。两者只隔离视觉密度，不改变发送、停止、附件、mention、输入法或待发射规则。
- **属性面板头**：`src/console/session-context-header.tsx`——label（12px muted）在上、value（13px normal + 14px 图标）在下。
- **分析对话入口面板**：`src/console/analysis-panel.tsx`——所在对话右上角的轻量入口面，只显示直接子分析对话的可读标题与必要的同名消歧；宽容器为 288px 并排面，窄容器覆盖所在对话而不改正文宽度。空、加载、失败与长列表都留在面板内部，条目只触发外层右侧栏唯一会话标签，不承载时间线、状态、摘要或管理操作。
- **运行项入口面板**：`src/console/managed-process-panel.tsx`——仅在当前会话存在托管进程或未确认的结束事实时占用 46px 顶栏，位于分析入口之前；单项显示名称与状态，多项显示数量。Popover 只展示服务端事实、loopback 打开入口、有限日志、停止与结束确认，不提供 restart、命令编辑或工作流编排；最后一项结束后保留到用户明确确认，确认后由 Radix 焦点回返顶栏触发器再移除入口。
- **状态 pill**：`src/ui/badge.tsx`（见状态语义表）。
- **裁决段**：`src/console/accept-card.tsx` 的 `DecisionSegment`——pass / failed pill，未选中项为中性描边 pill。
- **浮层**：`src/ui/dropdown-menu.tsx`、`src/ui/popover.tsx`——细边 + `rounded-xl`（12px）+ `bg-sunken`，无阴影。基础 `PopoverContent` 保持普通 Radix/shadcn 语义，不附加空间动效；明确需要从锚点生长的场景使用 `AnimatedPopoverContent`，其入场 / 退场见动效红线里登记的浮层例外。动画内容层的锚点取 Radix **碰撞处理之后**的 `data-side` / `data-align`，贴边翻转时生长方向自动跟着翻。单个浮层不得再自带第三套容器动效。不引入 framer-motion / Animate UI：那类库给的是弹簧**运行时**，其真正不可替代的能力是中途打断时保留速度并重定向目标——那对拖拽和手势有意义，对一个离散开合的浮层没有；而弹簧的曲线形状用 CSS `linear()` 就能精确表达。顺带一提 Animate UI popover 的默认 `stiffness: 300, damping: 25` 阻尼比约 0.72，是会过冲的，比苹果自己的默认更弹。
- **团队版本追溯与应用**：`src/console/agent-team-option.tsx`、`session-team-update-notice.tsx`、`agent-run-info-popover.tsx`、`agent-team-save-feedback.tsx`——团队选项用用途、来源、主 Agent 与可展开成员建立选择依据；composer 更新提示按定义/运行配置/团队信息保持独立中性行，但任一操作都应用完整版本；历史头像 Popover 只展示 run 冻结事实并通过只读 Dialog 延迟读取完整 `AGENT.md`。浮层沿用 Radix collision handling、视口边界与焦点回返，不显示内部摘要、路径、mtime 或 diff。
- **空状态**：`src/console/conversation-empty-state.tsx`——中性插画图标 + 短句邀请，无彩色引导。
- **纵向节奏**：间距是在说「哪些东西属于同一件事」，所以必须是一把尺子，不是一处一处各自估的数。团队详情页用的这把尺子（由紧到松）：6px 面包屑→标题、8px 一组表单内的字段之间（名称→描述）、12px 小标题→它领起的内容、20px 同一段落内的块之间（成员条→成员面板、成员身份→运行配置）、32px 段与段之间。**段内的空隙一旦大于段间的空隙，层级就反了**——这正是「没有呼吸感」的成因，不是空得不够。只有条件渲染内容的行必须带 `empty:hidden`：它塌成 0 高时 margin 不会跟着塌，卡片会凭空多出一截底部内边距。
- **页面吸顶页头**：`src/console/agent-team-detail.tsx` 的 `<header>`——只承载返回、页面标题与页面级操作，描述之类的正文留在滚动区。吸住时页头的底板必须向上延伸盖满滚动容器的顶部留白（`--page-inset-top`，由 `agent-teams-page.tsx` 声明），否则正文会从页头上方继续滚过去，读成一块浮空的板子；底板是不透明纯色，不用渐变淡出（见零阴影零渐变红线）。下缘发丝线只在真的吸住时出现，用 `--dur` 色彩过渡淡入，不做位移或高度动画——页头高度全程恒定，任何「吸住就压缩」的做法都会在吸住那一刻把下方正文顶掉一截。是否吸住由页头静态位置上的零高哨兵与页头自身的位置差判定（`useHeaderPinned`），不用滚动阈值：页头之上有多少东西由宿主页面决定，组件不知道。
- **需要修复面板**：`src/console/agent-team-detail.tsx`——危险事实使用红色图标与细边浅底，正文用普通语言列出不可用范围；修复动作保持 outline，只有“移除记录”等不可逆应用状态变更使用 danger 按钮，并在确认层明确磁盘文件不受影响。

## 生长机制

新组件必须组合上述令牌、状态语义与模式；确需破例或新增模式时，在同一个 change 里更新本文件对应章节，并在 PR 描述中说明判据。
