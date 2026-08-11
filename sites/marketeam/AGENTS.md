# marketeam 目录说明

本目录包含正式营销页、视觉样张和隔离的页面实验。

## 正式文件

- `index.html`：当前正式营销页的**英文版**，站点根路径与默认语言；2026-07-29 经用户明确确认，由 `sites/marketeam/design-refs/home-page.html` 提升为深色工作台首页，并接入公开 GitHub 仓库与 Releases 下载；2026-08-08 转为英文规范页。
- `zh/index.html`：同一页面的**中文版**，路径 `/zh/`。
- `assets/preview-center-en.png` / `assets/preview-center.png`：英文页与中文页各自的首屏产品预览截图。英文那张的复现配方在 `docs/design-explorations/marketing-site/preview-center-en/`。
- `rebrand-narrative-plan.md`：2026-07-30 品牌与叙事改版方案（待评审）。诊断两层病灶（无可占有品牌资产、无情绪叙事），决策走风格化不拟人路线（Leader Agent 固定词 + 「欲望开场、对照收尾」叙事线 + 战吼口号；旧世界对照按参照站实证放页面后段作情绪高潮，不用痛开场）；视觉签名不由文字拍板，列了三个候选方向（首选角色色板系统），由样张同视口截图对比决出。名字故事只以文案存在，明确不做环形/缎带/∞ 字面隐喻图形。实施须按该文档「实施拆分」先出样张，评审收敛前不改 `index.html`。
- `index-pre-atlas.html`：Atlas 提升前的正式营销页归档，只用于回看和差异比较，不作为部署入口。
- `DEPLOY.md`：静态站点部署说明。

### 双语言版本：两页必须同改（2026-08-08）

`index.html` 与 `zh/index.html` 是同一份设计的两个语言版本，允许的差异只有：本语言文案、
`<html lang>`、`hreflang` 与语言控件的当前项、资源相对深度（`./assets/` vs `../assets/`）、
首屏预览截图和 `<head>` 里的语言落点脚本。**CSS 与主脚本必须逐字一致**，改任何一页都要同步
另一页；校验命令和逐语言的上线检查在 `DEPLOY.md`。

语言策略：英文是默认语言，根路径首访按 `navigator.language` 推断，中文则替换跳转到 `/zh/`；
显式选择记在 `localStorage['moebius-site-lang']` 并优先于浏览器语言；`/zh/` 单向不反跳，
让分享出去的中文链接对任何访客都打开中文。这条不许改成服务端协商或托管平台重定向规则
（`marketing-site` 不引入服务端进程，部署平台也未最终确定）。

本目录下其余 `index-*.html` / `style*.html` 样张仍是单语言实验稿，不需要跟着做双语。

### 深色工作台首页正式收敛（2026-07-29）

设计参考 HTML 保留在 `sites/marketeam/design-refs/` 作为来源锚点；正式 `index.html` 在其基础上接入生产品牌资产、GitHub 仓库、Releases 与可降级的最新 Apple Silicon DMG 解析。`index-field-atlas-a31f.html` 和 `style-atlas-a31f.html` 只保留为历史设计参考，不再代表正式入口。

## 品牌叙事样张（2026-07-30）

按 `rebrand-narrative-plan.md` 产出的两份候选样张，从当时的正式 `index.html` 复制。二者共享同一条新叙事线（欲望开场 → 宣言 → 机制 → 信任 → 对照高潮与名字故事 → 战吼）与同一套新文案（首屏副标题去掉规格上不成立的「可回退」、功能区标题改收益句、新增信任区与对照高潮区、徽章显示真实 Releases 版本号），首屏缎带背景均已删除以隔离视觉变量。不是生产入口，评审收敛前不反向合并进 `index.html`。

