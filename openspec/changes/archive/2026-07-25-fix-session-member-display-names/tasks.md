# 任务：fix-session-member-display-names

- [x] T1 在 `src/local-console/` 新增会话团队最小身份投影纯逻辑，复用 Agent frontmatter 解析并对损坏/缺失显示名有限降级。
- [x] T2 扩展主 state 与 session view DTO，返回 effective 会话的 `{slug, displayName}`，确认响应不含 `agentMarkdown`、persona 或协作规则。
- [x] T3 为子会话使用自身 effective 快照，补齐父会话改选团队及磁盘团队删除后的身份稳定性测试。
- [x] T4 在 console-ui 新增统一的纯成员名解析器，按“会话快照 → 内置存量兼容 → 明确未知值”解析。
- [x] T5 让主时间线历史消息、活动 run、终态事实、停止动作及过程标签统一使用解析结果，移除生产路径的分散角色白名单。
- [x] T6 让子会话卡片与子任务标签内的历史消息、活动 run、终态事实和动作统一使用子会话身份投影。
- [x] T7 补齐身份投影、纯解析器、主会话渲染、过程标签和子会话渲染单元测试；按 `design.md`“展示入口与测试证据矩阵”逐行设置直接断言，覆盖两个自定义 slug 及异常回退。
- [x] T8 执行旧会话与 AI DOM 验证：自动化 fixture 在 store 初始化后记录 JSONL hash / size、SQLite `data_version` 及相关表行快照，证明已知自定义成员无需改写持久化即可恢复且不出现泛称；用户给出的真实 JSONL 只做前后只读 hash 与字段聚合核对。
- [x] T9 运行 console-ui、desktop state-sync、local-console 定向测试、既有主 Agent 路由回归测试和 `pnpm typecheck`；失败先修复，不带红进入归档。
- [x] T10 对照 proposal、design 与验收清单反思代码符合度，确认未改变主 Agent、成员顺序、路由、交棒、恢复、并发、团队健康、持久化格式或页面版式。

完成回报 MUST 按 T1–T10 逐条列出：状态、验证命令、退出码、测试文件、直接断言位置（测试名与行号）。共用命令可以引用同一条命令记录，但不得只汇报“测试通过”；未执行项必须说明原因，不得标记完成。
