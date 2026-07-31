# 设计：provider-native-process-traces

## 1. 设计目标与不变量

过程标签继续表示“某个成员某一步的全部 attempts”，但每个 attempt 的内容由其实际
provider 原生事实定义：

```text
execution_session_link + run_execution_context
                    │
                    ▼
          ProcessTraceResolver registry
          ├─ codex  → rollout
          ├─ claude → transcript
          └─ kimi   → main wire
                    │
       shared attempt envelope / paging cursor
                    │
       engine-discriminated provider payload
                    ▼
        desktop adapter → console-ui ProcessTab
```

硬不变量：

- link 只来自执行时已经 fail-closed 核验的 external session id。
- provider 原生文件是唯一内容事实；Moebius 诊断流和最终回复不得 fallback。
- 根目录、候选唯一性、真实路径和读取期间文件身份必须可验证。
- 通用层只统一读取生命周期，不统一 provider 事件含义。
- 一次 attempt 的失败或缺失不得清空同一步其他 attempts。

## 2. Session ID 与 attempt 关联

`execution_session_link` 已包含：

```ts
{
  sessionId,
  runId,
  sourceMessageId,
  role,
  engine,
  externalSessionId,
  contextFingerprint,
  startedAt
}
```

过程读取按 `sessionId + sourceMessageId/stepId` 聚合 attempts，再以 runId 精确选择 link
和 immutable execution context。相同 run 的 link 同值重放幂等，engine、external id、
context 或归属冲突直接使该 attempt unavailable。

`attempt → external session` 是多对一关系：recovery、edit/resend、analysis write-lease
等 resume 路径会让多个 runs 继续写入同一个 provider session。沿用现有 Codex 语义，
本 change 不按 attempt 推断或切分原生文件区间。每个 attempt 保留自己的 engine、
计时、状态与模型元数据，但过程事件读取该 link 所指 external session 文件的全量窗口；
两个 links 指向同一个 external session 时，两次 attempt 的事件内容允许且预期同源重叠。
这避免用时间戳或 turn 边界制造不受 provider 契约保证的归属。

### Claude

full 在 spawn 前生成 UUID S，并把 S 传给 `--session-id`。只有
`system/init.session_id === S` 后 `onSessionStarted(S)` 才提交 link；terminal id 与
result id 仍受 driver / execution-driver 二次校验。resume 只传 canonical S，任何 T != S
都 fail closed。因此成功 link 的 `externalSessionId` 就是 transcript 文件名，不需要
再从 stream-json 捞 id。

### Kimi

full 只接受 `session/new` 返回的非空 id；resume 以 canonical S 调用
`session/resume`，provider 若返回 id 则必须等于 S，execution-driver 还会核对 result
id。因此成功 link 同样直接给出 Kimi session id。wire 只负责内容，不承担 session
identity 发现。

### 旧数据

旧 run 若有唯一、兼容的 `execution_session_link`，允许读取原生过程；没有 link、存在
冲突或缺少 immutable cwd 时只把该 attempt 标为 unavailable，不按 mtime、role、最近
session 或正文猜测。旧 `run_lifecycle.processOutputAvailable=false` 是旧版本 capability
投影，不再覆盖当前 resolver registry；engine 受支持但 trace 缺失时仍可打开标签查看
attempt 内降级。

## 3. `ProcessTraceResolver` 边界

建议接口：

```ts
interface ProcessTraceResolver<E extends LocalExecutionEngine> {
  readonly engine: E;
  resolve(input: TraceResolveInput<E>): Promise<TraceResolution<E>>;
  readInvocation(input: TraceInvocationInput<E>): Promise<ProviderInvocation<E>>;
  readPreviousPage(input: TracePageInput<E>): Promise<ProviderTraceSlice<E>>;
  readAppend(input: TraceAppendInput<E>): Promise<ProviderTraceSlice<E>>;
}
```

### 通用层负责

- 按 step/source message 聚合 attempts，并匹配 execution link 与 immutable context。
- capability registry、attempt 状态、计时、模型 / effort fallback 来源和 provider 名。
- trusted root / realpath / regular file / device / inode / minimum size 校验。
- 完整 JSONL record 的反向页读取、append cursor、半行等待、单条超预算独占响应。
- cursor envelope 中的 session、step、run、engine、文件身份与页方向校验。
- provider-neutral unavailable codes，例如 `link-missing`、`not-found`、`duplicate`、
  `outside-root`、`identity-changed`、`malformed`、`unreadable`。
- renderer DTO 的共享 attempt envelope。

