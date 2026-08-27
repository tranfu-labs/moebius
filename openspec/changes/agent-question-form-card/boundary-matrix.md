# 边界矩阵：agent-question-form-card

每个单元格都给出处理与验证位置；“复用”表示沿用既有宿主处理和测试，不新增第二套权限、失败或状态机。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| A. 表单纯模型与消息组装 | 空表单不可渲染；没有回答时 `canSubmitAgentForm` 为假并组装为空消息；复用 `packages/console-ui/src/console/agent-form-model.test.ts` 的空表单、空回答用例。 | 成员名为空、问题为空/超过 4 个、重复问题 id、选项为空或超过 2 个时返回不可渲染，不抛异常、不生成解释文案；复用 `agent-form-model.test.ts` 的尺寸与非法输入用例。 | 纯函数每次返回新的 draft，不共享可变答案；切换问题时钳制索引，跨表单 draft 直接丢弃；复用 `agent-form-model.test.ts` 的 stale draft、index clamp 与答案保留用例。 | 模型不读取权限或执行副作用；权限阻断由 `OperatorConsole` 宿主决定是否提供 controller，复用 `operator-console.tsx` 的既有提交阻断与 `operator-console.test.tsx` 宿主测试。 | 收到不同 form id 的旧 draft 时从首题新建，越界索引回到合法范围；复用 `agent-form-model.test.ts` 的 draft 恢复用例。 |
| B. `AgentFormCard` 呈现与交互 | 允许跳过未答题目；整张表单为空时发送按钮禁用且不补充解释文案；复用 `packages/console-ui/src/console/agent-form-card.test.tsx` 的 skip/empty 用例。 | 卡片只接收已通过模型判定的 spec；宿主对越界 spec 静默不渲染，复用 `packages/console-ui/src/console/operator-console.test.tsx` 的 out-of-bounds 用例。 | draft 由宿主控制，回退进度不丢后续答案；高度变化先取消上一段 WAAPI 动画再从实时高度过渡，复用 `agent-form-card.test.tsx` 的 progress、live-height 与 reduced-motion 用例。 | 卡片只回调 `onDraftChange`/`onSubmit`/`onSkip`，不直接执行权限检查、写会话或调用 Provider；复用宿主的权限/提交边界，卡片本身不复制一套权限状态。 | form id 变化清空旧答案；无动画能力或 reduced-motion 时直接落到新高度；复用 `agent-form-card.test.tsx` 的 stale-draft、animation 与 reduced-motion 用例。 |
| C. `OperatorConsole` 组合与顺序 | 未提供 `agentForm` 时保持既有 composer；提供表单时卡片位于附件、待发射草稿和 composer 之前；复用 `packages/console-ui/src/console/operator-console.test.tsx` 的默认路径与“above every draft”用例。 | `isRenderableAgentForm` 返回假时完全不渲染卡片，不泄露格式错误；复用 `operator-console.test.tsx` 的 quiet out-of-bounds 用例。 | controller 由宿主持有，普通 composer、附件和待发射消息仍保持独立；表单替换与进度回退复用 B 的受控 draft/重入处理及其测试。 | 组合层不新增授权语义；现有 `composerSubmissionBlockReason`、团队健康与 continuation guards 继续由宿主/`RoleComposer` 处理，复用 `operator-console.test.tsx` 的提交阻断和既有权限边界测试。 | 无效表单静默降级为原有 composer；宿主替换 form id 后由 B 清空旧 draft，复用 C 的 quiet fallback 与 B 的 stale-draft 测试。 |
| D. 桌面宿主表单生命周期 | 空表单由卡片禁用发送；空的独立 composer 发送沿用 `conversationActions` 的 skip，不触发表单销毁；复用 `agent-form-card.test.tsx`、`console-state-sync.test.ts`。 | 非法或超限表单在 presentation 层不生成 controller，作为普通正文保留；复用 `agent-form-presentation.test.ts`、`operator-console.test.tsx`。 | `use-agent-form-controller` 用 in-flight ref 阻止表单重复提交；`use-conversation-transition` 与 `ConsoleStateCoordinator` 阻止 transition/send 重入；复用 `use-agent-form-controller.test.tsx` 的重入用例及 `use-conversation-transition.test.tsx`。 | 宿主不新增权限判断；发送接口的错误由既有 `conversationActions` 捕获并报告，返回失败结果后保留表单；复用 `console-state-sync.test.ts` 的发送失败路径。 | 表单发送或独立消息发送返回失败时恢复可提交状态并保留 draft；成功时清 draft、写 submitted marker，旧表单不再恢复；由 `agent-form-draft.test.ts` 与 `use-agent-form-controller.test.tsx` 的成功/失败用例验证。 |

## 本次验证记录

- `pnpm check:boundaries`：退出码 0；`[import-boundaries] ok: 864 source files, 704 production files, 3 roots`。
- `pnpm typecheck`：退出码 0；根包、`@moebius/desktop`、`@moebius/console-ui` 均完成 `tsc --noEmit`。
- `pnpm --filter @moebius/desktop build`：退出码 0；Vite 输出 `✓ built in 11.65s`，原生权限桥两个 dev/prod bundle 均完成构建。
- `pnpm test`：退出码 0；根非慢套件 143 个测试文件通过、1 个跳过，1020 个测试通过、5 个跳过；根慢套件 1/67；desktop 180/951；console-ui 73/732。

步骤 1 基线记录位于系统临时目录 `/tmp/moebius-step1-baseline-{typecheck,build,test}.log`，同样执行了 `pnpm typecheck`、`pnpm --filter @moebius/desktop build`、`pnpm test`。对比如下：

| 套件 | 基线 | 本次 | 变化 | 失败变化 |
| --- | --- | --- | --- | --- |
| 根非慢 | 996 通过 / 4 跳过，136 文件 | 1020 通过 / 5 跳过，144 文件 | +24 通过、+1 跳过、+8 文件 | 0 → 0 |
| 根慢 | 67 通过，1 文件 | 67 通过，1 文件 | 0 | 0 → 0 |
| desktop | 930 通过，176 文件 | 951 通过，180 文件 | +21 通过、+4 文件 | 0 → 0 |
| console-ui | 694 通过，69 文件 | 732 通过，73 文件 | +38 通过、+4 文件 | 0 → 0 |
| 合计 | 2687 通过 / 4 跳过，382 文件 | 2770 通过 / 5 跳过，398 文件 | +83 通过、+1 跳过、+16 文件 | 0 → 0 |

本次第一次执行完整 `pnpm test` 时，根非慢套件出现一次 SQLite `database is locked`，退出码 1；随后定向重跑 `pnpm exec vitest run tests/local-console-create-session.test.ts --maxWorkers=1 --no-file-parallelism` 为 3/3 通过，再完整重跑同一 `pnpm test`，退出码 0，最终没有基线通过而本次失败的项目。
