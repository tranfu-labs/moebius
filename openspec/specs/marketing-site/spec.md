# marketing-site 规格

## 域定位

`marketing-site` 是面向公众的官网域，与产品运行时零耦合。当前生产页面是两个语言版本：`sites/marketeam/index.html`（英文，站点根路径）与 `sites/marketeam/zh/index.html`（中文，`/zh/`）；目录名 `marketeam` 是历史遗留，不代表当前品牌。该域只承载官网呈现与部署事实，不依赖 runner、Electron、console-ui、SQLite、GitHub intake 或构建工程。

下文对「正式首页」的约束，除显式限定语言的以外，MUST 同时适用于两个语言版本。

## 业务规则

### 语言版本与部署

- MUST 以 `sites/marketeam/index.html`（英文）与 `sites/marketeam/zh/index.html`（中文）作为当前仅有的两个官网页面和部署入口。
- 每个语言版本 MUST 将 HTML、CSS 与 JavaScript 放在同一文件内，无 npm/pnpm 安装或构建步骤；图片和品牌图标 MAY 位于发布目录的 `assets/`，两个语言版本共用同一份 `assets/`。
- 两个语言版本 MUST 使用相对路径引用 `assets/`，MUST NOT 依赖静态托管补齐尾斜杠。
- 静态托管 MUST 将 `sites/marketeam/` 设为发布目录，MUST NOT 发布仓库根目录或 `docs/marketing-site/`。
- MUST 在 `sites/marketeam/` 维护 `DEPLOY.md`，记录部署输入、本地预览、逐语言的上线检查、缓存、回滚和外部依赖。
- MUST NOT 需要服务端进程、环境变量、密钥、注册或邮箱收集；语言选择 MUST NOT 依赖服务端内容协商或托管平台的重定向规则。
- 公共字体或 GitHub API 失败时，两个语言版本的正文、主叙事、GitHub 链接和下载后备链接仍 MUST 可读可用。

## Requirement: 英文是默认语言，中文在 /zh/ 并列提供

Source: docs/product/pages/home-page.md#入口与去向

站点根路径 MUST 返回英文页，`/zh/` MUST 返回内容一一对应的中文页。两个语言版本 MUST 各自是完整可读的静态 HTML，MUST NOT 依赖 JavaScript 才能显示本语言正文。两页 MUST 互相声明 `hreflang` alternate，并把 `x-default` 指向英文根路径。

### Scenario: 抓取器分别取两个语言版本

- GIVEN 抓取器不执行 JavaScript
- WHEN 它分别请求 `/` 与 `/zh/`
- THEN `/` 返回 `lang="en"` 的完整英文页，`/zh/` 返回 `lang="zh-CN"` 的完整中文页
- AND 两页都声明指向对方的 `hreflang` alternate

## Requirement: 根路径按浏览器语言落到对应语言，显式选择优先

Source: docs/product/pages/home-page.md#操作与反馈

访客首次打开根路径且没有既往语言选择时，页面 MUST 读取浏览器语言：判定为中文时 MUST 以替换式跳转进入 `/zh/`，其余情况 MUST 留在英文页。访客通过语言切换控件显式选定语言后，该选择 MUST 被记住，并 MUST 优先于浏览器语言。`/zh/` MUST NOT 因浏览器语言而自动跳转回英文页。语言推断与记忆失败时 MUST 安全降级为显示当前路径对应的语言，MUST NOT 产生跳转环路或空白页。

### Scenario: 中文浏览器打开根路径

- GIVEN 浏览器首选语言是中文且访客没有既往语言选择
- WHEN 访客打开站点根路径
- THEN 页面替换式跳转到 `/zh/` 并显示中文内容
- AND 浏览器「后退」回到访客的来源页，而不是回到根路径

### Scenario: 显式选择压过浏览器语言

- GIVEN 中文浏览器的访客已通过语言切换控件选择英文
- WHEN 访客再次打开站点根路径
- THEN 页面停留在英文页，不再跳转到 `/zh/`