### Provider adapter 负责

- 生效数据根和候选文件定位。
- session id / cwd / index / transcript 元数据交叉核验。
- prompt / context 分区的原生名称与来源。
- 原生记录到 provider-specific event DTO 的投影。
- provider-declared sidecar / blob 引用解析与范围校验。
- 未知事件的 raw payload 边界，以及该 provider 的 thinking / encrypted payload 策略。

DTO 不建立一个包含所有可选字段的“万能事件”。使用 discriminated union：

```ts
type ProcessTraceEvent =
  | { engine: "codex"; event: CodexTraceEvent }
  | { engine: "claude"; event: ClaudeTraceEvent }
  | { engine: "kimi"; event: KimiTraceEvent };
```

共享 envelope 只承载 key、engine、timestamp、protocolType 和展示顺序；事件详情由对应
renderer 分支消费。context 区同样使用带 provider label/source 的有序 sections，而不是
强制三层 prompt。

## 4. 共享文件身份校验

选择抽取 Codex 的低层文件身份保护，但不抽取 provider locator。

共享 `TrustedJsonlFile` 负责：

1. 对 configured root 做 `realpath`；
2. 对候选做 `lstat` / `realpath`，要求 regular file 且真实路径仍在 root 内；
3. 捕获 `realPath + device + inode + size`；
4. 每次 previous / append / invocation 读取前后复验 device、inode 和最小 size；
5. 文件被替换、截短、移出根或变成 symlink escape 时返回 cursor-invalid/unavailable；
6. 只返回完整换行 record，尾部半行等待下一次 append。

理由：这是三 provider 相同的本地文件安全与游标正确性不变量，复制三份容易产生安全
漂移；而候选发现和 schema 完全不同，强行共用会把 provider 私有约定泄漏进公共层。

Codex `resolveCodexRollout()` 保留 thread id filename 规则和 rollout schema，只把候选
检查及低层页读取迁到共享 helper。现有 Codex unavailable codes、分页结果与安全测试
必须保持兼容。

## 5. Claude resolver 与 projector

### 5.1 数据根与定位

reader 使用与 child environment 相同的根选择：

```text
non-empty CLAUDE_CONFIG_DIR
  ? <CLAUDE_CONFIG_DIR>/projects
  : <os home>/.claude/projects
```

Moebius 当前不设置或重写 `CLAUDE_CONFIG_DIR`；`buildClaudeEnvironment(process.env)` 只继承
用户进程环境，因此通常根是用户真实 `~/.claude/projects`。只有宿主启动环境已显式提供
非空 `CLAUDE_CONFIG_DIR` 时才使用该绝对目录。Claude 不存在 Kimi 的 managed home、
session index symlink 或旧根重锚定步骤，resolver 不创建受管镜像，也不回退到
Moebius data root。

Claude 官方只承诺 `<project>/<session-id>.jsonl`，不承诺 project key 编码算法。因此不
复制路径到连字符的私有算法。resolver 在 projects 的一级 project directories 中查找
精确文件名 `<S>.jsonl`：

- 只接受合法 UUID S；
- 不递归进入 session sidecar / subagent 目录寻找主 transcript；
- 零候选为 not-found，多个候选为 duplicate；
- transcript 中所有带 sessionId 的记录必须归一为 S；
- 至少一个带 cwd 的主记录必须与 immutable context 的绝对 cwd 相同；冲突为
  context-mismatch；
- 候选随后进入共享 trusted-file identity 校验。

这仍是确定定位：session id 在执行前已知且按精确文件名查找；扫描只解决 provider 未
公开 project key 算法，不从事件流、时间或最近 session 猜 id。虽然 trusted root 位于
用户真实 home，resolver 也只能打开 execution link 中由 Moebius 生成/核验的 UUID S，
且必须通过 immutable cwd 交叉校验；用户自己发起的其他 Claude 会话即使位于同一 root
也不会被按 cwd、mtime 或“最近”选中。同 UUID 出现多个候选时直接 duplicate fail
closed。

### 5.2 投影

Claude adapter 按 transcript 顺序投影：

- user / assistant / system / result / metadata；
- assistant content 的 text、thinking、tool_use；
- user content 的 tool_result；
- error / retry / hook / queue 等可读 provider 事实；
- 未识别记录的 protocol type 与文本化 raw payload。