- `index-loop-narrative-be3c.html`：候选 A · 角色色板系统。近单色深底，唯一彩色声部来自 console 同源的六色粉彩身份色（`--ident-0…5`）：品牌标旁六色点行、标题第二行六色渐变、分节与信任条目色点、Leader Agent 紫色标；功能演示卡由着色器网格边框改为细线扁平边框。视觉方差中、动效低、密度中。
- `index-loop-narrative-f593.html`：候选 D · 团队群像 v2 · 几何剪影（当前主推，取代候选 C 的圆角色块风格）。用户判定 C 的角色只有颜色差异没有剪影差异（「六个小土豆」）。D 的角色资产 `assets/team-cast-2.png` 给每个成员专属几何剪影（粉圆、杏方、蓝三角、戴领带的紫五边形 Leader Agent、绿拱、米黄六边），颜色 × 形状双编码；形状系统贯穿全站标记（品牌标形状行、分节标、信任条目、Leader 标记均用对应成员形状），首屏重构为「指令气泡 → 群像 → 已开工 → 下载」的团队主场。资产背景像素校准阈值须低于腿部灰度（约 #2c2c2c），否则会误删细节。D 已含完整社交分享 head（OG/Twitter/image_src，主图 `assets/og-image-1200x630-20260730.png` 由群像合成，命名带日期便于换名刷缓存）；head 中 `__MOEBIUS_DOMAIN__` 是占位符，**收敛部署前必须整组替换为正式 HTTPS 域名**，icon 组（ico/manifest/带日期命名）按 write-social-preview-head 清单在收敛时补齐。
- `index-loop-narrative-1101.html`：候选 E · 微缩指挥室（广域风格探索第一点，2026-07-30）。资产 `assets/team-diorama.png`：等距俯瞰的微缩办公室，六张工位各自亮一位成员的身份色、紫色主位居中升起面向共享进度大屏，深夜办公氛围直接画出「老板俯瞰团队 / 你不在他们也在干活」。页面骨架同候选 A（色板纪律），首屏场景与 D 同构（指令气泡 → 场景 → 已开工 → 下载）以隔离风格变量。三维渲染资产的底色校准只处理 max<20 的纯背景像素，勿动场景内暗部。
- `index-loop-narrative-8a2c.html`：候选 F · 任务控制中心（广域风格探索第二点，2026-07-30）。资产 `assets/team-mission.png`：七十年代任务控制中心体裁——六台各亮一位成员身份色的复古控制台面向巨大弧形任务大屏（大屏只有抽象图形无文字），紫色台居中升起为 Leader Agent；剪影操作员、荧光屏氛围，把「指挥中心」按字面画出。页面骨架与场景结构同 E，隔离风格变量。
- `index-loop-narrative-2ef2.html`：候选 H · 像素组队（广域风格探索第四点，2026-07-30，资产 `assets/team-pixel.png`）。与 G 一同因目标用户澄清降为数据点：目标用户是全世界享用 AI 提效的普通专业者而非极客，像素属游戏亚文化编码。
- `assets/vignette-leader.png`：E 方向深化的派生验证——同一微缩世界切出的 Leader Agent 单工位岛特写，证明 E 可派生出成员头像/分区插图/分享图素材，「一张画难系统化」的短板有解。
- `index-loop-narrative-cf35.html`：候选 G · 水墨长卷（广域风格探索第三点，2026-07-30；**已被用户否决**——太丑 + 文化特定与全球目标用户不符，保留仅作探索记录）。资产 `assets/team-ink-scroll.png`：浮在暗色页面上的水墨手卷，六位各佩一色淡彩的幕僚在书案前工作、居中紫带者面向众人为 Leader Agent，松枝远山朱印。场景结构同 E/F，但场景说明句随体裁有意偏离为「听到了。运筹于一次对话,决胜于千里之外。」（其余候选保持统一句，该偏离是 G 方向论点的一部分）。
- `index-loop-narrative-a9b6.html`：候选 C · 团队群像 v1（圆角色块，已被 D 取代，保留作对照）。在候选 A 骨架上加入生成式角色资产 `assets/team-cast.png`（六色身份色板人格化为六个极简几何成员，身份紫 Leader Agent 居中站前；背景像素已校准为页面底色 #101010），首屏 CTA 后新增「你的一句话 + 听见的团队」场景（右对齐指令气泡 + 群像 + 「听到了。Leader Agent 和整支团队,已经开工。」）。修订理由与资产小尺寸检验要求见 `rebrand-narrative-plan.md` 方向修订节。
- `index-loop-narrative-2e1d.html`：候选 B · 中文排印声部。标题声部换 Noto Serif SC 衬线（首屏、宣言、功能、信任、高潮、行动区），分节标改汉字序号（壹/贰/叁），名字故事用衬线文学声部；点缀色与其余视觉保持原样。视觉方差中、动效低、密度中。

