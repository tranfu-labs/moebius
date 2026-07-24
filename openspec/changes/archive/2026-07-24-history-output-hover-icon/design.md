# 设计：history-output-hover-icon

## 方案

在 `TimelineEntry` 的 Agent 历史消息分支保留正文下方现有插槽，直接把 `Button variant="ghost"` 文字控件替换成原生图标按钮：

- 尺寸与现有活动运行操作一致，使用 `h-6 w-6`、14px `FileText` 图标和既有语义令牌。
- 默认 `opacity-0`，由时间线条目的 `group-hover` / `group-focus-within` 和按钮 `focus-visible` 恢复可见。
- 图标绝对定位在正文后的既有消息间隙中，左边界取正文的 `pl-7`；隐藏时不保留空白操作行，显示时也不推动下一条消息。
- 使用只涉及颜色与透明度的短过渡，不移动、不缩放入口。
- 点击继续发出完全相同的 `run-output` intent。

## 权衡

- 不把入口移动到 who 行右侧：用户明确要求保持现有左对齐位置，且正文下方入口与它所解释的消息内容关系更直接。
- 不继续使用完整 `Button` 的 `ghost` 文字形态：它带来 30px 控件高度、横向 padding 与常驻文案，视觉重量超过低频消息操作。
- 不隐藏活动运行和异常事实入口：两者分别承担实时监督与恢复，发现成本高于成功历史记录。
- 不抽取新的共享组件：本次只改主时间线一个呈现点，过早抽象会把子任务与异常卡拖入无关范围。

## 风险

- 默认透明的按钮必须保持键盘可达，否则 hover-only 会损害可访问性；通过 `focus-visible` / `group-focus-within` 与可访问名称回归测试约束。
- hover 区域错误绑定到按钮本身会让入口难发现；可见性必须绑定整条已有 `group` 消息。
- 绝对定位若脱离消息间隙可能覆盖正文或下一条 who 行；共置类断言与浏览器渲染检查同时约束纵向位置。
- 回滚只需恢复原有 `Button` 渲染，不涉及数据或接口迁移。

## 验证证据

- `operator-console.test.tsx`：75/75 通过。
- `@moebius/console-ui` 全量测试：34 个文件、283/283 通过。
- `@moebius/console-ui` typecheck 与生产 build 通过。
- Storybook + Playwright：默认透明度 `0`，hover 与 focus 透明度均为 `1`；图标与正文横坐标均为 `362px`，确认保持左对齐且没有占位操作行。
