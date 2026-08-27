# 设计：unify-team-installation-source

## 方案

### 1. 统一来源元数据

在团队记录中使用以下判别联合：

```ts
type InstallationSource =
  | { provider: "moebius" }
  | { provider: "github"; repository: string; defaultBranch: string };
```

来源是安装时的事实，不是可执行的订阅关系。GitHub 的旧 `upstream` 字段只做读取兼容，并在新写入路径中不再生成。

### 2. 新安装与内置 seed

- GitHub 安装继续从远端快照生成团队内容，但只写普通用户团队目录、用户团队 record、`installationSource` 和显式执行绑定。
- 内置 seed 使用相同的普通用户团队路径，来源为 `{ provider: "moebius" }`。内置 manifest 的推荐配置只在安装时 materialize 为显式执行绑定，不形成可更新的官方状态。
- 新团队的可见性来自团队目录与 record；不依赖 `official-state-v1.json` 或 `official.json`。
- 如果发现旧 `.system/general-assistant`，seed 不复制、不覆盖；目录、旧会话和旧 ownership 继续由兼容读取路径提供。

### 3. 启动与运行绑定

启动只执行普通 seed、local console 和已有更新流程，不再调用 `migrateOfficialBaselines` 或 `syncOfficialTeams`。

新用户团队的执行绑定全部为显式 profile，因此 profile 查询不读取官方状态。旧 system 团队若仍带 `recommended` binding，则允许读取旧官方状态作为兼容 fallback；缺失推荐时使用既有默认 profile，不能触发网络或同步。

### 4. IPC 与 UI

删除 GitHub 的 detach/check/sync/revert IPC 频道、请求和响应；删除团队页的同步 banner、失联操作、最近同步和撤销确认。保留 `installationSource` 的来源展示与 GitHub 仓库链接。

团队列表不再按“跟随更新”分组，也不显示“有更新”“失联”或“已自定义”同步状态。官方与 GitHub 安装的团队使用同一编辑、运行配置、修复、复制和删除路径；旧 system 团队仅在内部保留 ownership 分支以解析历史数据。

### 5. 兼容与回滚

旧 `.system` 目录、旧 session JSONL/SQLite ownership、旧 revision 路径和旧状态文件不主动搬迁或删除。回滚本 change 时，新 record 的 `installationSource` 可由记录解析器忽略，旧 `upstream` 和旧 system 目录仍保持可读；代码回滚不依赖数据迁移。

## 权衡

- 采用普通用户目录统一新安装，满足官方/GitHub 同逻辑；代价是旧 `.system` 仍需内部兼容分支。
- 采用显式执行绑定，避免为初始推荐保留一份会驱动同步的官方状态；代价是内置 manifest 后续变化不会自动进入已安装团队。
- 保留旧状态只读兼容而不做清理，避免破坏已有会话与运行配置；代价是旧数据根可能暂时残留无效状态文件。

## 风险

- 旧 system 团队如果被误当作新 user 团队重建，可能产生重复团队；安装/seed 必须先检测稳定 id 和既有路径。
- 旧 recommended binding 缺少可用旧状态时必须降级到默认 profile，不能让历史会话因删除同步逻辑而无法打开。
- 新来源字段是持久化契约；官方 provider 已由用户确认采用 `moebius`，其余字段严格按联合类型校验。
