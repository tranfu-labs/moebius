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
