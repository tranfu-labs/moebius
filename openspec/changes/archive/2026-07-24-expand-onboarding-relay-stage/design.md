# 设计：expand-onboarding-relay-stage

## 方案

### 1. 第 3 步宽高策略

`OnboardingShell` 继续保持四步同一标题栏和底部操作条，但内容列按步骤选择宽度：

- 第 1、2、4 步普通状态：`max-w-lg`。
- 第 2 步 AI 团队设计器：既有 `max-w-[780px]` 例外。
- 第 3 步接力舞台：新增 `max-w-[780px]` 例外，并减少该步 section 的纵向 padding。

接力卡在常规 `1180 × 760` 主窗口中目标总高度约 `520–550px`，其中标准六棒时间线约占 `420–440px`；共享行通过更宽消息列和更紧凑但可读的最小高度容纳六棒，完成态无需手动滚动。内容超过可用高度时，保留卡片 topline、角色表头、caption 和全局 footer，只让时间线滚动。不得通过增大 BrowserWindow 或隐藏引导操作换空间。

### 2. 稳定成员轨道

宽窗口采用固定 CSS 轨道宽度，初始实现以 `64px` 为基线；2–6 名成员的 graph 宽度由成员数线性决定，不再把任意成员数压入同一个比例列。

```text
laneWidth = 64
graphWidth(memberCount) = memberCount × laneWidth
nodeX(memberIndex) = (memberIndex + 0.5) × laneWidth
```

窄窗口切换到约 `28px` 轨道和短标签；这只改变 `laneWidth` 与标签形态，不改变成员索引、节点顺序和连接公式。

几何计算从 React 渲染中提取为纯函数，供 SVG、角色表头和单元测试共享，避免 CSS 百分比与 SVG viewBox 各自推导后漂移。

### 3. 相邻拍次的 tail + 贝塞尔连接

每个 beat 仍与消息共享同一 CSS grid row。当前拍节点位于本行 graph cell 的固定节点高度。连接分成两段：

1. 上一拍完成后，从上一节点中心向本拍边界延伸一段竖向 tail；
2. 当前拍必须在自己的 graph cell 顶部绘制三次贝塞尔曲线，从上一成员轨道转入当前成员轨道。

```text
previousX = nodeX(previousMemberIndex)
currentX  = nodeX(currentMemberIndex)

path =
  M previousX 0
  C previousX curveDown
    currentX  curveTurn
    currentX  connectorHeight
```

曲线只属于 `beat[i - 1] → beat[i]`；DOM 继续记录 `data-y1=i-1`、`data-y2=i`。tail 只覆盖单拍剩余高度，禁止从某一成员轨道贯穿多行，因而不会重新引入组织架构式长竖线。

### 4. 接棒和输入阶段

`relay-motion.ts` 在既有 reveal offsets 外增加有界 typing offsets：

- 下一拍 reveal 前先显示对应成员的输入气泡；
- reveal 时输入气泡退出，节点、连接和消息进入；
- active speaker 或 typing speaker 变化时，角色表头下划线移动到新轨道；
- 重播重置 visible、typing 与 complete；
- reduced-motion 不使用 transform、translate、路径绘制或持续脉冲，输入阶段与接棒状态用 opacity / 静态位置表达。

不引入 Motion 依赖；正式组件继续使用 React 状态、WAAPI 与设计令牌重新实现原型意图，保持原型和生产代码双向隔离。

### 5. 内容可读性

- 宽窗口团队名不得因 graph 比例列过窄而被截断。
- 角色表头允许稳定宽度和最多两行标签，不以单行省略号作为宽屏默认。
- 消息正文继续完整渲染，不裁切；标准六棒通过更宽消息列和紧凑共享行高降低纵向占用。
- 超过标准长度的编排保持内滚动，当前拍仍自动滚入最近可见位置。

## 权衡

- 选择固定成员轨道而不是比例轨道：牺牲 graph 自动占满全部空白，换来 2–6 人时一致、可预测的节点与标签几何。
- 不逐像素复制原型的 `48px`：正式版以约 `64px` 给真实长角色名更多空间，但保留同一绘制公式、tail 和转向语法。
- 不强制增大 Electron 窗口：避免 onboarding 改动影响用户已保存的窗口习惯；通过第 3 步专属布局使用现有 `1180 × 760` 空间。
- 标准六棒优先一次可见，但不承诺任意长脚本无滚动；否则会挤压文字或让短窗口失去操作入口。

## 风险

- 六名成员与长消息同时出现时，graph 和消息区仍可能竞争宽度；通过 780px 上限、64px 轨道和窄屏断点验证。
- typing 阶段会改变现有定时测试；播放总时长必须继续保持 8–12 秒，且重播/卸载清理所有 timer。
- tail 若跨过多行会违背已有 #18；用 DOM 索引、几何纯函数和相邻连接测试约束。
- 第 3 步高度规则可能在 560px 最小窗口触发滚动；验收重点是全局标题、重播、caption 与 footer 不被时间线挤走。

回滚时可分别撤回第 3 步宽度例外、typing 阶段和新 graph 几何；团队数据与持久化没有迁移成本。
