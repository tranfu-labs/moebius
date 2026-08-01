# 设计：persist-sidebar-draft-attachment-presence

## 不变量与三态语义

- 若重启后从未激活的未发送分析草稿只有服务端普通附件，则关闭前必须出现丢弃确认。
- 只有权威成功结果证明服务端集合为空时，草稿附件存在性才可为 `absent`；任何失败、迁移未知或在途 mutation 都不得写 `absent`。
- `present` 与 `unknown` 均 fail closed：关闭时必须确认；只有 `absent` 且正文、文本胶囊、最终上下文均无用户变化时可直接关闭。
- 若异步结果提交时对应 draft key 的 presence generation 已变化，则该结果不得更新持久化见证。
- 现有 `draftRevisionRef` 只管理整集替换对恢复结果的作废；本 change 不增加其推进点，`addFiles` / `remove` 与恢复合并的既有集合语义保持不变。

## 方案

### 1. 草稿内持久化保守见证

`SidebarConversationDraft` 增加 `managedAttachmentPresence: "absent" | "unknown" | "present"`。新建草稿确定没有附件，初始化为 `absent`。v1 文档继续原地兼容：解析时字段缺失或非法均规范化为 `unknown`，避免 schema bump 让旧草稿整体消失。

store 增加按 `attachmentDraftKey` 更新 presence 的窄方法；只有值实际变化时写 storage 并返回 true，调用方据此刷新 React 投影。它不保存附件数量、ID 或完整集合，因此不是服务端附件清单的第二事实源，而是同步关闭 guard 的保守安全见证。

纯关闭判定继续集中在 `sidebar-conversation-drafts.ts`：正文 / 文本胶囊 / context 有变化、renderer 当前能看到附件、或持久化 presence 非 `absent`，任一成立即确认。

### 2. 独立 per-key presence generation

`useManagedAttachmentDrafts` 增加可选、通过 ref 读取最新身份的 callback，并新增独立 `attachmentPresenceGenerationRef`。两个计数器职责严格分开：

- `draftRevisionRef`：仅 `replaceWithMessageAttachments` 推进，决定整集 restore 是否作废；既有 `:329` 判定与 add/remove/restore 合并不变。
- presence generation：每个可能改变服务端附件集合的 mutation 开始时按 draft key 推进并报告 `unknown`；权威成功结果只有 generation 仍匹配时才能提交 `present` / `absent`。

具体提交规则：

- `addFiles`：一批文件开始前推进一次并写 `unknown`；任一属于当前 generation 的上传成功后写 `present`，失败不降级。
- `remove`：删除开始前推进并写 `unknown`；无论 DELETE 成败都不额外 list，也不写 `absent`，等待下次激活的权威 list 收敛。
- 当前 key 的 list：请求发起时捕获 presence generation；成功完成后依据服务端返回集合写 `present` / `absent`，失败不写。期间 add/remove 只会让 presence 提交作废，不会触碰 `draftRevisionRef`，因此恢复到的既有附件仍按原合并逻辑进入 UI。
- `replaceWithMessageAttachments`：保留既有 draft revision 推进，同时单独推进 presence generation；clone 与预览完整成功且 generation 匹配后按最终集合提交三态，失败维持 `unknown`。

callback identity 不进入恢复 effect 依赖，而通过 ref 使用最新 callback，避免父级重渲染重新发请求或迟到结果写入旧接收者。

### 3. 页面接线与关闭规则

`app.tsx` 提供稳定 callback，根据 attachment draft key 调 store 窄更新并仅在变化时刷新 `sidebarConversationDrafts`。附件 hook 仍只负责附件 I/O，不直接依赖 localStorage store。

关闭时仍先以目标 `draftId` 读最终草稿，再读取 renderer keyed record；纯判定同时使用 persisted presence。取消继续早于 tabs、draft 与 renderer attachment mutation。

### 4. 一次性 PRD 偏离

验收 34 规定没有用户内容的空草稿可直接关闭。升级前已存在、缺少 presence 字段的空草稿会迁移为 `unknown`，首次成功激活并完成空 list 前会多弹一次确认。这是有界、fail-closed 的一次性偏离：首次权威空 list 后收敛为 `absent`，以后恢复直接关闭语义。选择它是因为把未知迁移成 `absent` 会重现本 change 要消除的静默丢失。

### 5. 审计回写

验证后把 R-14 登记为已有保护；R-02 的“未覆盖子集”必须显式保留一行，即使结论为“无”，并给出持久三态、旧文档迁移和 renderer 回归依据。R-15 原文、评分和开放状态不变。

## 方案来源与权衡

本题是 C 型结构退化：同步关闭边界需要的附件事实没有与草稿共同持久化。

