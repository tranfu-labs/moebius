# marketing-site spec delta

本 delta 替换现行 spec「域定位」与「唯一页面与部署」两处对「单一中文页面」的描述，
并新增语言路由、语言切换与本地化完整性三条 Requirement。其余 Requirement 不变，
但其中所有对「正式首页 / `sites/marketeam/index.html`」的约束，归档后按新的
「两个语言版本」口径同时适用于英文页与中文页。

## 域定位（替换）

`marketing-site` 是面向公众的官网域，与产品运行时零耦合。当前生产页面是两个语言版本：
`sites/marketeam/index.html`（英文，站点根路径）与 `sites/marketeam/zh/index.html`
（中文，`/zh/`）。目录名 `marketeam` 是历史遗留，不代表当前品牌。该域只承载官网呈现
与部署事实，不依赖 runner、Electron、console-ui、SQLite 或构建工程。

## 业务规则（替换「唯一页面与部署」）

### 语言版本与部署

- MUST 以 `sites/marketeam/index.html`（英文）与 `sites/marketeam/zh/index.html`（中文）
  作为当前仅有的两个官网页面和部署入口。
- 每个语言版本 MUST 把 HTML、CSS 与 JavaScript 放在同一文件内，无 npm/pnpm 安装或构建
  步骤；图片和品牌图标 MAY 位于发布目录的 `assets/`，两个语言版本共用同一份 `assets/`。
- 两个语言版本 MUST 使用相对路径引用 `assets/`，MUST NOT 依赖静态托管补齐尾斜杠。
- 静态托管 MUST 将 `sites/marketeam/` 设为发布目录，MUST NOT 发布仓库根目录或
  `docs/marketing-site/`。
- MUST 在 `sites/marketeam/` 维护 `DEPLOY.md`，记录部署输入、本地预览、逐语言的上线
  检查、缓存、回滚和外部依赖。
- MUST NOT 需要服务端进程、环境变量、密钥、注册或邮箱收集；语言选择 MUST NOT 依赖
  服务端内容协商或托管平台的重定向规则。
- 公共字体或 GitHub API 失败时，两个语言版本的正文、主叙事、GitHub 链接和下载后备链接
  仍 MUST 可读可用。

## Requirement: 英文是默认语言，中文在 /zh/ 并列提供

Source: docs/product/pages/home-page.md#入口与去向

站点根路径 MUST 返回英文页，`/zh/` MUST 返回内容一一对应的中文页。两个语言版本 MUST
各自是完整可读的静态 HTML，MUST NOT 依赖 JavaScript 才能显示本语言正文。两页 MUST
互相声明 `hreflang` alternate，并把 `x-default` 指向英文根路径。

### Scenario: 抓取器分别取两个语言版本

- GIVEN 抓取器不执行 JavaScript
- WHEN 它分别请求 `/` 与 `/zh/`
- THEN `/` 返回 `lang="en"` 的完整英文页，`/zh/` 返回 `lang="zh-CN"` 的完整中文页
- AND 两页都声明指向对方的 `hreflang` alternate

## Requirement: 根路径按浏览器语言落到对应语言，显式选择优先

Source: docs/product/pages/home-page.md#操作与反馈

访客首次打开根路径且没有既往语言选择时，页面 MUST 读取浏览器语言：判定为中文时 MUST
以替换式跳转进入 `/zh/`，其余情况 MUST 留在英文页。访客通过语言切换控件显式选定语言后，
该选择 MUST 被记住，并 MUST 优先于浏览器语言。`/zh/` MUST NOT 因浏览器语言而自动跳转
回英文页。语言推断与记忆失败时 MUST 安全降级为显示当前路径对应的语言，MUST NOT 产生
跳转环路或空白页。

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

两个语言版本的页头 MUST 在右上角提供语言切换控件，展开后 MUST 同时列出英文与简体中文，
并 MUST 用 `aria-current` 标出当前语言。菜单项 MUST 是指向对方语言页的真实链接，
在 JavaScript 不可用时 MUST 仍可展开并完成切换，且 MUST 可用键盘操作。

### Scenario: 禁用 JavaScript 后切换语言

- GIVEN 浏览器禁用了 JavaScript
- WHEN 访客用键盘展开页头语言控件并选择另一种语言
- THEN 浏览器进入对方语言页并显示该语言的完整内容

## Requirement: 单个语言版本内不出现另一语言的残留

Source: docs/product/pages/home-page.md#指标与验收

每个语言版本的可见文案、`title`、`meta` 描述、社交分享文案、图片 `alt`、`aria-label`
与首屏产品预览截图 MUST 全部为该语言。英文页 MUST 使用英文界面的产品预览截图，
中文页 MUST 使用中文界面的产品预览截图。

### Scenario: 英文访客通读英文页

- GIVEN 访客打开英文页
- WHEN 从页头浏览到页脚，并查看首屏产品预览
- THEN 所有文案、无障碍标签与截图内的产品界面文字都是英文

## Requirement: 页头在窄视口不溢出

Source: docs/product/pages/home-page.md#响应式与窗口行为

两个语言版本的页头在约 375px 视口下 MUST 完整容纳品牌、语言切换与下载入口，
MUST NOT 换行溢出或产生页面级横向滚动。次要入口 MAY 在窄视口隐藏，
下载入口 MUST 始终可见可点。

### Scenario: 375px 视口查看页头

- GIVEN 视口约为 375px 宽
- WHEN 页面完成布局
- THEN 页头单行容纳品牌、语言切换与下载按钮
- AND 页面级 `scrollWidth` 不大于 `clientWidth`
