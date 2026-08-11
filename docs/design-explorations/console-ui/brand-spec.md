# Moebius 桌面端 — Brand Spec v1.0

来源:4 张参考稿(`refs/ref-dashboard.jpeg` / `ref-team.jpeg` / `ref-tasks.jpeg` / `ref-inbox.jpeg`),色值经像素采样提取,非猜测。

一句话系统:**近黑底色 + 中性灰层级 + 单一薰衣草紫数据点缀,状态用语义色药丸的低饱和深色效率工具。**

主题:**深色为默认**;浅色由深色镜像派生(见文末 Light theme),共用同一套令牌名,切换只靠 `[data-theme="light"]` 覆盖。

## Core tokens(OKLch / hex)

| Token | Value | 用途 |
|---|---|---|
| `--bg` | `oklch(0.173 0 90)` · `#101010` | 全局底(侧栏与主区同底,靠分隔线分区) |
| `--surface` | `oklch(0.205 0 90)` · `#171717` | 卡片、表格容器、搜索框 |
| `--raised` | `oklch(0.226 0 90)` · `#1c1c1c` | 卡片内嵌层、hover 起始 |
| `--fg` | `oklch(0.967 0 90)` · `#f4f4f4` | 主文字(不用纯白) |
| `--muted` | `oklch(0.709 0 90)` · `#a1a1a1` | 次级文字、图标 |
| `--faint` | `#6e6e6e` | 辅助/占位/chevron(深色值;浅色值见文末) |
| `--border` | `oklch(0.269 0 90)` · `#262626` | 分隔线、卡片描边(等价 rgba(255,255,255,.09)) |
| `--accent` | `oklch(0.743 0.161 302.6)` · `#c090ff` | 薰衣草紫:数据可视化、@提及、唯一品牌点缀 |

## Semantic(仅状态用,不做装饰)

| Token | Value | 用途 |
|---|---|---|
| `--success` | `oklch(0.791 0.245 143.5)` · `#2ee03a` | 完成、在线、正增长、负载 ≤95% 健康 |
| `--info` | `oklch(0.746 0.137 248)` · `#5fb3ff` | Pending、Medium 优先级、提示、负载 96–100% |
| `--amber` | `oklch(0.862 0.148 95)` · `#f0d050` | In Progress、注意 |
| `--orange` | `oklch(0.705 0.174 40.1)` · `#f77342` | 负载偏低的进度条、警示 |
| `--danger` | `oklch(0.626 0.239 25.2)` · `#f72332` | High 优先级、未读计数、超载(>100%) |

状态药丸 = 语义色文字 + 同色 8% 暗化底(`tint-*`):
`--tint-green #172c19` / `--tint-amber #2b2612` / `--tint-blue #19232d` / `--tint-red #321c1e`。

交互层:`--hover #242424`(行 hover、选中行)、`--active #2d2d2d`(Tab 选中、导航选中)。

## Component metrics(参考图实测,DPR≈3 换算为逻辑 px)

