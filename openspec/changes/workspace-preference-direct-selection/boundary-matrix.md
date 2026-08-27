# 边界矩阵：workspace-preference-direct-selection

本矩阵覆盖三个可独立验证的功能单元。每个格子都给出处理方式及对应测试；“复用”表示该异常由已存在的公共边界处理，未新增本功能专属分支。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| 新对话工作空间菜单（console-ui） | 菜单没有自由文本输入；未选项目或不可用项目时沿用既有禁用/不可发送状态，复用 `NewConversationPage` 的项目上下文处理。测试：`new-conversation-page.test.tsx` 的无项目与不可用项目用例。 | 工作空间值只允许 `direct` / `worktree`；非 Git 项目的 worktree 菜单项禁用并展示原因。测试：同文件“直接选择独立工作空间”和“非 git 项目禁用”用例。 | 菜单事件只派发草稿选择，不持有额外弹窗状态；连续写入的顺序由 desktop project mutation 单元统一处理。复用：`project-mutation-browser-port.test.ts` 的同项目串行用例。 | 菜单本身不做权限判断；不可用项目沿用既有 disabled 边界。测试：`new-conversation-page.test.tsx` 的不可用项目用例；请求级失败复用桌面错误控制器。 | 草稿选择先落本地状态，偏好写入失败不回滚用户选择。测试：`use-new-conversation-launcher.test.ts` 的“reports a preference write failure”用例。 |
| Desktop 草稿与项目偏好 mutation | 无项目上下文时只切换草稿，不发项目偏好请求。测试：`use-new-conversation-launcher.test.ts` 的“does not write a project preference when no project is selected”用例。 | 类型边界只接受 `direct` / `worktree`，适配层统一转换为既有 boolean `worktreeMode`；超出类型的请求由类型检查阻断。测试：`project-mutation-browser-port.test.ts` 的 PATCH payload 用例；`pnpm typecheck`。 | 同一 API 与项目键的 mutation 串行，失败的前一请求不阻塞后一请求；项目间的偏好隔离由 local-console store/API 处理。测试：`project-mutation-browser-port.test.ts` 的串行与失败后继续用例，以及 `local-console-project-workspace-preference.test.ts` 的项目隔离用例。 | 不引入新的桌面权限模型；transport/application 失败统一进入既有 `ConsoleErrorController`，不清理草稿或右侧栏状态。测试：`use-new-conversation-launcher.test.ts` 的失败用例、`use-project-mutations.test.tsx` 的 mutation 失败恢复用例。 | PATCH 失败由既有错误控制器报告，用户可再次选择重试；请求队列清理后允许下一次写入。测试：launcher 失败用例、browser port“failed first request then second succeeds”用例。 |
| local-console 项目偏好与会话默认值 | 创建会话省略 `workspaceMode` 时读取目标项目当前偏好；无项目偏好时沿用 direct 默认。测试：`local-console-project-workspace-preference.test.ts` 的 store/API 创建会话用例。 | API 只接受 boolean `worktreeMode`；非法 payload 返回 400 且旧偏好不变。测试：同文件“rejects an invalid preference payload...”用例。 | SQLite 操作按既有 store 队列提交；项目偏好只影响后续会话，项目间互不污染。测试：同文件“isolates project defaults...”用例及 HTTP 重启用例。 | local-console 是 loopback 应用接口，本功能没有独立用户权限判定；无权限场景复用既有 HTTP 错误响应和桌面错误控制器，不新增伪权限状态。测试：browser port 非 2xx 失败用例、launcher 失败用例。 | 更新偏好失败不写入错误值；重启从 SQLite 恢复成功值，已有 session 的 `workspaceMode` 保持不变。测试：同文件 store 重启、HTTP server 重启及已有会话断言。 |

## 对账结果

- 15 个矩阵格子均已填写处理方式与测试，或明确复用的既有处理边界。
- 本步新增的两个边界测试已纳入对应测试文件：偏好写入失败保留草稿选择；非法项目偏好 payload 不改变默认值。
- 未发现需要新增生产实现的边界缺口。