两份样张相对正式页共同修复：390px 下导航下载按钮换行溢出（隐藏 GitHub 幽灵链接 + 按钮禁换行 + 首屏按钮组允许折行）。该修复已于 2026-08-08 随双语言改版带回两个正式页，并顺带压掉了 320–360px 的溢出（收窄移动端 gutter、语言控件收成图标态）。

## 去框实验（2026-07-18）

下面三个文件都从当时的正式 `index.html`（现归档为 `index-pre-atlas.html`）复制，专门验证“减少闭合容器、改用排版与留白建立层级”是否可行。它们不是生产入口，不替代当前 `index.html`，也不应被发布流程引用。

- `index-cardless-editorial.html`：开放式编辑排版。重点用编号、标题、顶线、留白和普通列表代替卡片。
- `index-cardless-rulebook.html`：单线规则书。重点用横向规则、列对齐和少量背景带组织内容。
- `index-cardless-field.html`：空间接力场。重点用宽窄错位、大留白和连续叙事场建立节奏。

### 当时评审结论（已由正式收敛取代）

`index-cardless-field.html`（方案 C）当时评价为“方向不错”，并成为后续收敛的优先参考。它没有把卡片简单替换成更多分隔线，而是用全宽色场、宽窄错位、显著留白、连续的接力叙事和更强的文字层级建立关系；闭合边界只留给过程底单、终端、聊天窗口和首屏中心作品等真实对象。该阶段尚未修改正式入口；最终由上方 Relay Atlas 正式收敛结论取代。

## 巧思实验（2026-07-18 第二轮）

对方案 C 的反思：去框只做了减法，没有做加法——整页只剩令牌与排版纪律，缺少工艺细节（小巧思）。下面三个文件都从 `index-cardless-field.html` 复制，各验证一条"加法"路线。文件名带短 uuid 以避免与同目录其他工作冲突；同样不是生产入口，不替代 `index.html`。

- `index-field-craft-af94.html`：工艺细节。自定义标题标记、页边注、底单印刷级细节、有内容的 hover 状态、光学修正。方法来源：Anthropic frontend-design skill。
- `index-field-motion-16e9.html`：动效叙事。动效与语义绑定——通过/退回/拍板各有不同的入场性格，线条按滚动书写，底单展开如展纸。方法来源：Emil Kowalski + Vercel web-design-guidelines。
- `index-field-editorial-70c1.html`：版式张力。引入衬线对比声部、更大胆的字号与色场（含深色段落）、不对称版式、台账划线纸材质。方法来源：OpenAI frontend skill。

同一轮还保留三份从 `index-cardless-field.html` 复制的对照样案，用来验证“巧思应该以多高的视觉方差进入页面”。它们同样不是生产入口：

- `index-field-signal.html`：信号花园（低方差）。用页顶阅读进度、宽屏章节侧轨、当前事件强调和局部状态反馈，让留白承担定位作用；适合验证在不改变原构图时，少量有语义的微细节是否已经足够。
- `index-field-editorial.html`：运行档案（高方差）。把页面重构为一份可阅读的 operating dossier，用强编辑封面、经手权登记、跨栏章号、校样线和更强的底单对象形成产品独有的视觉记忆；适合验证“页面本身就是证据档案”这一 signature。
- `index-field-relay.html`：接力控制台（中高方差）。用真实阅读进度、章节接力轨、责任反差色场、接力状态文字和底单证据反馈，把“推进 / 验收 / 返工 / 拍板”做成贯穿全页的控制信号；适合验证品牌表达和产品机制可否共用一套视觉语言。

三案共同约束：保留正式页文案、DOM 语义、核心 JS、状态色语义、键盘可用性、reduced-motion、移动端纵向阅读、无横向滚动；不加回卡片盒；不做字面隐喻视觉。收敛前不反向合并进 `index.html` 或 `index-cardless-field.html`。

### 外部方法来源