### Scenario: 分享出去的中文链接

- GIVEN 浏览器首选语言不是中文
- WHEN 访客直接打开 `/zh/`
- THEN 页面显示中文内容，不跳转到英文页

## Requirement: 页头语言切换控件无脚本可用

Source: docs/product/pages/home-page.md#区域与信息

两个语言版本的页头 MUST 在右上角提供语言切换控件，展开后 MUST 同时列出英文与简体中文，并 MUST 用 `aria-current` 标出当前语言。菜单项 MUST 是指向对方语言页的真实链接，在 JavaScript 不可用时 MUST 仍可展开并完成切换，且 MUST 可用键盘操作。

### Scenario: 禁用 JavaScript 后切换语言

- GIVEN 浏览器禁用了 JavaScript
- WHEN 访客用键盘展开页头语言控件并选择另一种语言
- THEN 浏览器进入对方语言页并显示该语言的完整内容

## Requirement: 单个语言版本内不出现另一语言的残留

Source: docs/product/pages/home-page.md#指标与验收

每个语言版本的可见文案、`title`、`meta` 描述、社交分享文案、图片 `alt`、`aria-label` 与首屏产品预览截图 MUST 全部为该语言。英文页 MUST 使用英文界面的产品预览截图，中文页 MUST 使用中文界面的产品预览截图。

### Scenario: 英文访客通读英文页

- GIVEN 访客打开英文页
- WHEN 从页头浏览到页脚，并查看首屏产品预览
- THEN 所有文案、无障碍标签与截图内的产品界面文字都是英文

## Requirement: 页头在窄视口不溢出

Source: docs/product/pages/home-page.md#响应式与窗口行为

两个语言版本的页头在约 375px 视口下 MUST 完整容纳品牌、语言切换与下载入口，MUST NOT 换行溢出或产生页面级横向滚动。次要入口 MAY 在窄视口隐藏，下载入口 MUST 始终可见可点。

### Scenario: 375px 视口查看页头

- GIVEN 视口约为 375px 宽
- WHEN 页面完成布局
- THEN 页头单行容纳品牌、语言切换与下载按钮
- AND 页面级 `scrollWidth` 不大于 `clientWidth`

## Requirement: 官网页面结构与核心操作

Source: docs/product/pages/home-page.md#页面结构

正式首页 MUST 采用页头、首屏、Leader Agent 宣言、团队/对话/分析三个能力段、最终行动与页脚的连续结构。页头与最终行动 MUST 提供可用的 Apple Silicon macOS 下载和 GitHub 源码入口。

### Scenario: 访客理解产品并采取行动

- GIVEN 访客打开正式首页
- WHEN 从首屏浏览到最终行动
- THEN 能依次理解团队选择、会话推进和对话分析
- AND 能进入公开 GitHub 仓库或下载当前稳定的 Apple Silicon macOS 版本

### 页面叙事

- 首屏 MUST 用“把整个开发团队装进一次对话”这一定位建立产品心智（中文页用该原句，英文页用其对应表达），并展示桌面端真实 UI 预览。
- 宣言段 MUST 说明用户只需和 Leader Agent 聊清楚，而不是逐个管理 Agent。
- 三个能力段 MUST 依次说明团队匹配、会话内自主推进和对话分析。
- 页面 MUST 描述产品行为，MUST NOT 使用虚构的质量数字推动转化。
- 页头 MUST 提供团队 / 对话 / 分析三个页内锚点，页脚 MUST 回收产品定位和平台范围。

## Requirement: 下载链接可用且可降级

Source: docs/product/pages/home-page.md#页面状态

下载按钮 MUST 至少指向 `tranfu-labs/moebius` 的最新稳定 Release 页面。页面成功解析最新稳定 Release 的 `-mac-arm64.dmg` 资产时 SHOULD 将按钮升级为该资产直链；解析失败时 MUST 保留 Releases 后备链接，不得产生空链接或伪造资产地址。