thinking 作为 Claude transcript 已持久化的可读原生事件显示；encrypted 或 opaque
payload 不解密。tool result 若由 transcript 声明为 sidecar，只允许读取同一
`<project>/<session-id>/tool-results` 下的普通文件，并复用 trusted-root 防逃逸；
引用缺失只降级该事件，不改用 `claude-stream.jsonl`。

Claude 未记录 Codex 式 system/developer stack 时，context sections 只展示实际存在的
user / assistant / metadata，并明确“该引擎未记录”，不得从 Moebius persona 或当前
配置重组。

## 6. Kimi resolver 与 projector

### 6.1 source home、managed home 与 index

`resolveKimiRuntimeHomePaths()` 已给出：

```text
sourceHome  = KIMI_CODE_HOME 或 ~/.kimi-code
managedHome = <Moebius dataRoot>/.state/kimi-runtime-home
```

运行前 `prepareKimiRuntimeHome()` 把 managed home 的 `sessions` 与
`session_index.jsonl` 建成指向 source home 的受控链接，因此 Kimi ACP 的原生 session
最终写入 source home。过程 reader 直接把 source home 作为可信 provider data root；
managed link 损坏但 source 仍完整时，历史读取仍可用。source/index 本身缺失或不可读
时才返回 provider-data-unavailable。

官方 workDirKey 是：

```text
wd_<slug>_<sha256(workDir)[0..12)>
```

Moebius 不复制 slug 生成算法。resolver 读取 source
`session_index.jsonl`，按 exact sessionId S 归并记录：

1. 相同 S 的同值重复行幂等，冲突行 duplicate/conflict；
2. `workDir` 必须等于 immutable context cwd；
3. 从 `sessionDir` 只提取紧邻的 `workDirKey` 与 session basename，不信任其绝对根；
4. session basename 必须等于 S，key 必须匹配格式且 hash 后缀等于
   `sha256(workDir).slice(0, 12)`；
5. 以可信 `sourceHome/sessions/<workDirKey>/<S>` 重新构造候选。

重新锚定是必要兼容：实际 index 中可能保留旧 managed home 或一次性临时 data root 的
绝对 `sessionDir`，但 provider 数据已通过 symlink 写入 source home。直接打开 index
绝对路径会错误降级或越出当前可信根。

目标文件固定为 `agents/main/wire.jsonl`。零行、冲突行、cwd/hash 不匹配、重锚定后
缺失、symlink escape 或非普通文件都返回稳定 unavailable，UI 不接收 index 原文、
source path 或 OS 错误。

### 6.2 投影

Kimi adapter 保留 wire 原生顺序并投影：

- metadata / config / systemPrompt；
- turn.prompt / context.append_message；
- context.append_loop_event 中的可读 thinking、tool call、tool result、错误和状态；
- llm.request、tools snapshot、MCP discovery、permission、usage 与 turn terminal；
- 未识别 type 的文本化 raw payload。

provider-declared blob 只允许在同一
`sessions/<workDirKey>/<S>/agents/main/blobs` 根内读取。普通 Moebius Kimi run 已禁用
内部 Agent/AgentSwarm，首版只读取 main wire；不得扫描其他 session 或按 mtime选择。

## 7. Process history、capability 与 UI

### 7.1 Capability

运行中与历史 run 的 `processOutputAvailable` 由 resolver registry 是否支持 engine
派生，Codex/Claude/Kimi 均为 true。该字段只表示“有受支持的原生读取契约”，不表示
当前文件一定存在。

- active run 尚未取得 external id：过程标签显示等待 provider 建立记录并继续轮询；
- 已有 link 但 active 文件暂未出现：保持 loading/empty，不立刻定格为终态 unavailable；
- settled attempt 的 link/file 不可用：显示 provider-specific unavailable；
- 未知未来 engine：继续原位显示 capability unavailable。

### 7.2 API 与分页

现有 process history / invocation 窄接口保持 URL 级兼容，响应扩展 engine 与
provider-native union。previous cursor 跨 attempts 时携带每个 attempt 自己的 engine
与 file identity；append 只追踪当前活动 attempt。单个 provider 投影失败只生成该
attempt 的 malformed/unavailable 事件，不影响其他 attempts。

### 7.3 Renderer

ProcessTab 继续复用 attempt header、敏感信息提示、disclosure、虚拟列表和阅读锚点。
变化包括：

- context disclosure 从固定三层改为 provider sections；
- event renderer 按 engine discriminant 选择 Claude/Kimi/Codex 分支；
- unavailable 文案显示 provider 名，但不显示根路径、候选路径或解析异常；
- Claude/Kimi 的 thinking、tool call、tool result 使用可选择等宽文本；
- HTML、Markdown、ANSI 与控制字符继续只作转义文本；
- `sessionId + runId + engine` 隔离 idle/loading/ready/unavailable/error，迟到响应不得
  跨 tab/session/engine 覆盖。

