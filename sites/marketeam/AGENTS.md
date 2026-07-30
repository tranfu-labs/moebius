# marketeam 目录说明

本目录包含正式营销页、视觉样张和隔离的页面实验。

## 正式文件

- `index.html`：当前正式营销页；2026-07-29 经用户明确确认，由 `packages/console-ui/design-refs/home-page.html` 提升为深色工作台首页，并接入公开 GitHub 仓库与 Releases 下载。
- `rebrand-narrative-plan.md`：2026-07-30 品牌与叙事改版方案（待评审）。诊断两层病灶（无可占有品牌资产、无情绪叙事），决策走风格化不拟人路线（Leader Agent 固定词 + 「欲望开场、对照收尾」叙事线 + 战吼口号；旧世界对照按参照站实证放页面后段作情绪高潮，不用痛开场）；视觉签名不由文字拍板，列了三个候选方向（首选角色色板系统），由样张同视口截图对比决出。名字故事只以文案存在，明确不做环形/缎带/∞ 字面隐喻图形。实施须按该文档「实施拆分」先出样张，评审收敛前不改 `index.html`。
- `index-pre-atlas.html`：Atlas 提升前的正式营销页归档，只用于回看和差异比较，不作为部署入口。
- `DEPLOY.md`：静态站点部署说明。

### 深色工作台首页正式收敛（2026-07-29）

设计参考 HTML 继续留在 `packages/console-ui/design-refs/` 作为来源锚点；正式 `index.html` 在其基础上接入生产品牌资产、GitHub 仓库、Releases 与可降级的最新 Apple Silicon DMG 解析。`index-field-atlas-a31f.html` 和 `style-atlas-a31f.html` 只保留为历史设计参考，不再代表正式入口。

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

## 3D 团队空间候选（2026-07-30）

- `index-team-diorama-7f3a.html`：根据用户提供的等距团队空间参考制作的中配真 3D 候选。页面消费 `assets/team-diorama/team-workspace.glb`，提供有限旋转、缩放、六名成员热点、原图对照、静态海报和 reduced-motion / WebGL 失败降级。
- `assets/team-diorama/reference-front.png`：用户提供的主视角事实参考；`reference-turnaround.png`：GPT Image 依据主视角补全的四视图建模参考；两者只服务候选设计与验收。
- 正式 `index.html` 不自动引入该候选。只有用户完成视觉评审并明确选择提升后，才可按官网产品事实源与 OpenSpec 流程迁移。
