# marketing-site 规格

## 域定位

`marketing-site` 是面向公众的官网域，与产品运行时零耦合。当前唯一生产页面是 `sites/marketeam/index.html`；目录名 `marketeam` 是历史遗留，不代表当前品牌。该域只承载官网呈现与部署事实，不依赖 runner、Electron、console-ui、SQLite、GitHub intake 或构建工程。

## 业务规则

### 唯一页面与部署

- MUST 以 `sites/marketeam/index.html` 作为当前唯一官网页面和部署入口。
- MUST 将 HTML、CSS 与 JavaScript 放在同一文件内，无 npm/pnpm 安装或构建步骤；图片和品牌图标 MAY 位于同一发布目录的 `assets/`。
- 静态托管 MUST 将 `sites/marketeam/` 设为发布目录，MUST NOT 发布仓库根目录或 `docs/marketing-site/`。
- MUST 在同目录维护 `DEPLOY.md`，记录部署输入、本地预览、上线检查、缓存、回滚和外部依赖。
- MUST NOT 需要服务端进程、环境变量、密钥、注册或邮箱收集。
- 公共字体或 GitHub API 失败时，正文、主叙事、GitHub 链接和下载后备链接仍 MUST 可读可用。

## Requirement: 官网页面结构与核心操作

Source: docs/product/pages/home-page.md#页面结构

正式首页 MUST 采用页头、首屏、Leader Agent 宣言、团队/对话/分析三个能力段、最终行动与页脚的连续结构。页头与最终行动 MUST 提供可用的 Apple Silicon macOS 下载和 GitHub 源码入口。

### Scenario: 访客理解产品并采取行动

- GIVEN 访客打开正式首页
- WHEN 从首屏浏览到最终行动
- THEN 能依次理解团队选择、会话推进和对话分析
- AND 能进入公开 GitHub 仓库或下载当前稳定的 Apple Silicon macOS 版本

### 页面叙事

- 首屏 MUST 用“把整个开发团队装进一次对话”建立产品定位，并展示桌面端真实 UI 预览。
- 宣言段 MUST 说明用户只需和 Leader Agent 聊清楚，而不是逐个管理 Agent。
- 三个能力段 MUST 依次说明团队匹配、会话内自主推进和对话分析。
- 页面 MUST 描述产品行为，MUST NOT 使用虚构的质量数字推动转化。
- 页头 MUST 提供“团队 / 对话 / 分析”页内锚点，页脚 MUST 回收产品定位和平台范围。

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

正式 `sites/marketeam/index.html` MUST 在页头显示由全局品牌母版派生的 64px 图标，并声明 32px PNG favicon 与 180px Apple Touch Icon。三个文件 MUST 位于 `sites/marketeam/` 发布目录内并通过品牌资产检查。官网 MUST NOT 使用空 favicon、另一枚无限符号或引用发布目录之外的品牌文件。

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

官网当前产品意图 MUST 以 `docs/product/pages/home-page.md` 为事实源。`docs/marketing-site/` 中较早的叙事、视觉与实验材料 MAY 作为历史设计参考，但 MUST NOT 覆盖页面 PRD 或正式 `index.html`；明确废弃的资料 MUST 放入 `docs/marketing-site/archive/`，且 archive 内容 MUST NOT 进入生产发布目录。

### Scenario: 历史材料不进入生产

- GIVEN 官网静态部署产物已生成
- WHEN 检查发布目录
- THEN 只包含 `sites/marketeam/` 的当前页面、资源与部署说明
- AND `docs/marketing-site/archive/` 中的资料没有被发布
