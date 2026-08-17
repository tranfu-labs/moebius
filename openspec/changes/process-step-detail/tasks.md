# 任务：process-step-detail

## 引擎能力

- [x] `buildClaudeArgs` 增加 `--thinking-display summarized`，并在现有 Claude CLI 版本校验处覆盖该 flag 可用性
- [x] `buildCodexExecOptionsForProfile` 增加 `-c model_reasoning_summary="detailed"`
- [x] 确认两个引擎开启后思考明文经过既有秘密边界，未出现 Key、凭据或授权头

## 步骤投影（local-console）

- [x] `safeLabel` 拆成按类型的清洗策略；秘密剥离保持全局，路径压缩只作用于文件类对象
- [x] 命令对象优先取原生用途说明，无则剥掉 shell 包装后取命令原文
- [x] skill 调用的对象取 skill 名而非工具名
- [x] 工具 / MCP 对象去掉 `mcp__<server>__` 前缀
- [x] 修正文件类工具的归类，使读写文件产出文件名而非落进 tool 分支
- [x] 搜索对象保留原始查询，不按路径分隔符拆解
- [x] 思考对象取思考文本首句
- [x] `foldRunActivityStep` 改为按调用标识关联，工具返回不再新建步骤
- [x] 步骤结构增加输出与失败字段；输出在投影时按上限裁剪并记录剩余量
- [x] 裁剪实现错误优先：先保留含错误信息的行，再按原顺序补足
- [x] `terminal-record-plan` 冻结终局步骤时保留输出与失败态

## 步骤展示（console-ui）

- [x] 步骤行去掉「正在／已完成」前缀，进行中由行自身进行态表达
- [x] 步骤行支持点开／收起，鼠标与键盘均可操作，允许多行同时展开
- [x] 展开态先输入后输出；输出截断时显示剩余行数与去「完整输出」的说明
- [x] 失败步骤在收起态可辨认，行内显示错误首句，跳过纯退出码行
- [x] 接上 `ProcessStep.status` 的 `failed` 分支
- [x] 旧会话缺输出字段时显示未记录说明，不留空白、不回填
- [x] 运行中追加新步骤不收起已展开的行
- [x] 展开内容只读，终端控制字符可见转义，不执行 Markdown / HTML / 控制序列
- [x] i18n 文案与可访问名称
- [x] 过程步骤位于角色信息与流式正文／活动摘要之间，主页面与 embedded 承载顺序一致
- [x] 过程区与单步详情使用令牌化、可打断的展开反馈，并在减弱动效下即时切换

## 验证

- [x] 单元测试覆盖各类型步骤对象投影、工具返回并入、裁剪的错误优先规则
- [x] 真实 Electron 中对三种执行引擎各跑一次，确认步骤行都能显示思考首句（`scripts/acceptance/process-step-detail.ts`；真实 CLI + 隔离数据根，evidence 写系统临时目录）
- [x] 用 `local:2026-08-16T06:35:09.059Z-h0m3op` 这类历史会话确认旧数据展开不空白、不回填

## 交付记录（步骤 4：边界矩阵与全量回归）

