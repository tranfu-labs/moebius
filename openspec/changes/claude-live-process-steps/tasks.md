# 任务：claude-live-process-steps

## 跟随器（local-console）

- [x] 新增 `src/claude-tui-transcript-follower.ts`：以本轮已捕获的记录边界为游标起点，增量读取新追加记录
- [x] 复用现有 transcript 解析路径与身份校验（`CLAUDE_CONFIG_DIR` / 用户根、精确 session UUID、immutable cwd 交叉校验）
- [x] 只处理完整成行的记录；文件截断、替换或游标倒退时停止跟随且不重放
- [x] 按已定的 Claude transcript 事件形状投影 thinking / tool_use / tool_result，不新增 Claude 专属步骤分支
- [x] 监听失败时回退到有界轮询，不做无限重试

## 接线（local-console）

- [x] `src/claude.ts`：任务写入后启动跟随器，Stop、idle、取消、异常退出与下一轮开始前停止并释放句柄
- [x] 接上 `onStructuredActivity`；接上 `onExecutionProgress` 并汇入既有工具执行闸与空转判定
- [x] 明确不接 `onVisibleAgentMarkdown`，运行中不产出流式正文

## 测试

- [x] 单元：假 transcript 在轮次进行中追加 thinking + 两次工具调用，断言按序投影为结构化事件，且事件不含最终正文与 usage
- [x] 单元：边界之前的旧记录不得被投影为本轮事件
- [x] 单元：跟随器抛错或从未产出事件时，本轮仍能正常完成并取得最终正文与 usage
- [x] 单元：Stop 之后跟随器不再投影新事件
- [x] 单元：身份或路径异常时停止跟随并降级，不换用其他文件
- [x] 扩展 `scripts/acceptance/claude-tui-electron.ts`：真实 Claude 跑一轮含思考与多次工具调用的任务，断言步骤行在 Stop 之前出现、与最终正文不重复，且四引擎步骤呈现同构
