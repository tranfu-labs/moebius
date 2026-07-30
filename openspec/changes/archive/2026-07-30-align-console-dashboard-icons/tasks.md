# 任务：align-console-dashboard-icons

- [x] 读取仓库、console-ui 与 OpenSpec 契约，确认 `implementation_authority=granted`，但本轮停在方案核验闸门。
- [x] 读取左侧栏 / 主会话 PRD、console-ui spec、`DESIGN.md`、模块地图、参考 HTML/CSS 与邻近生产组件。
- [x] 用参考 Chromium 与生产 Electron DOM / 计算几何逐项取证非 Logo 图标、宿主盒、描边、中心差和会话选中标题坐标。
- [x] 把用户已明确的选中态与图标对齐决策写入 `docs/product/`，不修改运行时代码或参考 HTML。
- [x] 落盘 proposal、design、spec delta 与任务清单，并完成 Logo / 右侧栏 / 协议 / onboarding 排除范围自审。
- [x] 按主理人复核收紧为 4 组生产几何白名单，取消全局描边、宿主缩小和参考 DOM 扩展，并补人工视觉信号。
- [x] 主理人按原始目标双向核对生产改动白名单、参考同步范围和真实运行验收清单并放行实现。
- [x] 更新 `packages/console-ui/DESIGN.md`：沿用既有 16/14/12px 与 1.5/2px 事实，只补宿主自然居中和禁止单枚位移补偿规则。
- [x] 同步修改 `dashboard.html` / `app.css` 的现有元素：校正直接对应角色并移除全部 `.sel-mark`；不新增 DOM、假数据或脚本，保持 28px 会话标题缩进。
- [x] 仅修改侧栏生产白名单：项目 disclosure 16→14、项目新建/更多 16→14（宿主仍 28）、会话更多 16→14（宿主仍 24），并移除 `»/>>`；项目修复、shell、导航和底部图标几何不变。
- [x] 仅修改主会话生产白名单：`RoleComposer variant="main"` 的主理人停止图标 14→16（宿主仍 32），embedded 停止保持 14；顶栏、消息/活动、子会话、异常/结果、上下文、附件、添加与发送几何不变。
- [x] 补充单元测试与 Page/Block Story：对白名单改动断言尺寸，对其余清单项只断言既有几何/交互不回归；覆盖选中切换无横跳、hover/focus、折叠、附件、发送和停止。
- [x] 扩展 Dashboard UI 验收，同时采集参考 HTML 与真实 Electron 图标几何、选中切换和现有交互 evidence。
- [x] 运行 Console UI 全量测试 / typecheck、Storybook、Desktop build、真实 Electron 默认与 `--hold`、`git diff --check`。
- [x] 对照 proposal、spec delta、用户原始目标与排除范围做符合度反思；只把已验证行为合并进当前事实源。