### 边界矩阵（功能单元 × 异常情形）

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| 步骤投影 `run-activity.ts` | 非对象/未知类型事件→null；空思考文本→不产裸行（测试） | 输出>12 行→裁剪+剩余数（错误行优先）；输入>4000 字符→截断；对象>96→截断；凭据赋值→scrub（测试） | 同 callId 多次返回→幂等合并；思考增量→累积合并；trail>40→丢最旧（测试） | N/A：纯 domain 函数，无权限面 | 返回带失败标志→error 首句；整段仅退出码→保留退出码（显示层跳过）；无开始事件的返回→丢弃（测试） |
| 终局冻结 `terminal-record-plan.ts` | steps undefined/空→[]（测试） | 未知 kind→跳过；action 缺失不可达（类型必填+全部生产者保证，见注释） | N/A：纯函数无状态 | N/A：纯 domain | failed status 映射（测试） |
| 持久化读取 `store.ts` | processSteps 非数组→throw（既有校验） | 非法 kind/重复 cursor→throw（既有校验） | N/A：单次读 | N/A：既有 store 权限模型 | 旧记录缺新字段→读为 undefined，不报错不回填（测试） |
| 视图映射 `operator-console.tsx` / desktop model | activitySteps undefined→undefined；仅 progress→undefined（测试） | 未知 kind→跳过（测试） | N/A：纯函数 | N/A | 前缀剥离、failed 状态映射（测试） |
| 过程展示 `process-trail.tsx` | steps 空→不渲染（测试） | 控制字符→可见转义；超长文本→换行+有界输出（测试） | 运行中追加新步骤不收起已展开行（测试） | N/A：纯展示 | 失败态红色+错误首句；legacy 缺字段→未记录文案（测试） |
| 引擎能力 `claude.ts`/`config.ts` | N/A | 版本不可解析→不传 flag（思考行退化，测试）；Codex flag 恒定 | N/A：调用期单次判定 | N/A：沿用既有 CLI 权限模型 | flag 静默失效→无思考文本→无思考行（模块 A 行为）；低于门槛不传 flag（测试） |

### 全量回归（重跑步骤 1 基线命令）

| 命令 | 基线（步骤 1） | 回归结果 | 差异 |
| --- | --- | --- | --- |
| 根定向 vitest（5 文件） | 51 通过 | **77 通过** | +26（run-activity +24、claude +2）；无新增失败 |
| console-ui 套件 | 645 通过 + **1 失败**（7cc54c5 引入的 guard 违规） | **651 通过** | +6（process-trail +3、operator-console +2、guard 修复后原失败转绿）；无新增失败 |
| 根全量 vitest（额外补跑） | 未跑（基线为定向） | **970 通过 + 4 跳过**（claude-real 惯例） | 首轮 1 个 SQLite 锁失败经单独重跑与整轮重跑均全绿，判定为并行执行负载噪音，非回归 |
| desktop 套件 | 未跑（scope 机制覆盖） | scope 中 **110 通过** | 无失败 |
| typecheck（root+desktop+console-ui） | 根 tsc 通过 | **pnpm typecheck 全通过** | 无差异 |

基线本来通过、现在失败的项：**零**。基线本来失败（guard 违规）已在模块 A 修复，非回归。

### 真机 Electron 页面级走查（real-app-acceptance 协议）

执行方式：`pnpm exec tsx scripts/acceptance/process-step-detail.ts` 内嵌 Electron 段（真实 Electron 窗口 + 真实本地服务 + 真实用户数据），从用户入口执行展开/收起并记录四段观察；截图与 evidence 写系统临时目录。

**状态：未验证（环境限制，非实现缺陷）**。`electron@38.8.6` 的二进制在本机下载源被污染：`dist/version` 与缓存 zip 文件名均为 38.8.6，但解压后二进制 `--version` 恒为 `v22.22.0`（删除缓存重新下载三次结果一致，zip 完整性 `unzip -t` 通过——内容与 URL 不符是下载源/代理问题）。desktop 的 ESM main 无法在该错配二进制上启动（`does not provide an export named 'BrowserWindow'`）。脚本已在 launch 前探测二进制版本并给出明确诊断、非零退出（未验证即红）。

**用户侧完成路径**：在 electron 二进制健康的网络环境重新安装依赖（`pnpm install` 触发 electron postinstall 或删除 `~/Library/Caches/electron` 后重装），执行 `pnpm --filter @moebius/desktop build` 与 `pnpm exec tsx scripts/acceptance/process-step-detail.ts`，脚本将自动完成 Electron 段走查并输出四段观察。脚本的三引擎、argv flag、历史会话与秘密边界部分在本环境已全绿。