- [OpenAI frontend skill](https://github.com/openai/skills/blob/main/skills/.curated/frontend-skill/SKILL.md)：采用“默认无卡片，先用 section、columns、lists、dividers、留白和对比”的组合原则。
- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)：采用“结构必须编码真实信息”的原则，让阶段编号、错位和色场分别表达顺序、接力与责任变化，而不是纯装饰。
- [Emil Kowalski apple-design](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md)：采用克制、清晰层级和先做可操作原型再复查的思路。
- [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md)：用于复核响应式、键盘焦点、动效降级和界面基础规则。
- [Impeccable](https://github.com/pbakaus/impeccable/blob/main/skill/SKILL.md)：补足 `shape → craft → critique / polish` 的浏览器复盘闭环；规则合规不等于页面已有设计记忆点。
- [Taste Skill v2](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md)：在开工前显式声明视觉方差、动效密度与信息密度，避免多个方案只是换色后的同一模板。
- [Emil Kowalski emil-design-eng](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)：用于判断哪些高频交互值得增加即时、可中断且只服务状态变化的微动效。

### 后续视觉实验的最小闭环

反卡片、留白和排版纪律只能保证页面不过度模板化，不能自动产生设计感。后续每个视觉实验在复制源文件后，必须先写清一条 visual thesis、一个只有本产品成立的 signature，以及 `VARIANCE / MOTION / DENSITY` 三项取值；实现后至少对首屏、核心接力段和最终行动段做同视口截图复盘，并同时检查桌面与 390px 移动端。比较多方案时，优先回答“能否一眼复述 signature”“去掉阴影后层级是否仍成立”“每个巧思是否表达推进、验收、返工或拍板”，不要只比较配色和装饰数量。

三案都必须保留正式页的文案、语义结构、核心 JavaScript 交互、状态色含义、键盘可用性、移动端纵向阅读和无横向滚动。只有真正代表独立对象或真实界面的区域（例如过程底单、终端、聊天窗口、首屏中心作品）可以保留闭合边界；同一信息簇最多保留一层闭合外框。

实验收敛前，不要把三案中的任一 CSS 或结构反向合并进 `index.html`。

## 本质重构实验（2026-07-18 第三轮）

针对 `index-field-relay.html` 与 `index-field-signal.html` “在相同 DOM 骨架上继续叠加视觉信号、差异停留在装饰层”的问题，本轮按用户要求保留源文件，分别复制成三个独立候选。它们不是生产入口，不替代 `index.html`，也不得在评审收敛前反向覆盖前两轮文件。

- `index-field-atlas-a31f.html`：Relay Atlas / 接力地图。源自 `index-field-relay.html`；以 handoff coordinates、章节坐标、责任领地和贯穿路线表达任务的接续关系。视觉方差中高、动效低至中、信息密度中。
- `index-field-ledger-b72c.html`：Proof Ledger / 可验证的工作底稿。源自 `index-field-signal.html`；以责任对照栏、批注、验收落款和裁决排版表达“每个承诺都有证据”。视觉方差高、动效低、信息密度高但可读。
- `index-field-studio-c91e.html`：Quiet Relay Studio / 安静的任务工作室。源自 `index-field-relay.html`；以真实任务接力演示和“只在责任变化时亮起”的信号表达自动推进。视觉方差中、动效中、信息密度低。

三份候选必须保持静态阅读本身成立：普通正文、列表与关键结论不得依赖 `IntersectionObserver` 才可见；脚本和动效只能增强路线状态、当前责任或局部反馈。继续保留正式文案、主要语义结构、状态色、键盘焦点、`prefers-reduced-motion`、移动端单列阅读与无横向滚动。

### 已采用方向的独立视觉样张

- `style-atlas-a31f.html`：从已采用的 `index-field-atlas-a31f.html` 抽取 Relay Atlas 的可复用视觉事实，包括令牌、三种文字声部、handoff coordinates、路线与责任领地、状态标签、过程底单、派工单、动效预算和使用禁区。它是后续 Atlas 方向页面的优先参考，并继续保持为不覆盖现有 `style.html` 的独立文件；正式 `index.html` 的提升来自用户单独确认，而不是样张自动改写入口。

这份样张不是营销页副本：不得把具体首屏、章节文案或整页布局当成组件照搬。复用时必须先写清当前页面中的真实站点、经手人、下一站和退回原因，再选择坐标、路线、领地或底单等视觉语法。
