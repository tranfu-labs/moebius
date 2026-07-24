# 提案：expand-onboarding-relay-stage

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | `第 3 步 · 团队协作示例` | 第 3 步改为约 780px 的响应式宽版舞台，完整表达团队与标准六棒 | 已写入 |
| `docs/product/pages/onboarding.md` | `主体区（每屏）` | 第 3 步从普通 512px 主体中独立，短窗口只滚动时间线 | 已写入 |
| `docs/product/pages/onboarding.md` | `指标与验收` #11、#25 | 增加宽版、角色标签和高度降级验收 | 已写入 |

## 背景

正式实现把接力 graph 压在 `minmax(96px, 0.42fr)` 内，再把该宽度平均分给全部成员。四人长名称团队的成员列只有约三十多像素，团队名、角色名、重播按钮和消息区同时争抢普通 `max-w-lg` 主体，导致名称大量省略、标准六棒需要在局促卡片里滚动。

正式 SVG 目前用一段跨行曲线直接连接上一节点和当前节点，虽然仍只连接相邻拍次，但丢失了高保真原型中“稳定成员轨道 → 已完成节点向下延伸短 tail → 下一拍贝塞尔转向”的连续 Git graph 视觉；原型中的接棒下划线和发言前输入气泡也没有完整投影到正式组件。

## 提案

1. 第 3 步主体从约 512px 独立放宽到约 780px，并压缩该步无效垂直留白；不改变 Electron 主窗口默认尺寸。
2. 接力 graph 使用稳定等宽成员轨道。宽窗口完整显示 2–6 名成员角色标签，窄窗口才降级为短标签。
3. 节点横坐标遵循 `nodeX = (memberIndex + 0.5) × laneWidth`，graph 总宽遵循 `graphWidth = memberCount × laneWidth`。
4. 每个已完成节点向本拍边界延伸一段短 tail；下一拍再用一条三次贝塞尔曲线从上一轨道转到当前轨道。tail 和曲线都不得跨越多拍。
5. 恢复原型中的接棒下划线移动与下一位成员输入气泡；减少动态效果时改为无位移的静态切换。
6. 默认 `1180 × 760` 桌面窗口中的标准六棒完成态无需手动滚动即可全部可见；窗口高度不足或脚本更长时，仅时间线内部滚动。

## 影响

- 修改 `packages/console-ui/src/onboarding/onboarding-shell.tsx` 的第 3 步响应式主体。
- 修改 `packages/console-ui/src/onboarding/relay-demo/` 的播放状态、轨道几何、SVG、角色表头和消息布局。
- 扩充 relay demo 与 onboarding shell 的 Vitest / Storybook 场景。
- 更新 onboarding 页面 PRD 与 `console-ui` 行为规格。
- 不修改团队目录、`onboarding-orchestration.json`、AI 建队 schema、真实会话调度或 Electron BrowserWindow 尺寸。
