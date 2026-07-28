# 提案：agent-team-model-effort-registry

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | `运行配置静态校验` | 将自由文本改为内置 CLI/model/effort 联动列表，定义默认值与旧值兼容 | 已写入 |
| `docs/product/pages/agent-teams.md` | `Agent 运行配置` | 记录 Codex/Kimi 矩阵范围、Kimi alias 与权限标注 | 已写入 |
| `docs/product/pages/agent-teams.md` | `指标与验收` | 增加默认组合、联动选择和历史未知值保留判据 | 已写入 |

## 背景

Agent 团队设置当前把 model 与 effort 渲染为自由输入框。用户无法从界面判断某个
model 支持哪些 effort，也容易保存执行端不会接受的组合。现有执行链已经会把保存值冻结
进新会话并精确传给 Codex 或 Kimi，本次不改变执行协议。

## 提案

- 在 console UI 内提供版本化发布的静态执行模型 registry。
- Codex 提供兼容范围内的正式模型及各自 effort，排除 `ultra` 和
  `gpt-5.3-codex-spark`。
- Kimi 提供全部已确认的 `kimi-code/` CLI alias，并标注受会员权限限制的选项。
- model 与 effort 改成联动下拉框；CLI/model 切换产生有效组合。
- 无持久配置时继续直接使用 `Codex / gpt-5.6-sol / high`。
- 历史未知值作为不支持的旧版自定义选项保留，直到用户主动选择当前组合。

## 影响

- 产品意图：`docs/product/pages/agent-teams.md`
- 行为规格：`desktop-shell`
- UI：`packages/console-ui/src/console/agent-team-detail.tsx` 及 i18n
- 桌面纯逻辑：默认执行配置常量及团队配置读取回退
- Kimi runtime：model 切换后消费 ACP 刷新的 model-specific effort 配置
- 测试：registry、团队详情联动、默认运行快照

不改变 IPC 数据结构、运行配置持久化格式、官方推荐/用户覆盖语义、会话冻结时机或
Codex/Kimi driver。
