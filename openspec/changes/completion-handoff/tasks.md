# 任务：completion-handoff

## 设计与事实源

- [x] 将完成交接表单写入 `docs/product/pages/main-conversation.md`
- [x] 从 `_template` 创建 change 工作区
- [x] 编写 `proposal.md`、`design.md` 与 `spec-delta/local-console/spec.md`
- [x] 经评审处理提醒并冻结本 change 的设计基线

## 实现

- [x] M1 维护 `completion-handoff` 源 Skill，生成中心注册表并为 Claude Code/Codex 建立标准目录投影；Kimi/Pi 保留 prompt fallback
- [x] M2 在 Skill 与 provider prompt 中固化证据、四类选项和无副作用边界
- [ ] M3 在目标 Moebius 运行时验证并使用已有表单能力；不新增 MCP 协议或 renderer 实现

## 验证

- [x] M1/M2 完成 registry、Skill frontmatter、prompt 模式及受影响 local-console 的定向回归
- [x] M1/M2 的 `pnpm typecheck`、`pnpm check:boundaries` 与 Desktop build
- [ ] M3 在真实目标运行时完成一次既有表单发现、展示和选择回流演练
- [ ] 真机 Electron 中完成一次带副作用的用户动作验收并记录 evidence（仅验证既有表单入口，不新增 closeout UI）
- [x] 按步骤 4 完成边界矩阵与全量回归（见 `boundary-matrix.md`）；M3 外部表单演练仍明确标为未验证
