# 任务：expand-onboarding-relay-stage

## 1. 宽版第 3 步

- [x] 让 onboarding 第 3 步主体响应式放宽到约 780px
- [x] 使用更多可用高度，短窗口只滚动接力时间线
- [x] 保持第 1、2、4 步与 Electron BrowserWindow 尺寸不变

## 2. 接力轨道与 SVG

- [x] 提取成员轨道宽度、graph 总宽、节点横坐标和贝塞尔 path 的纯函数
- [x] 用稳定等宽轨道重做角色表头、节点、单拍 tail 和相邻拍次曲线
- [x] 宽窗口完整显示团队名和角色标签，窄窗口降级短标签

## 3. 接棒动效

- [x] 在 reveal 前增加下一位成员输入气泡
- [x] 增加角色表头接棒下划线移动
- [x] 保持重播、播放中继续、卸载清理与 8–12 秒总时长
- [x] reduced-motion 提供无位移、无脉冲的信息等价分支

## 4. 测试

- [x] 单测 2、4、6 名成员的 graphWidth 与 nodeX 公式
- [x] 单测每条 connector 和 tail 只属于相邻拍次
- [x] 单测六棒节点/消息共享 grid row、宽屏标签不走省略降级
- [x] 单测 typing/reveal/replay 定时与 reduced-motion
- [x] 更新 Storybook 长团队名和 4 人/6 人场景

## 5. 验证

- [x] 运行 console-ui 定向 Vitest、package build 与根 typecheck
- [x] 在 1180 × 760 验证标准六棒与 “AI 热点社媒编辑部” 长名称团队
- [x] 在 900 × 560 验证时间线滚动且标题、重播、caption、footer 可见
- [x] 验证亮暗主题、重播、播放中继续和 reduced-motion