| 组件 | 度量 |
|---|---|
| 侧栏 | w 252 · 导航行 h40 · px12 · 图标 18 · 文字 14/500 · 行距 gap 4 · 选中 bg `--hover` r8 |
| 侧栏搜索 | h40 · r10 · 描边比分隔线亮一档(#2e2e2e)· 内嵌 kbd h22 r6 |
| 未读徽标 | Ø18 正圆 `--danger` 白字 10.5/600 |
| 页标题 | 28/600 -0.02em(指标大数字才用 32/600) |
| 药丸 Tab | h34 · r-full · px16 · 选中 bg `--active` |
| 下划线 Tab | h44 · 图标 16+gap8 · 选中 2px `--fg` 下划线 |
| 筛选 Chip | h34 · **r12(非全圆角)** · px14 · 描边 `--border` · chevron 16 `--faint` |
| 视图切换 seg | 容器 `--raised` r12 p3 · 按钮 h28 r9 · 选中 `--active` |
| 按钮 | h36 · **r10** · px16 · 13.5/510;主=白底黑字(衍生,参考稿未出现);次=描边+`--surface`;sm h30;icon-btn 36 r10 |
| 状态药丸 | h26 · r-full · px11 · 12.5/500 · 内置 12px 状态图标(半满=In Progress) |
| 表格 | 表头 h38 bg `--surface` 12.5 `--faint` · 行 h52 · 复选框 16 r5 选中反白 · 行分隔 1px |
| 成员/团队卡 | r16 · p20 · 负载条 h4 r2 · 内嵌当前任务 chip h28 描边 r-full |
| 指标卡 | r14 · p20 · min-h 118 · 大数字 32/600 tnum |
| Inbox 行 | p14/18 · 头像 Ø40 · 未读 Ø8 `--danger` 红点 |
| 角色头像(会话) | Ø24 正圆 · 6 色低饱和粉彩身份色板 + 深色字 `#101010` 12/590,按 slug/toneKey 哈希(FNV-1a mod 6 → `tone-0..5`)稳定取色、同一角色始终同色,亮暗主题共用:`#E8B4C8` 粉 · `#F0C9A0` 杏 · `#BCD9F7` 蓝 · `#B8E3D2` 绿 · `#D9C2F0` 紫 · `#E8D1A8` 米黄;「你」反色(`--fg` 底 `--bg` 字) |
| 消息目录轨 | 会话区左缘 44px 视口 · 行高收起 20 / 展开 32(`--relay-row-h` 变量,CSS 补间)· 默认态=角色色刻度(当前 24×3,其余 13×2 七成透明)· 悬浮展开宽度由内容决定 = 主干 14 + 泳道数 × 18 + 右留白 14(泳道极多时压缩间距、封顶 224px),不再随会话列宽插值;git-graph 式车道图:「你」=主干竖线(x=14,`--muted`)贯穿全程,成员线按首次出现左排(间距 18px 收敛),跟随接力棒分叉/并回:从他第一条消息的前一条消息节点叉出(谁递的话就从谁的节点分叉,如开发经理 @开发 → 开发线自开发经理节点叉出)、竖直穿过自己的圆点(角色身份色)、并回他最后一条消息的后一条消息节点(最后是结尾则以节点收尾=分支尖端),弯曲线两端竖直切线(SVG 纵向拉伸实现行距放大,`vector-effect` 保持线宽);圆点=所有消息(无菱形)、当前=描边环;点击滚动定位 + 1.2s 底色高亮;悬浮节点出 240px 预览卡(角色·时间·三行正文)并加重所属角色整条连线;行悬浮带为独立 `.relay-band` 底层,叠放层级 面板底 < 悬浮带(z1) < 连线(z2,始终清晰) < 行/节点(z3) < 预览卡(z6),`.relay-row:hover + .relay-band` 触发;评审钩子 `?relay=open` / `#relay=open` 强制展开,`?state=` / `#state=` 深链多状态;dev-bar 含「会话目录展开」状态(`#state=relay-open`,持久强制展开,新对话下自动回落到落地页验收) |
| 详情面板 | w 420–480 · 标题 21/600 · 标签列 110px 12.5 `--faint` |

## Type stacks

```css
--font-display: "Inter Tight", "Inter", -apple-system, "PingFang SC", sans-serif;
--font-body:    "Inter", -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
--font-mono:    "SF Mono", "SFMono-Regular", "JetBrains Mono", "Menlo", "Consolas", "DejaVu Sans Mono", "Liberation Mono", ui-monospace, monospace;
```

- 数字指标用 `font-feature-settings:"tnum"`;大数字 32px/600。
- 标题 ≥28px 用 `-0.02em` 字距;正文 14px/1.5;辅助 13px;Caption 12px/+0.02em。

## Posture rules(从参考稿观察)

1. **零阴影、零渐变**:层级全靠明度阶梯(#101010→#171717→#242424)+ 1px `--border`。
2. **侧栏与主区同底**:分区靠 1px 竖线和内容密度,不靠色块。
3. **紫只给数据**:sparkline、@提及、焦点态——每屏 ≤2 处,按钮主操作用白底黑字,不用紫。
4. **圆角分级**:卡片 12–16px,药丸/输入全圆角(full),头像正圆。
5. **状态即色彩语言**:语义色只出现在药丸、进度条、未读点、负载条,永不用于背景装饰。

## Light theme(`[data-theme="light"]`)

深色令牌名的镜像派生,已在 `app.css` 实现;所有文字/底色对经 WCAG 对比度校验(正文 ≥4.5:1)。

| Token | Value | 与深色的对应关系 |
|---|---|---|
| `--bg` | `oklch(0.985 0 90)` · `#fafafa` | 全局底(不用纯白) |
| `--surface` | `oklch(1 0 90)` · `#ffffff` | 卡片、表格容器(比 bg 亮一档,同深色逻辑) |
| `--raised` | `oklch(0.955 0 90)` · `#f0f0f0` | 嵌套层;白之上无法再升,嵌套/hover 改向灰走 |
| `--fg` | `oklch(0.21 0 90)` · `#181818` | 主文字(不用纯黑) |
| `--muted` | `oklch(0.5 0 90)` · `#636363` | 次级文字(5.8:1) |
| `--faint` | `oklch(0.545 0 90)` · `#707070` | 辅助/占位(4.95:1) |
| `--border` | `oklch(0.898 0 90)` · `#dddddd` | 分隔线(等价 rgba(0,0,0,.09)) |
| `--accent` | `oklch(0.52 0.161 302.6)` · `#7c4cb4` | 同色相加深,白底 5.9:1 |

交互层:`--hover #ededed` / `--active #e4e4e4` / `--fg-max #000000`(主按钮 hover 极值)。
搜索框描边由「亮一档」反转为「深一档」:`#cfcfcf`。

语义色整体加深至各自 tint 底上 ≥4.5:1;tint 由暗化底变为 12% 混白浅洗底:

| Token | Light value | tint |
|---|---|---|
| `--success` | `oklch(0.51 0.165 143.5)` · `#077c15` | `#eff3ef` |
| `--info` | `oklch(0.51 0.125 248)` · `#196aa9` | `#eff2f6` |
| `--amber` | `oklch(0.53 0.115 95)` · `#816a00` | `#f3f2ef` |
| `--orange` | `oklch(0.55 0.165 40.1)` · `#bd450f` | `#f8f0ef` |
| `--danger` | `oklch(0.535 0.21 25.2)` · `#cb1124` | `#f9eff0` |

浅色姿态规则(在深色 5 条之上修正):

1. **阶梯镜像**:`bg→surface` 仍向亮走(灰底白卡),但 `raised/hover/active` 改向灰走——层级方向感不变,零阴影零渐变不变。
2. **紫只给数据,但加深**:文字用法统一到 `#7c4cb4`,亮紫 `#c090ff` 仅留给深色;每屏 ≤2 处不变。
3. **药丸反转**:深色的「亮字暗底」变成「深字浅底」,色彩面积比不变。
4. **主按钮反转**:白底黑字 → 黑底白字(`--fg` 底 `--bg` 字),hover 到 `--fg-max`。

## 官网 / Marketing(`home-page.html`)

官网与 app 共用上方全部 token、字栈与语义色规则;以下是已确认的官网专属裁决(不回流 app):

1. **效果层解禁,但设预算**:液态玻璃卡(渐变描边 + 内高光 + blur)、金属流光标题(银白,非品牌紫、非模板青蓝)、hero 点阵与顶部光晕仅出现在官网;效果面积合计 <1%,app 内维持零阴影零渐变。
2. **紫的预算不变**:全页 ≤2 处,当前仅会话 mock 的 @提及 1 处。
3. **组件尺度上调**:主 CTA h44 r12 14.5/500(app 按钮 h36 r10 不变);正文 16/1.6;展示标题 `clamp(44px, 6.4vw, 84px)`。
4. **叙事手法**:1120px 版心 + 容器导轨线(≤768px 隐藏)、sticky 特性叙事(滚动交叉淡换)、滚动渐入、脉冲药丸;全部遵守 `prefers-reduced-motion`。

## TODO / Open questions

- [x] 宣言破格区已恢复(2026-07-27):紫缎带图 `assets/manifesto-ribbon.jpg` 上移至 hero 全幅背景(压暗渐变、底部渐隐入 `--bg`),宣言区还原为纯排版破格;点阵/光晕 hero 质感由缎带取代。氛围图(`assets/ambience-structure.jpg`)仍丢失,feature 2 视觉位现为团队 mock,待确认是否重新生成
- [ ] Linux 运行环境的等宽字体兜底:是否打包 JetBrains Mono webfont
- [ ] 官网浅色版未实现(浅色令牌目前只覆盖 app)
- [ ] 官网文案与链接全部为占位,待真实内容;mock 内负载比例与 diff 为示意数据,非真实指标