### Scenario: GitHub API 不可用

- GIVEN 页面无法取得最新 Release 数据
- WHEN 访客点击任一下载按钮
- THEN 仍进入 `tranfu-labs/moebius` 的最新稳定 Release 页面

### Scenario: 最新 DMG 可解析

- GIVEN 最新稳定 Release 包含 `-mac-arm64.dmg` 资产
- WHEN 页面完成下载链接解析
- THEN 所有下载按钮统一指向该 DMG 直链

## Requirement: 官网使用统一 Moebius 品牌图标

Source: docs/product/prd.md#品牌与发行平台

两个语言版本的正式首页 MUST 在页头显示由全局品牌母版派生的 64px 图标，并声明 32px PNG favicon 与 180px Apple Touch Icon。三个文件 MUST 位于 `sites/marketeam/` 发布目录内并通过品牌资产检查。官网 MUST NOT 使用空 favicon、另一枚无限符号或引用发布目录之外的品牌文件。

### Scenario: 静态站点直接部署

- GIVEN 静态托管只发布 `sites/marketeam/`
- WHEN 浏览器请求首页、favicon 和 Apple Touch Icon
- THEN 三个请求都返回 200
- AND 页头图标、favicon 与 touch icon 来自同一品牌母版

## Requirement: 官网明确仅支持 Apple Silicon Mac

Source: docs/product/prd.md#品牌与发行平台

官网页头、首屏、最终行动与页脚 MUST 把正式产品描述为 macOS Apple Silicon 应用。页面 MUST NOT 暗示 Windows、Linux、Intel Mac 或 universal 版本存在或即将提供。

### Scenario: 访客查看发布范围

- GIVEN 访客从官网首屏滚动到最终行动
- WHEN 阅读公测状态、下载说明和页脚
- THEN 页面持续明确 Apple Silicon Mac 是唯一正式平台
- AND 不出现其他操作系统或 CPU 架构的下载承诺

## Requirement: 视觉、语义与响应式行为

Source: docs/product/pages/home-page.md#响应式与窗口行为

- MUST 使用深色工作台视觉、清晰文字层级、半透明能力示意和有限的紫色强调。
- MUST 通过语义化 `nav`、`main`、`header`、`section`、`footer` 组织页面，并提供跳到正文的 skip link。
- 桌面端三个能力段 MUST 使用粘性图示与当前段联动；900px 以下 MUST 降级为纵向顺序阅读。
- MUST 尊重 `prefers-reduced-motion`；减少动态效果时正文、产品预览和链接仍 MUST 完整可读。
- MUST 在桌面与移动端保持内容可读且不产生页面级横向滚动。

### Scenario: 移动端不横滚

- GIVEN 视口约为 375px 宽
- WHEN 页面完成布局和动效初始化
- THEN 页面级 `scrollWidth` 不大于 `clientWidth`
- AND 首屏、三个能力段与最终行动可按纵向顺序完整阅读

### Scenario: 减少动态效果

- GIVEN 用户启用 `prefers-reduced-motion: reduce`
- WHEN 打开并滚动页面
- THEN 非必要动效降级
- AND 内容、产品预览和核心操作不依赖动画才能理解或使用

## Requirement: 官网资料与历史隔离

Source: docs/product/pages/home-page.md#页面目标

官网当前产品意图 MUST 以 `docs/product/pages/home-page.md` 为事实源。`docs/marketing-site/` 中较早的叙事、视觉与实验材料 MAY 作为历史设计参考，但 MUST NOT 覆盖页面 PRD 或两个正式语言版本；明确废弃的资料 MUST 放入 `docs/marketing-site/archive/`，且 archive 内容 MUST NOT 进入生产发布目录。

### Scenario: 历史材料不进入生产

- GIVEN 官网静态部署产物已生成
- WHEN 检查发布目录
- THEN 只包含 `sites/marketeam/` 的当前页面、资源与部署说明
- AND `docs/marketing-site/archive/` 中的资料没有被发布