- **候选 A（未采用）· 启动时批量预取全部 draft key**：服务端仍是唯一集合事实源，但启动慢请求完成前及失败时仍是 unknown；要让同步 guard 安全仍需本地 loading/error 状态，不能消除持久见证。
- **候选 B（采用）· 草稿内三态保守见证**：同步、跨重启、失败安全；代价是可能产生额外确认，通过只有权威成功可写 `absent` 和下一次激活收敛限制漂移。
- **候选 C（未采用）· 持久化 boolean / count**：不能表达迁移、失败和在途 mutation，false 会造成静默丢失；count 又复制服务端集合细节，漂移面更大。

remove 后权威 list 虽能减少误确认，但它为消除安全方向 false positive 增加网络往返与新竞态，不符合本 change 的不对称原则，因此只写 `unknown` 并靠正常激活收敛。

## 测试设计

- 纯测试：新草稿 `absent`；legacy 缺失 / 非法字段变 `unknown`；store 只更新匹配 attachment key；`unknown` / `present` 均确认，可信 `absent` 空草稿不确认。
- renderer 重启主回归：A 仅有服务端附件、B 活动；重建 React root 模拟重启后不激活 A，直接关闭 A 必须确认，取消保留 A/B、附件与焦点，确认后 A 不再恢复。
- 迁移收敛：旧空草稿迁移成 `unknown`，激活后成功空 list 变 `absent`，随后关闭不确认。
- 异步环境：慢 list 期间 add/remove 不作废附件集合恢复；presence 的旧 generation 不提交；list 失败维持 unknown；父级重渲染与 callback identity 变化后成功结果交给最新 callback。
- 使用内存 storage / fetch 替身和 `waitForCondition`，不启动 Electron、SQLite、JSONL、真实网络或固定 sleep；不写源码 / 文档镜像断言。

## 真机验收语句

1. **主证据：重启后未激活的仅附件草稿仍确认。** 在真实 Electron 主对话右侧栏创建分析草稿 A，只添加一个普通附件并等待上传成功；创建 / 切到 B，退出并重启应用；重启后不点击 A，直接点 A 的关闭按钮。可断言信号：丢弃确认弹窗出现。选择取消后 A/B 标签仍在、B 仍选中、焦点留在 A 的关闭按钮；选择 A 后原附件仍可见。
2. **确认后不恢复。** 沿用同一状态，再关闭 A 并确认丢弃，退出并重启。可断言信号：A 标签和草稿不再出现，B 及其选中态保持。
3. **可信空草稿直接关闭。** 新建空分析草稿 A，确保无正文、文本胶囊、附件或 context 变化；切到 B 后重启，不激活 A 直接关闭。可断言信号：不出现确认，A 关闭，B 保持。

## 风险与回滚

- legacy 空草稿首次激活前存在已点名的一次性误确认；成功空 list 后必须收敛，测试锁定。
- callback identity 或迟到提交可能污染见证；callback ref 与独立 generation 隔离，且不得借用 `draftRevisionRef`。
- remove 后 unknown 可能持续到下一次激活；这是安全方向漂移，不额外消耗网络修正。
- 回滚需整体撤销草稿字段、hook 回调和页面接线；v1 文档中的额外字段会被旧解析器忽略，不涉及破坏性迁移。

## 方案自审

- [x] 范围只处理 R-14，不处理 R-15、R-08 或迟到提交族。
- [x] PRD 边界由验收 34 覆盖，无需产品采访。
- [x] 三态规则可判定，只有权威成功结果能写 `absent`。
- [x] presence generation 与 `draftRevisionRef` 分离，`:329` 既有整集恢复语义不变。
- [x] add/remove 不推进 draft revision；remove 不为安全误确认额外 list。
- [x] legacy unknown 的一次性 PRD 偏离已点名，并有收敛测试。
- [x] 用户可见验收含页面入口和可断言信号，主证据是重启后确认弹窗出现。
- [x] 审计回写要求 R-02 显式写出未覆盖子集。

## 交付验收清单

- [x] 草稿 schema、迁移、store 窄更新和纯关闭判定的外部行为测试通过。
- [x] 独立 presence generation 已实现，`draftRevisionRef` 的推进点未增加。
- [x] renderer 回归覆盖重启后未激活仅附件草稿的取消与确认路径。
- [x] renderer 回归覆盖 legacy `unknown` 经成功空 list 收敛 `absent` 后直接关闭。
- [x] 异步回归覆盖慢 list 与 add/remove 交错，既有服务端附件不从 UI 消失。
- [x] 异步回归覆盖 list 失败、父级重渲染和 callback identity 变化。
- [x] `pnpm run test --scope 3e3c1cb` 报告受影响文件数非零且通过。
- [x] 定向测试、`pnpm typecheck`、Desktop build 通过；仓库无 lint 命令。
- [ ] 三条真机验收完成，逐条记录环境、动作、屏幕观察；第一条弹窗为主证据。
- [ ] 审计 R-02/R-14/G 登记、计数和模块说明同步；R-02 明写“未覆盖子集：无；依据是 …”，R-15 未改。
- [ ] 符合度反思确认无 PRD/spec/module-map/ADR 漂移，并记录测试剪枝结果。
