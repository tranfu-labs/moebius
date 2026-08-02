# 任务：four-layer-10-local-console

## A · 护栏与对账

- [x] 冻结项目/会话、primary、worker、terminal/recovery 外部行为矩阵
- [x] 从系列 design 复制 10 批四条精确 test-name 映射，建立 ledger；补齐 duration、最终替代纯测试、等价分支、保留接缝和删除/保留结论
- [x] 生产迁移前先补缺失纯测试；不得读取源码文本做镜像断言

## B · 纵切实现

- [x] 提取项目/会话 command/query application flows 与 domain policy
- [x] 提取 primary execution application flow，消费现有 planners
- [x] 提取 worker execution application flow，保持两种 origin 与 role lane 语义
- [x] 提取 terminal/recovery transition；保留 fact/store/provider adapter
- [x] 把 `runtime.ts` 收为 façade/composition + active runtime state，删除本 change 对应 layer debt

## C · 测试剪枝

- [x] 每个被删/合并 test name 先取得 duration 样本并填写 ledger（最终无删除/合并）
- [x] 保留 HTTP+SQLite、restart、provider facts、failure 和并发唯一接缝
- [x] 对比迁移前后定向稳定集合；无法归因的速度变化记零

## D · 验证与真机

- [x] `pnpm run test --scope <base>`、定向测试、typecheck、desktop build 全绿
- [x] 执行 RA-01～RA-04，按真机协议记录页面入口和可见信号
- [x] 报告纯比例、定向/完整闸门预期与实际、集成测试净变化
- [x] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

## 交付记录

### 架构与 debt

- `runtime.ts`：5535 物理行基线 → 308 物理行 / 299 逻辑行；满足 composition root ≤300
  逻辑行，保留 façade、对象装配和 active-run 状态所有权。当前只剩 1 逻辑行余量；20/40 批若需
  修改该 root，必须同步挤出空间，或在对应 change 中显式重审 root 方案，不得放宽门禁。
- composition root exact allowlist 最终 8 条；新增 `start.ts` 后，把原
  `run-lifecycle-runtime.ts` 收回 application shape，未扩大豁免区。
- `four-layer-10-local-console` 绑定的 15 条 debt 全部清零；`pnpm check:boundaries` 通过
  （460 source files / 374 production files / 3 roots）。
- `server.ts` 1345 物理行、`store.ts` 1878 物理行；runtime 规则没有位移到这两个 adapter。
  `server.ts` 的下降来自把进程启动 composition 搬到 `start.ts`，存储端口抽象未重画。
- fact-path 接线回归由本批 `814e26d` 引入（run-output 提取后仍经完整 session fact write
  funnel 取路径），由 `998f734` 修复（改注入窄 `getSessionFactLogPath` capability）；这是本批
  重构接线错误的修正，不是顺手改变存量产品行为。
- 按 00 批同一 logical-line 脚本，domain closure 从 74 文件 / 10,024 行增至 113 文件 /
  15,032 行，增加 5,008 行。用 00 批人工基线 10,301 行、34–41% 校准后，本批累计纯逻辑/
  业务规则约 **51–61%**；区间覆盖方案目标 48–57%，不把 contracts 与规则混算成单点精度。

### 测试对账与回归保障

- 四条 ledger 集成测试三次成功样本中位数：routing 331ms、worker atomic claim 175ms、
  workspace/team switch 621ms、edited-resend resume 347ms；对应四组纯测试 31 项 / 8ms 全绿。
- 四条集成测试均承担 HTTP+SQLite、真实原子 claim、restart 持久状态或 provider link/cursor
  唯一接缝，最终全部保留；集成测试净变化 0、可归因速度收益记 0。
- 合并点完整闸门暴露 `tests/desktop-runtime-provider-scope.test.ts` 的 6 条源码镜像断言：它们递归读取
  生产源码并冻结 provider import 文件名、调用字面量与 helper 名称，重构后只能靠复制新路径/文本修绿，
  不断言外部行为，故按即时剪枝规则整文件删除。它试图约束的 provider 具体实现扩散已由
  `[IB:architecture-layer-dependency-matrix]`、`[IB:adapter-boundary-branch-total]` 和
  `[IB:domain-pure-runtime-closure]` 的 AST/传递闭包门禁接管。provider full/resume 与身份失败关闭继续由
  `codex.test.ts`、`kimi.test.ts`、`claude.test.ts`、`local-console-execution-driver.test.ts` 和
  `local-console-execution-runtime.test.ts` 覆盖；外部路由与数据根分别由 `format-ceo.test.ts` / runner
  行为测试和 `runtime-start.test.ts` / 配置路径行为测试覆盖。本批最终删除 6 条镜像测试，不以新实现
  文本改写旧断言。
- `pnpm run test --scope 161ee19`：64 files（63 pass / 1 skip），635 tests（631 pass /
  4 skip），另 desktop scope 1 file / 2 tests；退出码 0，74.18s + 0.617s。
- `pnpm typecheck`、`pnpm --filter @moebius/desktop build`、定向 process/lifecycle/ledger
  测试均退出码 0。
