# 提案：session-analysis-visible-fragments

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/flows/session-analysis.md` | `2. 收集来源引用` | 文本片段改为“所见即所传”，链接仅用于导航，不再后台展开来源 | 已写入 |
| `docs/product/flows/session-analysis.md` | `4. 首次发送并创建对话` | 首次发送顺序改为序列化可见片段后直接提交并启动 run | 已写入 |
| `docs/product/flows/session-analysis.md` | `来源引用不可用` | 链接目标不可用只影响点击导航，不阻塞消息与 run | 已写入 |
| `docs/product/pages/main-conversation.md` | `文本片段与来源导航、输入框、Agent 执行与恢复` | 页面级创建、排队、重试与恢复统一只使用可见文本 | 已写入 |
| `docs/product/pages/agent-conversation.md` | `步骤、尝试与 run、重试与恢复` | 移除新 run 的来源刷新与来源读取失败状态 | 已写入 |
| `docs/product/pages/main-left-sidebar.md` | `在右侧栏分析这段对话` | 对话级入口只生成可见文本片段，不交付完整时间线 | 已写入 |

## 背景

当前界面中的文本片段只公开几十字的 Markdown 链接，但 local-console 会把该链接当作索引，在 run 前后台展开整条消息或整段对话以及关联 stdout/stderr。大体量来源因此能生成数 MB 的隐藏 prompt，既违背用户对“文本片段”的理解，也会在 provider 进程启动时触发参数过长错误。

## 提案

把发送前胶囊可读取的完整文本定义为唯一来源载荷：提交时按顺序逐字序列化一次，run 只接收持久化用户消息中的这份可见文本。`moebius-ref:` 保留应用内导航能力，但不再触发来源校验、来源读取、运行输出拼接或跨上下文授权。重试与恢复同样不得使用历史 execution context 中的隐藏来源正文。

## 影响

- local-console 的分析会话创建、普通消息提交、pending 发射、重试与恢复 prompt 组装。
- `moebius-ref:` 的运行时语义从“导航兼来源索引”收窄为“仅导航”。
- 分析会话产品 PRD、local-console 行为规格与模块地图说明。
- 回归测试从“可读取最新完整来源”改为“可见文本精确一次、无隐藏追加、目标不可用不阻塞”。
