# 任务：provider-native-process-traces

- [x] 把过程 capability 从 `engine === "codex"` 改为 provider resolver registry 派生，
      复用 `execution_session_link` 与 immutable run context，并保持未知 engine 局部降级。
- [x] 抽取共享 trusted JSONL identity / previous-page / append reader，迁移 Codex 使用且
      保持现有 rollout 行为、错误码和测试兼容。
- [x] 实现 Claude transcript resolver：生效 data root、精确 UUID 文件名、session/cwd
      交叉校验、候选唯一性、sidecar 安全读取和 provider-native projector。
- [x] 实现 Kimi wire resolver：source/managed home 边界、index 解析、workDirKey hash
      校验、旧 managed absolute path 重锚定、main wire/blob 安全读取和 projector。
- [x] 把 process-history / invocation / append API 改为按 engine 分派，并以共享 attempt
      envelope + engine-discriminated payload 支持三 provider、多 attempts 与活动轮询。
- [x] 更新 desktop process DTO adapter，不在 renderer 侧读取 provider 文件或复制
      resolver 业务规则。
- [x] 更新 console-ui 的完整输出入口、provider context sections、Claude/Kimi 原生事件、
      provider-specific unavailable 与 i18n；保持虚拟化、阅读锚点和只读转义边界。
- [x] 增加 shared / Claude / Kimi resolver 与 projector 单测，覆盖 missing、duplicate、
      cwd/hash 冲突、symlink escape、inode swap、truncate、半行、超大记录、sidecar/blob
      越界、unknown event 和单 attempt 清理。
- [x] 增加 process-history / runtime 回归：旧 persisted false、三 provider 多 attempts、
      active trace 延迟出现、provider 防串线、Codex prompt/token/reasoning 行为不变。
- [x] 增加 UI 异步环境测试：父级重渲染、callback 身份变化、慢/失败返回、切换
      tab/session/engine 后迟到响应、局部重试与既有事件/阅读位置保留。
- [ ] 按 `design.md#真实运行验收` 完成 Claude、Kimi、原生文件移走和多 attempt/重启四组
      真实页面断言，并记录系统临时 evidence 路径。
  - [x] Claude thinking / Read / 唯一工具结果、两次 attempt 元数据与桌面重启保留均已在
        真实 Electron 页面断言。
  - [x] Kimi 在额度 403 下仍完成真实 session/index → workDirKey SHA-256 校验 → 旧
        managed absolute sessionDir 向 source home 重锚定 → wire identity → 原生
        systemPrompt / turn.prompt / context / llm.request 投影与真实页面 Kimi 标注。
  - [x] Kimi wire 移走后，真实页面仅显示“Kimi 过程记录已不可用”，未拿最终回复或
        Codex 结构替代；验收后 wire 已恢复。
  - [ ] Kimi 真实 thinking 渲染：账户本计费周期额度耗尽，模型响应前返回 HTTP 403。
  - [ ] Kimi 真实 tool call 渲染：账户本计费周期额度耗尽，工具调用前返回 HTTP 403。
  - [ ] Kimi 真实 tool result 渲染：账户本计费周期额度耗尽，工具结果前返回 HTTP 403。
  - 2026-07-31 再次用当前默认 Kimi 配置发送最小 prompt，仍返回本计费周期额度 403；
    未运行会被空响应失败门禁阻断的 Electron 三项补验。
- [x] 运行定向 Vitest、`pnpm test`、`pnpm typecheck`、console-ui Storybook/build 与必要
      desktop build；长日志写系统临时目录，只回读退出码和关键行。
- [x] 按最终真实模块职责更新 `docs/architecture/module-map.md`，仅在新增组件模式时更新
      `packages/console-ui/DESIGN.md`；核对 PRD 与实现一致。