父级重渲染、callback 身份变化、慢返回、失败重试和 tab 切换继续作为必须测试的环境
假设，不允许只覆盖稳定引用 happy path。

## 8. 失败路径与兼容性

| 失败 | 收敛 |
| --- | --- |
| execution link 缺失/冲突 | 仅该 attempt unavailable，不猜 provider session |
| provider data root/index 缺失 | provider-specific unavailable，无裸路径 |
| 零候选/多个候选/cwd 不匹配 | unavailable，不按 mtime 或最近会话回退 |
| symlink escape/非普通文件 | outside-root / not-a-file |
| inode 替换/文件截短 | cursor-invalid，停止拼接 |
| malformed JSONL/超长单条 | 单次 malformed；其他 attempts 可读 |
| sidecar/blob 缺失或越界 | 只降级对应事件 |
| 原生文件被清理 | 只降级该 attempt，最终回复仍在主时间线 |
| active trace 暂未创建 | 等待并轮询，不伪造终态 unavailable |

回滚时可撤销 Claude/Kimi registry entries 和 UI 分支，Codex adapter 继续使用相同公共
identity helper。新增事实只复用既有 execution links，不需要数据库或 session JSONL
迁移。

## 9. 验证设计

### 自动化

- shared identity：root 不存在、symlink escape、duplicate、inode swap、truncate、
  append 半行、超大单 record。
- Claude resolver：自定义 `CLAUDE_CONFIG_DIR`、精确 UUID、多个 project 候选、cwd
  冲突、thinking、tool use/result、sidecar 缺失/越界、unknown record。
- Kimi resolver：默认/自定义 source home、旧 managed absolute sessionDir 重锚定、
  workDir hash 不匹配、相同重复/冲突 index 行、断链、wire/blob 缺失与 unknown type。
- process history：三 engine 多 attempts、provider 混合步骤防串线、旧
  `processOutputAvailable=false`、active trace 延迟出现、单 attempt 清理。
- UI：三 provider context/event 分支、thinking/tool call/tool result、unavailable、
  虚拟化、阅读锚点；父级重渲染、callback 身份变化、慢/失败返回与切换后的迟到响应。
- 回归：Codex prompt stack、token/reasoning 过滤、分页、历史 unavailable 保持不变。

### 真实运行验收

1. `pnpm desktop` → 选择 Claude 成员执行一条会产生唯一 thinking 线索、工具调用和唯一
   工具输出标记的任务 → 在运行记录或历史回复打开「完整输出」：
   - 右侧栏打开该步骤唯一过程标签并标明 Claude；
   - 对应 attempt 可展开看到 transcript 中真实 thinking、工具名/参数和唯一工具结果；
   - 页面不出现 Codex rollout 内容，也不把 `claude-stream.jsonl` 标成事实源。
2. `pnpm desktop` → 选择 Kimi 成员执行同类任务 → 打开「完整输出」：
   - 过程标签标明 Kimi；
   - 可展开看到 wire 中真实 thinking / loop event、工具名/参数和唯一工具结果；
   - 页面不借用 Codex 内容，也不把 `kimi-acp.jsonl` 标成事实源。
3. 对上述专门创建的 Claude 或 Kimi attempt，把唯一原生 transcript/wire 移到系统临时
   备份目录后重新打开过程标签：
   - 只该 attempt 显示“Claude/Kimi 过程记录已不可用”；
   - 主对话最终回复和同一步其他 attempt 仍存在；
   - 页面没有 stdout/stderr、最终回复副本或另一 provider 内容；
   - 验收结束后恢复备份，不删除其他 session 数据。
4. 选择 Claude 或 Kimi 创建一次失败 attempt，再通过 recovery/retry 明确走
   `resume` 同一 external session，随后重启桌面：
   - 两次 attempts 各自保留相同 engine 以及各自计时、状态和模型元数据；
   - 两个 attempts 的事件内容明确标示同源于同一个 external session 文件，允许显示
     同一份累积 transcript/wire 全量，不要求按 attempt 切出不同事件区间；
   - 阅读位置、向上分页与“到最新”行为保持现有规则。

测试、typecheck、必要构建全绿只是代码验证门槛；上述每条真实页面断言均需给出实际
运行 evidence，缺任一项不得声明 `code-verified`。
