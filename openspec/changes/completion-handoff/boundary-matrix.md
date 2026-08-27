# completion-handoff 边界矩阵

日期：2026-08-27

本矩阵覆盖本方案的 M1–M3 三个功能单元。M3 复用目标 Moebius 运行环境已有表单能力；该外部协议不在本仓库内重复实现，尚未完成真实运行时演练的格子明确标为“未验证”。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| M1 Skill 注册表与 Claude/Codex 投影 | 源目录缺失或为空时返回空结果与诊断，不伪造 Skill；对应 `tests/moebius-skill-registry.test.ts`，定向回归已验证。 | 非法目录名、缺 frontmatter 或文件系统写入失败时跳过并记录诊断；对应 registry malformed-source 测试，定向回归已验证。 | 同一注册表目标按路径串行物化，软链接遇 `EEXIST` 重查目标；对应 concurrent-startup 测试，定向回归已验证。 | 用户已有非软链接条目不覆盖，投影根不可创建时报告失败；对应 conflict/projection-root 测试，定向回归已验证。 | 源目录、注册表或投影根恢复后可再次启动建立链接；对应 recovery 测试，定向回归已验证。 |
| M2 Skill 与 provider prompt 编排 | 没有真实证据或未显式收束时不准备交接；provider prompt 只保留边界，不伪造表单结果；prompt 定向回归已验证。 | 不猜测外部表单工具名或 schema，缺失字段保持不可用或 `未验证`；当前仓库没有外部协议验证，未验证。 | prompt 构造无共享可变 closeout 状态；同一 Skill 可被多个 provider 独立加载；并行 provider 演练未验证。 | Claude/Codex 只使用标准用户 Skill 根的受控软链接，不覆盖冲突项；Kimi/Pi 原生投影为用户确认的 TODO；路径冲突定向回归已验证。 | Skill 或表单能力不可用时报告确切限制并停止表单路径，不改用普通聊天问题或后台 shell；真实 provider 失败恢复未验证。 |
| M3 既有表单能力的运行时使用 | Agent 无完成证据时不调用表单；由 Skill 规则约束，目标运行时演练未验证。 | 使用运行时实际公开的既有表单校验，Skill 不定义新协议或工具名；外部校验未验证。 | 复用既有表单能力的并发/重复提交语义；本仓库无协议实现，未验证。 | 复用既有运行时的表单授权与 provider 工具可见性；本仓库无权限协议实现，未验证。 | 表单不可用或调用失败时保留事实并停止该路径；真实 Moebius 运行时恢复演练未验证。 |

## 未覆盖的事实边界

- `origin/claude/agent-form-ui` 的最终发布/部署路径和表单调用协议仍为“待核实”；只读历史不能证明当前 Moebius 运行时已公开该能力。
- Kimi/Pi 原生 Skill 投影属于用户确认的 TODO，本轮只保留 prompt fallback。
- 当前 provider session 的 `ALL_TOOLS` 名称过滤 `/form|question|handoff|closeout/i` 无结果；既有表单能力的目标 Moebius 运行时发现、展示、选择回流和失败恢复仍为“未验证”。

## 全量回归

- `pnpm test`：退出码 0；root 非慢测 145 文件通过、1 跳过，1036 测试通过、5 跳过；root 慢测 1 文件、68 测试通过；Desktop 176 文件、945 测试通过；console-ui 69 文件、698 测试通过。
- 步骤 1 基线同一命令退出码 1：root 非慢测 150 文件通过、1 跳过，1052 测试通过、5 跳过；root 慢测 1 文件中 67 通过、1 失败，因此后续 workspace 未执行。
- 新增测试用例 8 个；当前边界测试和全量输出均无测试失败，5 个 Claude real acceptance 测试按基线保持跳过。