- 首次合并点 `pnpm test`（Node 24.18.0）执行 80.15s 后红于上述镜像测试：121 files passed /
  1 failed / 1 skipped，1038 tests passed / 2 failed / 4 skipped；生产行为测试无失败。删除镜像测试后
  重跑其行为覆盖半径 7 files / 198 tests 全绿（9.60s），`pnpm check:boundaries` 与 `pnpm typecheck`
  同步全绿；主理人重新点名后执行修正闸门。
- 修正后完整 `pnpm test`（Node 24.18.0）全绿：root 121 files / 1034 tests、slow 1 / 63、
  desktop 66 / 431、console-ui 45 / 459，另 root 1 file / 4 tests skipped；总墙钟约 117s
  （06:57:50–06:59:47），相对 Node 24 基线 119.24s 的单样本观察为 -2.24s。由于测试组合同时增长且
  只有一次样本，不声明可归因速度收益，仍按 0 记账。

### RA-01～RA-04 真机记录

环境（QA 补齐）：dev Electron（`desktop/node_modules/.bin/electron .`，`MOEBIUS_DATA_ROOT=/tmp/moebius-ra10-zT1Ozl`
临时数据根，零 mock），经 ADR-0002 dev-only CDP 9222 通道 attach 真实窗口操作与断言；Node v24.18.0；
provider 为真实 Codex CLI（codex-cli 0.146.0，ChatGPT 订阅登录）。驱动脚本与四次启动日志留于临时数据根
`driver/` 与 `electron-restart*.log`。

- **RA-01**：入口＝主页面新建对话；操作＝选择 project-alpha 后发送「请只回复 RA01-OK…」；屏幕观察＝依次出现
  用户消息（`timeline-message-1`）、运行中事实（`active-run-block`「已进行 00:10 · 正在处理」）、同一会话
  内容生产总控终局（「耗时 00:11」+ 正文 `RA01-OK!`）。重启后两条消息与「耗时 00:11」终局仍在，
  服务端 `messageCount=2`（user+agent）、`activeRuns=0`，无重复 Agent 回复；与承诺一致。
- **RA-02**：入口＝同会话运行中；操作＝发送长输出任务后点击「停下主理人」，随后点击「重试」；屏幕观察＝
  停下后出现非成功终局「你让这一步停下了。已经产生的文件改动会保留。」（耗时 00:15，重试/换执行配置/
  改一改重发入口齐）；重试后同一会话重新运行并完成（耗时 00:22，输出 1–400）。服务端对账：中断终局记录
  归属原 run（`…c5ln06oz`，`terminal.kind=interrupted/subkind=user`），重试正文归属新 run（`…wekhl42e`），
  attempt 归属正确；与承诺一致。备注：本次中断发生在 agent 产出正文之前（`partialMarkdown=""`），
  「保留中断前正文」只以空样本验证，非空保留路径未取到样本。
- **RA-03**：入口＝主页面 composer；操作＝①直接 `@内容情报与证据`；②要求总控把任务交给 `@内容创作与编辑`；
  ③一条消息同时 `@内容情报与证据 @视觉内容生产`；④两个会话分别向不同成员发长任务形成跨会话并行。
  屏幕观察＝被提及成员身份正确出现（内容情报与证据回复 `RA03-INTEL`）；handoff 链完整（总控 →
  内容创作与编辑 `RA03-WRITE` → 总控「交接已完成。」），每条消息的身份与过程标签按对应成员/attempt
  归属；跨会话并行窗口约 14 秒（22:38:04–22:38:18，A 会话 visual-production 与 B 会话
  editorial-production/总控收尾重叠），双方消息角色归属互不串扰；与承诺一致。备注：同一消息双提及由
  总控串行派发（未形成会话内并行 lane），并行以跨会话方式验证。
- **RA-04**：入口＝左侧栏会话菜单/项目菜单/搜索；操作与观察＝「标记为已读」（未读徽标消失，服务端
  `unreadSince=null`）→「置顶」（`pinnedAt` 落库）→「重命名对话」为 `RA04-归档演练`；重启后标题、置顶
  （侧栏「置顶」分组）、已读全部保持。「归档」后会话从列表消失，经「搜索 → 包含已归档对话」找到并
  「恢复并打开」；再「标记为未读」；重启后恢复可见与未读均保持。「移除项目」弹确认框（明示对话将归档、
  磁盘文件夹保留），确认后项目从侧栏消失（`projects=[]`），重启后仍消失；与承诺一致。备注：项目修复
  不在本批行为矩阵（矩阵只含归档/移除边界），未执行；归档会顺带清除置顶状态（恢复后不再置顶），
  操作语义如此，非持久化缺陷。

四条 RA 全部通过；`code-verified` 的 RA 前置已补齐，剩余唯一一次完整 `pnpm test` 按合并点规则
留给主理人复核通过后执行。RA-02 未取得非空 `partialMarkdown` 真机样本；该缺口由纯测试覆盖至
50 批，并要求在 RA-16 联合 smoke 中取得一次非空样本后关闭。
