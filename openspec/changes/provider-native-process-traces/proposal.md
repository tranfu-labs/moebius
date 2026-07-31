# 提案：provider-native-process-traces

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-right-sidebar.md` | 过程标签 | 把完整输出从 Codex-only 扩为 Codex rollout、Claude transcript、Kimi wire 三种 provider 原生事实 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | 页面状态 | 把 Claude/Kimi 的步骤级能力降级改为单次 attempt 原生记录不可用降级 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | 指标与验收 | 增加 Claude/Kimi 原生 thinking、工具调用、工具结果及记录清理后的真实运行验收 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | 已知隐患 / 非目标 | 统一三 provider 留存风险，并明确不固化 Moebius stream/ACP 诊断日志 | 已写入 |

## 背景

本地运行时目前在主 Agent 与专业成员两条路径都硬编码
`processOutputAvailable: executionContext.engine === "codex"`，过程读取层又只消费
`codex_thread_link` 并调用 `resolveCodexRollout()`。因此 Claude 与 Kimi 从未进入过程
解析；界面上的“当前执行引擎不提供可恢复的完整过程记录”不是 provider 报错或解析
失败，而是应用自身的 Codex-only capability 判断。

这个判断已不符合当前官方能力：

- Claude Code 以已知 session id 在 `~/.claude/projects/<project>/<session-id>.jsonl`
  （或生效 `CLAUDE_CONFIG_DIR`）持续保存 transcript，官方定义包含消息、工具调用和
  工具结果并用于 resume。
- Kimi Code 以 `session_index.jsonl` 索引
  `sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl`，官方定义 wire 为 session
  recovery / replay 和 request trace 的原生事实。
- Moebius 已为 Codex、Claude、Kimi 全部写入 `execution_session_link`，包含 engine、
  external session id、run、workspace / context 指纹；Claude/Kimi 的成功执行也已对
  requested / observed / returned id 做 fail-closed 一致性校验。

因此不需要第三方记录工具，也不需要把 `claude-stream.jsonl` 或 `kimi-acp.jsonl`
升级成第二份事实源；缺口是 provider 原生记录的可信定位、身份校验、分页、投影和 UI
分派。

外部协议依据：

- Claude sessions / transcript：
  https://code.claude.com/docs/en/sessions
- Claude application data：
  https://code.claude.com/docs/en/claude-directory
- Kimi sessions / wire：
  https://moonshotai.github.io/kimi-code/en/guides/sessions.html
- Kimi data locations / workDirKey / index：
  https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html

## 已确认产品选择

1. “完整”按 provider 原生事实定义，不要求三引擎字段对齐；当前引擎没有记录的字段
   显示“该引擎未记录”，不得补造、推断或借用另一引擎字段。
2. 事实源只使用 Codex rollout、Claude transcript、Kimi wire。
   `claude-stream.jsonl`、`kimi-acp.jsonl` 与 stdout / stderr tail 继续只做执行期诊断。
3. 留存语义与 Codex 一致：原生文件存在即可读取；被清理、损坏、重复、越界或不可读
   时只降级该 attempt，不以最终回复或其他文件替代。

## 提案

### A. Provider-neutral 过程读取编排

- 以既有 `execution_session_link + run_execution_context` 作为三 provider 的统一 attempt
  关联，不再为新 provider 建第二套 session link。
- 引入 `ProcessTraceResolver` registry，由 `process-history` 按 engine 分派；通用层负责
  attempt 聚合、可信文件身份、反向分页、append cursor、元数据 envelope 与稳定错误，
  provider adapter 负责定位和原生事件投影。
- 把 `processOutputAvailable` 从 `engine === "codex"` 改为 capability registry 派生。
  旧 lifecycle fact 中的 `false` 不再永久屏蔽已受支持 provider；缺少 link 或原生记录
  时进入 attempt 内 unavailable，而不是不提供入口。

### B. Claude transcript

- full 的 UUID 由 Moebius 生成，且只有 `system/init.session_id` 精确匹配才持久化 link；
  resume 的 requested / observed / terminal id 也必须匹配。因此成功 link 已直接给出
  transcript session id，不需要从 stream 事件重新提取或按时间猜测。
- 在生效 Claude data root 的 `projects/*/<session-id>.jsonl` 中按精确文件名定位，校验
  transcript 内 session id 与 immutable cwd；零个、多个、冲突或越界候选均 unavailable。
- 投影 transcript 的 user / assistant / system / metadata、可读 thinking、tool use、
  tool result 与错误；provider 未记录的 prompt 层明确标未记录。大工具结果只可跟随
  transcript 声明的受控 sidecar 引用读取，不接受任意路径。

### C. Kimi wire

- full 直接使用 `session/new` 返回 id；resume 只接受保存 id，provider 返回不同 id 时
  现有 driver 已 fail closed。因此 link 已给出确定 session id，不需要从 wire 反查。
- Kimi 官方 `workDirKey` 格式为
  `wd_<slug>_<first-12-chars-of-sha256(workDir)>`。Moebius 不自行复制 slug 算法，而以
  `session_index.jsonl` 的 exact sessionId + workDir 行作为索引，校验 key 的 SHA-256
  后缀，再把 `workDirKey/sessionId` 重新锚定到当前受信任 source home 的 `sessions`
  根。
- 不直接信任 index 中的绝对 `sessionDir`：本机已观察到历史行保存旧 managed home 或
  临时 data root，但相同相对 key 在 source home 下仍有效。相对重锚定既兼容隔离
  symlink，也阻止旧路径或恶意路径逃逸。
- 投影 main Agent wire 的 metadata、system prompt、turn prompt、上下文、可读
  thinking / loop event、LLM request、工具、结果、权限、usage、错误和结束事实；
  provider-declared blobs 只能在同一 session / agent 的受信任目录内读取。

### D. 共享文件安全与 UI

- 从现有 Codex rollout 校验中抽取 provider-neutral 的 realpath / regular-file /
  trusted-root / device / inode / monotonic-size 保护和 JSONL 页读取；各 adapter 保留自己的
  根目录解析、候选唯一性和事件 schema。
- renderer DTO 使用共享 attempt envelope 加 engine-discriminated provider payload，
  不把三家原生事件压成一个假统一 schema；UI 复用 disclosure、虚拟列表和阅读位置，
  按 provider 显示原生分区与事件。
- 所有 resolver 错误只返回稳定 code 和 provider 名；裸路径、解析异常和原始错误不进入
  普通错误文案。原生内容本身仍按本地调试视图规则显示并只作文本渲染。

## 影响

### 业务域

- `local-console`：provider trace registry、Claude/Kimi locator/projector、可信 JSONL
  identity / paging、attempt 聚合与 HTTP DTO。
- `console-ui`：三 provider 完整输出入口、provider-native context / event 呈现、
  per-attempt unavailable 与异步加载隔离。
- `desktop-shell`：只调整 renderer 对 process DTO 的适配，不读取 provider 文件。

### 主要代码落点

- `src/local-console/process-history.ts`、`process-event-projector.ts`、
  `execution-context.ts`、`runtime.ts`、`server.ts`。
- 新增或拆分 provider trace locator/projector 与共享 trusted JSONL reader；
  `src/codex-rollout.ts` 保持 Codex 协议解析职责。
- `desktop/src/console-page/*`。
- `packages/console-ui/src/console/process-tab.tsx`、`process-event.tsx`、
  `operator-console.tsx` 及 i18n。

模块依赖方向不变：provider 文件 IO 与协议解析留在 local-console；desktop 只适配
loopback API；console-ui 只消费展示 DTO。因此本 change 不新增 architecture SVG。
实现若新增模块入口或组件模式，按完成后的真实职责更新 `docs/architecture/module-map.md`
与 `packages/console-ui/DESIGN.md`。

### 非目标

- 不改变 Claude/Kimi full、resume、取消、配置隔离或公共时间线投影。
- 不读取第三方日志，不调用 `kimi export` 作为运行时依赖。
- 不把 provider trace 复制到 Moebius session JSONL、SQLite 或 run diagnostics。
- 不统一三家 prompt / event 字段，不解密 opaque / encrypted payload。
- 不改变 GitHub issue runner 的 Codex-only provider 范围。
