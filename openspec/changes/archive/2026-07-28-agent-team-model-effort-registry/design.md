# 设计：agent-team-model-effort-registry

## 方案

在 `console-ui` 增加一个纯数据 registry 模块，按 CLI 返回有序 model 条目。每条 model
包含保存值、显示名、支持的 effort、默认 effort 和可选权限提示。模块同时提供：

- Codex 默认 profile：`gpt-5.6-sol/high`；
- Kimi 兼容默认 profile：`kimi-code/kimi-for-coding/on`；
- CLI/model 切换时的 profile 归一函数；
- 判断已保存 model/effort 是否属于当前 registry 的函数。

团队详情只消费这些纯函数。下拉框在当前保存值未知时临时追加一个 disabled=false 的
旧值 option，以便 React select 原样显示；旁边展示不支持提示。只要用户没有选择新值，
草稿仍与有效配置相等，不触发保存。切换 CLI 时使用目标 CLI 默认 profile；切换 model
时保留仍被新 model 支持的 effort，否则使用该 model 默认 effort。

桌面侧继续接受并透传历史未知值，确保旧数据、团队复制和官方更新不丢失。新的 UI 选择
面受 registry 限制，不把 registry 校验下沉到持久化边界。默认 profile 收敛为
`team-execution-profile.ts` 的不可变常量，IPC 读取与新会话快照共用，避免两处字面量漂移。

Kimi 的 effort 选项随 model 联动。ACP session 初始返回的是初始 model 的 effort 列表，
因此 driver 先设置 model，并把该请求响应或后续 `config_option_update` 返回的完整
`configOptions` 作为新快照，再从中查找、设置和精确确认目标 effort；没有拿到 model
切换后的完整配置时在 prompt 前 fail closed。transport 缓存最近一次完整配置更新，覆盖
update 先于 request response 到达的协议时序。

## 权衡

- 采用随应用发布的静态 registry，而不是在团队页调用 CLI 枚举；这样页面稳定、离线可用，
  且保持团队管理不启动 CLI 的既有边界。代价是新增模型需要随 Moebius 更新。
- 不在 IPC 拒绝未知值。严格拒绝会让旧 binding、旧官方推荐或复制流程无法读取；将限制放在
  新选择 UI 上，既约束新输入又保持向后兼容。
- Kimi 默认选择无额外会员标注的 `kimi-code/kimi-for-coding/on`；受限模型仍完整可选。
- 不新增执行协议或 capability 状态。权限与 CLI 版本仍由真正的新会话执行裁决。

## 风险

- 官方模型矩阵变化后 registry 会过时；通过独立纯数据测试固定当前矩阵，后续按官方资料更新。
- 旧值 option 与当前 option 混排可能被误认为推荐值；UI 使用明确的“旧版自定义配置”文案。
- 用户修改设置后误以为当前会话会切换；既有会话冻结语义不变，运行验证必须新建会话并查看
  过程元数据。
- Kimi model 更新可能先于设置响应到达；transport 先缓存完整更新，确认函数不得回退使用
  初始 model 的 effort 列表。
