# 任务：fix-inactive-analysis-draft-close-confirmation

- [x] 护栏先行：在 `sidebar-conversation-drafts.ts` 增加纯关闭判定并扩充既有单测，覆盖空草稿、正文 / 文本胶囊 / context 变化、仅附件及附件移除后的边界；不接 UI、不读 I/O。
- [x] 扩展 `useManagedAttachmentDrafts` 的窄公开面：增加稳定的按 draft key 附件存在查询，读取现有 keyed ref，任意 attachment 状态均计入；不暴露全量 record或复制计数 state。
- [x] 接入 `app.tsx` 的 R-02 关闭回调：按被关闭 draft 的 attachment key 查询并调用纯判定；取消时在所有 mutation 前返回，确认 / 空草稿沿用既有 remove、list refresh、clear 顺序。
- [x] Renderer 回归：在既有 App 内存 harness 覆盖草稿 A 仅附件、切换 B、关闭 A；同时覆盖父级重渲染、callback identity 变化、慢成功 / 失败异步返回、取消保留标签 / 附件 / 选中 / 焦点和确认后只清 A，不新增真实 I/O 或固定 sleep。
- [x] 即时剪枝：核对旧草稿与关闭测试；合并同一代码分支的重复边界值，删除已失去意义的断言并在交付记录点名，或明确记录无需删除；不做镜像式“修绿”。
- [x] 审计同步：把 `console-state-composition-audit.md` 的 R-02 标为“已确认缺陷（部分消解）”，补纯判定 / keyed 查询 / 测试坐标和实际覆盖子集；撤销 G-07，新增 R-14/R-15 与归档入口未验证观察，保持其他既有候选不变。
- [x] 定向验证：运行两份 Desktop 测试；确认 `78adb95` 为祖先后运行 `pnpm run test --scope 78adb95` 且受影响文件数非零，再运行 `pnpm typecheck` 与 Desktop build；不自行运行完整 `pnpm test`。
- [x] 真机验收：按 `design.md#真机验收语句` 逐条记录入口、操作、屏幕观察、环境与结论，附件只从真实 UI 加入；取消路径必须证明 A 标签 / 附件和原选中 / 焦点都保留。
- [x] 符合度反思：逐条核 `design.md#方案验收清单`，确认范围仍是 R-02、PRD / spec / module-map / ADR 无漂移，记录未验证项。
- [x] QA / 主理人独立复核与合并点收口：QA 发现重启缺口，主理人裁决为部分消解并拆出 R-14/R-15；审计已按裁决修正，完整 `pnpm test` 已在合并点通过，change 可归档。

## 实施与验收记录

### 真机验收（2026-08-01，真实 Electron 开发态）

- **环境**：以真实本地数据根启动完整 Electron，页面经真实 preload / IPC / local-console 服务加载；草稿、文本胶囊和附件均由页面入口操作产生，未通过 API、localStorage 或 fixture 预置。验收结束后经页面关闭临时标签，草稿与附件现场清理为零。
- **主证据——非当前仅附件分析草稿取消关闭**：从左侧真实对话的“在右侧栏分析这段对话”创建 A，经页面附件入口选择 `README.md`，保持正文为空；创建并切到 B 后点击 A 的关闭按钮。屏幕出现原生 `confirm`，消息为“丢弃这段尚未发送的新对话？”。选择取消后 A/B 都在、B 仍选中、焦点回到 A 的关闭按钮；重新选择 A 后 `README.md` 附件仍可见。结论：符合验收 34，弹窗出现为主证据，现场保持为辅证。
- **确认只丢弃目标草稿**：切回 B 后再次关闭 A 并接受同一丢弃确认。A 标签消失，B 保持选中；关闭结果写入右栏 tab store 与草稿 store，重启 Electron 后 A 未恢复、B 保持，A 附件不再出现。结论：目标草稿与附件被丢弃，非目标现场保留。
- **空的非当前分析草稿直接关闭**：再次从分析入口创建 A，经页面删除唯一“文本片段 1”，确认正文为空、无文本胶囊、无附件且上下文未改；切回 B 后点击 A 关闭。500ms 观察窗内无 dialog 事件，A 消失、B 保持选中。结论：空草稿不误弹确认。

### 自动验证

- 定向测试：2 个文件、24 个测试通过；日志 `/tmp/moebius-r02-targeted.log`。
- scope 闭环：`pnpm run test --scope 78adb95` 报告 5 个受影响测试文件（非零），5 个文件、52 个测试通过；日志 `/tmp/moebius-r02-scope.log`。
- `pnpm typecheck` 通过；日志 `/tmp/moebius-r02-typecheck.log`。
- `pnpm --filter @moebius/desktop build` 通过；日志 `/tmp/moebius-r02-build.log`。
- 合并点完整闸门：首次后台进程随 provider turn 结束而中断、没有产生汇总，未计作完成；收口运行 `pnpm test` 退出码 0。根套件 97 个文件通过、1 个跳过（947 passed / 4 skipped），Desktop 65/65 文件（425/425），console-ui 45/45 文件（459/459）；日志 `/tmp/moebius-r02-full-rerun.log`。
- 仓库未配置 lint；未运行不存在的命令。

### 符合度反思与剪枝

- 改动只触及 R-02 的纯判定、附件按-key 查询、页面接线、对应测试与审计登记；R-08、迟到提交族、页面结构、IPC、持久化格式和其他关闭规则均未修改。
- 产品意图未变；PRD、现行 spec、module-map 与 ADR 无需修改。QA 复核证明同会话保护不能外推到重启窗口，因此审计文档把 R-02 诚实标为部分消解，撤销 G-07，并独立登记 R-14/R-15；其他既有候选保持不变。
- 本 change 不修 R-14/R-15：重启后从未激活的草稿附件不可见，以及 `clearDraft` 不清服务端资源，分别留给独立 change。真机“确认后重启不恢复”证明已激活并确认关闭的子集，不证明“重启后关闭未激活草稿”。
- 新纯判定复用既有 `sidebarConversationDraftHasUserChanges`，附件边界合并进原草稿变化测试；renderer 只增加一个覆盖完整异步环境假设的场景。旧测试均仍对应被需要的外部行为，没有镜像断言或与新增场景重复覆盖同一接缝，因此无需删除。
- 开发态首次以“只等待 dialog 事件”的自动化尝试会被 Playwright 自动处理，结果已丢弃；正式证据全部来自重建现场后的显式 dismiss / accept 处理器与再次运行，不把该控制器误用计作验收结果。
