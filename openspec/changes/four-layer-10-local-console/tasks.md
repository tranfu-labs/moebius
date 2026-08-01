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
- [ ] 执行 RA-01～RA-04，按真机协议记录页面入口和可见信号
- [x] 报告纯比例、定向/完整闸门预期与实际、集成测试净变化
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

## 交付记录

### 架构与 debt

- `runtime.ts`：5535 物理行基线 → 308 物理行 / 299 逻辑行；满足 composition root ≤300
  逻辑行，保留 façade、对象装配和 active-run 状态所有权。
- composition root exact allowlist 最终 8 条；新增 `start.ts` 后，把原
  `run-lifecycle-runtime.ts` 收回 application shape，未扩大豁免区。
- `four-layer-10-local-console` 绑定的 15 条 debt 全部清零；`pnpm check:boundaries` 通过
  （460 source files / 374 production files / 3 roots）。
- `server.ts` 1345 物理行、`store.ts` 1878 物理行；runtime 规则没有位移到这两个 adapter。
  `server.ts` 的下降来自把进程启动 composition 搬到 `start.ts`，存储端口抽象未重画。
- 按 00 批同一 logical-line 脚本，domain closure 从 74 文件 / 10,024 行增至 113 文件 /
  15,032 行，增加 5,008 行。用 00 批人工基线 10,301 行、34–41% 校准后，本批累计纯逻辑/
  业务规则约 **51–61%**；区间覆盖方案目标 48–57%，不把 contracts 与规则混算成单点精度。

### 测试对账与回归保障

- 四条 ledger 集成测试三次成功样本中位数：routing 331ms、worker atomic claim 175ms、
  workspace/team switch 621ms、edited-resend resume 347ms；对应四组纯测试 31 项 / 8ms 全绿。
- 四条集成测试均承担 HTTP+SQLite、真实原子 claim、restart 持久状态或 provider link/cursor
  唯一接缝，最终全部保留；本批测试删除 0、合并 0、集成测试净变化 0、可归因速度收益记 0。
- `pnpm run test --scope 161ee19`：64 files（63 pass / 1 skip），635 tests（631 pass /
  4 skip），另 desktop scope 1 file / 2 tests；退出码 0，74.18s + 0.617s。
- `pnpm typecheck`、`pnpm --filter @moebius/desktop build`、定向 process/lifecycle/ledger
  测试均退出码 0。完整 `pnpm test` 尚未运行，按合并点规则留给主理人复核通过后执行。

### RA-01～RA-04 真机记录

环境：`pnpm desktop` 启动了真实 Electron，并连接生产 local server / SQLite
（`http://127.0.0.1:49905/`，工作区 `.state/local-console.sqlite`，无 mock/stub）。当前 session
没有暴露 Electron CDP 控制后端；macOS System Events 又返回 assistive access `-1728`，无法从
真实窗口执行或观察用户动作。按真机协议，不以 Chrome 本地页、HTTP 直调或自动化测试抵扣：

- **RA-01**：入口＝真实 Moebius 主窗口；操作＝未执行；屏幕观察＝未取得；与承诺一致否＝未验证。
- **RA-02**：入口＝真实 Moebius 主窗口；操作＝未执行；屏幕观察＝未取得；与承诺一致否＝未验证。
- **RA-03**：入口＝真实 Moebius 主窗口；操作＝未执行；屏幕观察＝未取得；与承诺一致否＝未验证。
- **RA-04**：入口＝真实 Moebius 左侧栏；操作＝未执行；屏幕观察＝未取得；与承诺一致否＝未验证。

因此本 change 当前不能声明 `code-verified`；须由具备 Electron CDP 或 macOS 无障碍权限的 QA/
主理人补齐四条真机记录后再进入完整闸门合并点。
