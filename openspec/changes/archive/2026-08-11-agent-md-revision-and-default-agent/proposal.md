# 提案：agent-md-revision-and-default-agent

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/flows/agent-evolution.md` | 一、本地调教留痕 / 二、看见变化与来历 | 每次保存产生带完整内容、作者与人话摘要的修订；编辑器内左侧标记与就地展开；成员级时间线与回退 | 已写入并通过产品复评 |
| `docs/product/flows/agent-evolution.md` | 分支与异常（官方基线不可考） | 本能力上线前已被用户改动过的官方来源团队，`A` 没有完整内容；本 change 只负责标记状态与回填一条起点修订，不做二路合并 | 已写入并通过产品复评 |
| `docs/product/pages/agent-teams.md` | 用户团队详情 / 官方来源团队详情 / 变化时间线 / 编辑与保存 `AGENT.md` | `AGENT.md` 标题行新增"最近变化"摘要与"全部"展开；正文左侧变化标记与来历署名；成员级时间线与"回到这一版" | 已写入并通过产品复评 |
| `docs/product/pages/agent-teams.md` | 官方版本与三方比较（表格"A 不可考"行） | `A` 只存指纹升级为存完整内容；老用户迁移时按内容指纹相等与否分流为 `verified` 回填或 `conservative` 标记 | 已写入并通过产品复评 |
| `docs/product/pages/settings.md` | 常规 / 默认 Agent | 新增应用级"默认 Agent"设置项，复用团队页成员运行配置的选择方式 | 已写入并通过产品复评 |

本 change 只引用上述事实源，不复制 PRD 的产品理由。

## 背景

`docs/product/flows/agent-evolution.md` 定义的"Agent 进化"要求 `AGENT.md` 的每一次调教都留痕、可查来历、可回退，并要求应用有一个不属于任何团队/会话的"默认 Agent"负责写变化摘要和（后续 change 2 的）自动合并。当前实现完全没有这层：

- `AGENT.md` 保存是直接覆盖落盘，全库没有修订 / 历史模块；编辑器是纯文本框，没有变化标记或时间线。
- `AppliedOfficialTeamState`（`desktop/src/team-official-plan.ts`）只存官方基线的 sha256 指纹（`appliedContentFingerprint`），不存完整内容——这是后续 change 2 做自动合并的硬性前提缺口：没有 `A` 的全文，无法分辨一处差异是用户改的还是官方改的。
- 应用没有"默认 Agent"的概念，设置页也没有对应设置项。

本 change 是三个 change 中的地基：只解决"本地调教"这一条起点（不碰官方同步算法，那是 change 2；不碰会话内变化提示弹窗，那是 change 3），但顺带把 `AppliedOfficialTeamState` 从"只存指纹"换成"存完整内容"，因为这是存储层的事，change 2 直接消费这个结果。

## 提案

### 1. 修订持久化

`AGENT.md` 每次保存成功（团队页内保存或 Finder 外部修改被读取到）落一条修订：完整内容、作者（`user | official | agent`，本 change 只产生 `user`）、时间、异步生成的人话摘要。修订独立存储在数据根，不进团队内容目录；不设数量或时间上限。

### 2. 段落级变化归属（呈现专用，不进入合并判断）

给定"上一条修订的段落归属表 + 新旧全文"，按空行 / 标题切块比对，算出这一条修订里哪些块的作者标签需要更新。这套算法**只服务编辑器左侧标记的呈现**，切块错误的代价仅是标记位置不好看；它不产生、也不参与任何合并判断——**合并单位永远是整份文件**，change 2 的自动合并直接把 A/B/C 三份全文交给默认 Agent，不依赖、不复用这里的分块结果。这条边界必须在实现里保持两套独立代码路径，理由见 design.md「权衡」。

### 3. 默认 Agent：单次调用，不进会话生命周期

摘要生成和（change 2 的）自动合并都使用设置中的"默认 Agent"配置做**一次性单轮调用**，复用现有 provider 驱动最轻量的一层，不创建会话、不进 run 生命周期、不出现在会话列表。默认 Agent 不可用或调用失败时，摘要退化为中性占位文案，不阻塞保存、不重试轰炸。

### 4. 官方基线迁移：`verified` 回填 / `conservative` 标记

`AppliedOfficialTeamState` 扩展为存完整内容快照。首次迁移时：当前用户内容 `B` 的指纹与历史只存的旧指纹相等（用户从未改过）→ 用 `B` 现在的全文回填 `A`，标记 `verified`。不相等（用户已自定义，`A` 原文不可考）→ 标记 `conservative`，同时把迁移当时的 `B` 全文补记成一条 `author=你` 的修订，作为该成员时间线的起点。**本 change 到此为止**——`conservative` 状态下不做任何合并，也不提供一次性合并入口；那个入口和它触发的二路合并属于 change 2。

### 5. 默认 Agent 设置项

设置常规分类新增"默认 Agent"，复用团队页成员运行配置的 CLI / Provider / 模型 / 思考程度选择器（同一组件，不新增第二套控件语言）；没有已保存选择时显示内置"通用助手"官方推荐组合，不显示空白。

### 6. 编辑器呈现

`AGENT.md` 编辑器标题行新增"最近变化"一句话摘要与"全部"展开入口；正文变动段落左侧带色条，hover 显形来历署名，点击就地展开原文（不跳转、不开第二界面）；展开面板是成员级完整时间线，逐条列摘要 + 作者，可"回到这一版"（回退本身产生一条新修订）。

## 影响

### 业务域

- `desktop-shell`：新增修订存储与迁移逻辑、默认 Agent 单次调用编排、新增窄 IPC 端点；`team-official-plan.ts` / `team-official-management.ts` 的 `AppliedOfficialTeamState` 结构变化。
- `console-ui`：`agent-markdown-mention-editor.tsx` 扩展变化标记；新增时间线面板组件；提取共享 `execution-profile-fields` 组件供团队页与设置页复用；设置弹窗新增默认 Agent 面板。

### 数据与兼容

- SQLite 新增修订表（加法迁移，遵循仓库既有幂等/事务/外键校验模式）。
- `AppliedOfficialTeamState` 的磁盘/存储结构从"指纹"扩展为"指纹 + 内容"，需要一次性迁移函数处理存量数据，迁移失败或部分完成不得导致官方来源身份丢失或内容被覆盖。
- 团队内容目录本身不变，用户 Finder 视角不受影响。

### 明确不在范围

- 不改动现有官方更新的三方比较判定与显式更新按钮 UI（`deriveOfficialTeamUpdateState` 的外部行为不变）——那是 change 2。
- 不实现 `conservative` 基线的二路合并或一次性合并入口——那是 change 2。
- 不改动会话内变化提示与"查看"弹窗——那是 change 3。
- 不引入官方同步批次（`official_sync_batches`）——批次概念随 change 2 一起引入。
- 本轮只落 OpenSpec 方案，不修改生产代码、当前 specs 或已写入的 PRD。
