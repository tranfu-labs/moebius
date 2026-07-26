# 设计：enhance-conversation-relay-rail-motion

## 方案

### 左侧锚点

收起短横线和展开面板共享 `left: 0` 的舞台原点。面板只过渡 `width`，短横线使用 `transform-origin: left`，因此所有视觉变化都从左边缘向右发生，不出现居中放大或左右同时生长。

### 轨迹展开

- 面板宽度、边框与底色用现有 motion token 做有界过渡。
- 收起横线在原位向左端收束并淡出。
- 展开节点从收起列的共同起点横向进入 actor lane，同时淡入；不尝试把矩形强行 morph 成圆点或菱形。
- SVG path 使用归一化 `pathLength` 与 `stroke-dashoffset` 从上到下短暂错峰绘入；只有相邻真实事件连接，仍不跨省略行。
- 当前检查节点和与它相邻的路径只改变缩放、透明度或描边强度，不改变 lane 几何。

### 预览跟随

Popover 仍锚定整个展开面板宽度，保持固定 12px side offset。锚点的纵向位置在不同事件行之间连续过渡；卡片内容以事件 id 为 key 做短促 opacity/translate 切换，不使用 blur 或阴影。

### reduced motion

CSS `prefers-reduced-motion` 分支将面板、横线、节点、路径、锚点和预览内容的 transition/animation 归零。展开结果、当前事件、预览内容与定位能力不变。

## 权衡

- 使用现有 CSS motion tokens，不新增 `motion` 运行时依赖：该交互只有单轴位移、尺寸、透明度和 SVG 描边，CSS 足以表达，且更容易让 reduced-motion 完整覆盖。
- 不复刻 beUI 的邻近金字塔：Moebius 的每一行代表时间线事件，动效重点是“单列目录展开为真实接力轨迹”，不是放大指针附近的目录刻度。
- 不做矩形到节点的复杂形变：双层交叉与横向进入更稳定，也不会因用户菱形和 Agent 圆点而产生不可预测的路径插值。

## 风险

- 快速跨行移动可能频繁更新预览锚点；组件保留单一锚点并只改变 top，避免创建多张卡。
- 路径错峰可能让长窗口拖慢完成时间；延迟设有上限，所有可见路径在短时间内完成。
- Radix 碰撞翻转仍可能改变整卡方向；这是窗口边界降级，不改变卡片相对面板的固定间距语义。
