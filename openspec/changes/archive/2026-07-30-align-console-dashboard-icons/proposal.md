# 提案：align-console-dashboard-icons

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-left-sidebar.md` | 页面结构、对话行、响应式与窗口行为 | 移除 `»/>>` 选中前缀，选中态改为不占标题布局的背景与文字信号；补充非 Logo 图标对齐原则 | 已写入 |
| `docs/product/pages/main-conversation.md` | 页面结构 | 补充主会话非 Logo 图标按宿主盒统一对齐且不影响右侧栏密度的原则 | 已写入 |

用户在已归档 `align-console-dashboard-shell` 的真实页面上指出图标仍未对齐，并明确要求同步修改
`dashboard.html` 与生产代码；同时明确取消当前会话选中态的 `»/>>` 标记。该决策改变了 PRD 和现行
console-ui spec 已记录的选中态事实，因此作为独立 follow-up change 处理，不改写上一 change。

## 背景

参考 HTML 与生产 Electron 均把多数图标的几何中心放在宿主盒中心，但以下直接对应或同密度
相邻角色存在可见尺寸差：

- 参考顶栏图标为 `18px / 28px`、生产为 `16px / 28px`；
- 参考项目展开图标为 `14px`、生产为 `16px`；
- 参考项目操作为 `13px / 22px`、生产为 `16px / 28px`；
- 参考 Composer 添加/发送为 `15px / 32px`、生产为 `16px / 32px`，生产停止图标又为 `14px`；
- 参考通用描边为 `1.6px`、生产 Lucide 主基线为 `1.5px`。

其中只有项目展开、项目新建/更多、会话更多和 Composer 停止具备需要修改生产几何的直接参考
或真实相邻视觉重量证据；其余组保持生产尺寸与宿主布局，只补对齐断言。参考页与生产页的
描边差按已有 `DESIGN.md` 默认 `16px / strokeWidth 1.5` 事实处理，但不借机全局重写生产描边。

当前选中会话在参考 HTML 与生产组件中都渲染绝对定位的 `»`。生产真实页面中选中与未选中标题
当前同为 `x=38px`，说明移除标记后可保留既有 28px 标题缩进而不改变文本位置；实现不需要用
减少 padding 来“回收”标记空间。

## 提案

1. 在 `packages/console-ui/DESIGN.md` 补充图标应在既有宿主内自然居中、不得用单枚位移补偿的
   规则；沿用已有默认 16px、密集 14px、状态 12px 设计事实，不建立新的全局尺寸重写。
2. 同步修改 `packages/console-ui/design-refs/dashboard.html` 与 `app.css` 的现有 DOM：按直接
   对应角色校正尺寸、描边和居中，不增加状态、假数据或交互脚本。
3. 生产几何改动白名单仅含项目展开、项目新建/更多、会话更多和 main Composer 停止；所有既有
   按钮宿主尺寸保持不变，embedded Composer 保持原几何。其余侧栏与主会话图标只增加防回归证据。
4. 从参考页和生产会话行删除 `»/>>`，保留中性选中背景、前景文字、`aria-current` 与固定
   标题缩进，选中、未选中、hover、focus 之间不发生横向跳动。
5. 扩展现有 Dashboard UI 验收，让同一命令同时输出参考 HTML 几何和真实 Electron 几何，
   并覆盖选中切换与现有交互。

## 影响

- 参考：`packages/console-ui/design-refs/dashboard.html`、`app.css`。
- 设计事实：`packages/console-ui/DESIGN.md`。
- 生产 UI：`conversation-sidebar.tsx` 的项目/会话行和 `role-composer.tsx` 的 main 停止图标；
  shell、主区顶栏、时间线、活动、子会话、结果、异常、上下文、附件、添加、发送及 embedded
  停止只进入测试范围。
- 验证：相关 Console UI 单元测试、Page/Block Story、`scripts/acceptance/console-dashboard-ui.ts`。
- 规格：实现并验证后合并 console-ui spec delta。
- 不影响：品牌 Logo、右侧栏内部视觉、desktop IPC、local-console API、SQLite、Codex 事件协议。
