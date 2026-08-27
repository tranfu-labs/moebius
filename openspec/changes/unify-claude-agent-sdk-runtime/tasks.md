# 任务：unify-claude-agent-sdk-runtime

## 依赖与共享 adapter

- [x] 在根 workspace 添加并锁定 `@anthropic-ai/claude-agent-sdk@0.3.243`，确认 macOS arm64 可随桌面构建获得对应 Claude Code runtime。
- [x] 实现共享 SDK query adapter：显式 executable、版本门禁、full/resume、session ID 绑定、AbortSignal、result/error 归一化。
- [x] 实现普通 Claude / AI Team Builder 两套 profile option builder，集中维护 permission、tools、setting sources、strict MCP 和 JSON Schema 边界。
- [x] 把现有 `ManagedProcessMcpInvocation` 映射为 SDK stdio `mcpServers`，保留 preflight、completion、capability revoke 和 close 语义。

## 普通 local-console

- [x] 用共享 adapter 替换 `ClaudeTuiRuntime` 生产 wiring，保留 canonical session、execution link、run 终局和失败归类。
- [x] 移除普通 Claude 对 PTY、TUI lifecycle、workspace trust detector、terminal bytes 和持久 relay lease 的生产依赖；不删除仍被历史读取复用的安全 transcript codec。
- [x] 处理 SDK stream activity、最终文本、权限/认证/MCP/启动错误和取消，确保没有隐藏交互等待或自动第二次 full。

## AI Team Builder

- [x] 让 `desktop/src/ai-team-builder/claude-spawner.ts` 调用共享 adapter，保留隔离 cwd、draft runtime、full/resume、超时/取消和 session callback。
- [x] 从 SDK structured output 读取团队结果，保留严格 schema 校验和安全失败；删除对 `claude-print.ts` 的生产依赖。

## 历史、usage 与 UI

- [x] 扩展 Claude native transcript projector/fixture，覆盖 assistant text/thinking/tool/tool-result/error 以及 input/output/cache read/cache creation/model usage。
- [x] 确认 provider trace link、右侧栏分页、attempt 聚合和重启恢复均从同一 Claude JSONL session ID 工作；记录不可读时显示局部不可用而不降级成 final text。
- [x] 移除 `claudeTerminalTrace` route/ports/renderer surface 及相关失效测试，运行块改读结构化活动和现有完整输出入口。
- [x] 更新 provider adapter、module map、相关 OpenSpec `spec-delta`、真实 Electron acceptance 与测试基线；不改 Codex/Kimi/Pi。

## 验证与收口

- [x] 添加共享 adapter、profile、session identity、MCP、权限失败、usage 去重和 builder structured output 的单元/集成测试。
- [ ] 在真实 Electron 中验证普通 Claude 首轮、同 session 第二轮、取消、认证/权限/MCP 安全失败和右侧栏历史恢复。
- [ ] 在真实 Electron 中验证 AI Team Builder 首轮、resume、schema 输出和隔离工作区边界。
- [x] 执行受影响测试、`pnpm typecheck`、`pnpm check:boundaries`、桌面 build；复核通过后再按仓库约定执行本 change 唯一一次 `pnpm test`。
