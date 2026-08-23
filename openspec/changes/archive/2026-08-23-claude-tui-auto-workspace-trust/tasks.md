# 任务：claude-tui-auto-workspace-trust

- [x] 将 Claude PTY 预任务信任检测改为一次性自动 Enter，并覆盖重复 redraw、任务顺序与失败边界。
- [x] 删除人工 workspace trust 的 local-console projection、controller、HTTP route 和相关纯 plan／测试。
- [x] 删除 Desktop／console-ui 信任 dialog、callback、API、翻译、stories 和已失效测试。
- [x] 补充真实 Claude CLI 与真实 Electron 验收，验证首轮自动确认、同 PTY 后续输入、idle 精确 resume 与 cache usage。
- [x] 更新模块地图、console-ui 设计模式，完成边界矩阵和回归对比。
