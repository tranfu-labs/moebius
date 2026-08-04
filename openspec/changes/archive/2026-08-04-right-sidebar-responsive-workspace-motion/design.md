# 设计：right-sidebar-responsive-workspace-motion

## 方案

### 布局与偏好

`OperatorConsole` 观察 `operator-content-shell`，得到已经扣除可见左导航的可用内容宽度。
纯布局模型按以下规则投影：

- `availableWidth < 960`：overlay，右栏占满内容面。
- `availableWidth >= 960`：split；最小 480px，最大
  `min(round(availableWidth * 0.75), availableWidth - 480)`。
- 无偏好时取 `round(availableWidth * 0.5)`；有偏好时只把呈现值夹在当前边界内。

桌面偏好读取返回 `number | null`。`null` 表示从未主动调整；旧版本已写入的数字仍作为原始
偏好保留。指针或键盘调整才写入偏好，ResizeObserver 引起的临时夹取不写入。

### 分隔线

`RightSidebar` 在 split 模式渲染可聚焦 separator。指针拖拽使用 pointer capture，向左增加
宽度、向右减少；键盘 `ArrowLeft/ArrowRight` 分别增加/减少 16px，Shift 为 64px，
Home/End 到动态边界。组件公开 `aria-valuemin/max/now`，hover、active、focus-visible 与边界
状态沿用 accent 和既有令牌，不增加 toast、位移或临时色值。

### 开合状态

纯 motion 模型维护 `progress (0..1)`、目标和当前段起点。完整路程为 150ms，中途反向从当前
进度开始，段时长按剩余距离折算；不存在排队状态。split 外壳宽度按进度变化，固定宽度内容
从右侧被裁切；overlay 保持内容面宽度并从右缘 translate，内容不缩放。

`RightSidebar` 在 closing 阶段继续挂载。关闭开始即设置原生 `inert` 和 pointer-events none，
若焦点位于右栏则由宿主聚焦主内容开关。退场完成后才触发 `onExitComplete`，由宿主恢复会话
滚动位置并执行既有关闭回调。打开不主动转移焦点。

关闭最后标签时先保存空标签状态，同时把当前活动标签及其已挂载内容作为内部 closing
snapshot 保留；退场完成后清除。若用户在退场中重新打开，以最后意图反向并显示零标签的内容
选择面，不恢复已关闭标签。

`prefers-reduced-motion: reduce` 在初始和运行中都立即收敛到目标。仅布局跨越 960px 时保持
稳定 open 进度，不触发开关 motion，也不重挂载内容。

### 设计系统

继续使用 `--dur`、`--ease`、`border-line`、`bg-canvas` 与 `accent`。在 DESIGN.md 登记唯一
例外：右侧辅助工作区可以做边界宽度/右缘位移的 150ms 空间动效；禁止 bounce、elastic、
缩放、阴影和渐变，reduced-motion 下立即切换。

## 权衡

- 不再使用 `window.innerWidth` 固定断点，因为它没有扣除左导航且会把不同内容面误判为同一
  布局；观察稳定的内容 shell 可直接满足 PRD 定义。
- 不把被窗口夹取后的值回写 localStorage，否则临时缩窗会永久破坏用户偏好。
- 不只依赖 CSS 固定 transition，因为中途反向需要从实际进度继续并按剩余距离收口；纯模型
  让计时和最终状态可确定测试。
- 不复制原型模型。原型只作为已确认投影参考，生产算法依据 PRD 在正式模块内独立实现。

## 风险

- 动画和主时间线虚拟滚动都依赖布局测量；关闭完成回调必须晚于视觉退场，且现有锚点恢复测试
  需要防止重复恢复。
- React 受控 props 在动画中可能更新回调身份；motion 使用最新 ref，不能因此重启动画。
- 最后标签关闭会同时改变外部 state 和内部 snapshot；必须用稳定 tab key 保持原内容 DOM，
  避免闪成空白选择面。
- 旧宽度偏好可能小于新下限；只在呈现时夹到 480px，不能静默覆盖存储值。
