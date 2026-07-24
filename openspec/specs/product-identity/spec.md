# 产品标识规格

## Requirement: 仓库受控命名统一为 Moebius

Source: docs/product/prd.md#产品命名

系统 MUST 在用户可见品牌中使用 `Moebius`，在技术 slug 与协议 namespace 中使用 `moebius`，在 workspace package scope 中使用 `@moebius`，在环境变量前缀中使用 `MOEBIUS`。仓库跟踪内容与跟踪路径 MUST NOT 保留此前的产品标识。

### Scenario: 用户可见品牌

Given 用户打开桌面应用、本地控制台、observer、onboarding、官网或开发文档
When 界面或资料需要显示产品名称
Then 名称为 `Moebius`

### Scenario: 包与构建标识

Given pnpm 解析 workspace package、内部依赖或 filter 命令
When 构建 console UI、desktop 或 prototypes
Then package scope 为 `@moebius/*`
And lockfile 与构建脚本引用相同 scope

### Scenario: 运行环境和默认数据目录

Given 打包桌面应用未收到显式数据根覆盖
When 解析生产数据根
Then 默认目录为 `~/.moebius`
And 数据根覆盖变量为 `MOEBIUS_DATA_ROOT`
And workdir 覆盖变量为 `MOEBIUS_WORKDIR_ROOT`
And 系统不读取此前名称对应的目录或环境变量

### Scenario: 协议与运行标识

Given 系统生成或解析 comment metadata、stage marker、attachment capability header、稳定 key、日志前缀、临时目录、release tag 或容器资源名
When 这些标识由仓库代码控制
Then namespace 使用 `moebius`
And 旧 namespace 不被生成或接受

### Scenario: 外部仓库状态不在改名范围

Given 当前开发 worktree 路径或 git remote URL 仍含历史仓库 slug
When 执行本次仓库内容改名
Then 系统不重命名 worktree 根
And 系统不修改 git remote

## Requirement: 品牌资产从唯一母版脚本派生

Source: docs/product/prd.md#产品命名

系统 MUST 以 `assets/brand/moebius.png` 为唯一品牌母版。`pnpm brand:generate` MUST 使用 macOS `sips` 等比缩放生成 1024px 应用图标、64px UI 图标、32px favicon、180px Apple Touch Icon 及官网同内容部署副本，并更新 `assets/brand/manifest.json`；生成 MUST NOT 裁切、抠图或重绘。`pnpm brand:check` MUST 只读校验母版与全部产物的 SHA-256、PNG 签名、正方形尺寸、文件大小上限与同尺寸部署副本哈希。desktop 打包 MUST 先通过该门禁。`.app`、DMG、Dock、操作台、onboarding、辅助状态页与官网 MUST 统一使用母版的脚本派生产物。

### Scenario: 生成产物与母版哈希一致

Given 母版 `assets/brand/moebius.png` 未变更
When 运行 `pnpm brand:check`
Then 校验通过且不修改任何文件

### Scenario: 打包前品牌门禁

Given 任一品牌产物与 manifest 记录的哈希不一致
When 执行 desktop 打包
Then 打包在产物构建前失败并指向 `pnpm brand:generate`
