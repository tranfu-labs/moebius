# 任务：repair-local-console-acceptance-scripts

- [x] 修复 `local-runtime-supervision.ts` A2：断言 `crashed + kimi-empty-response`、终端 `kimi` 自查动作、无成因猜测、无 Agent 回复与失败红点；不冻结整段文案，不改产品 Kimi 分类。
- [x] 实跑完整 `local-runtime-supervision.ts`，记录退出码与 evidence 路径，逐条确认 A2、A12、A7、两条 A8 均执行且通过；A2 后不得再中途 abort。
- [x] 修复 `local-console-t5.ts` 的共享成功 fixture：full 生成按 run 隔离的非空 ID，resume 保持请求 ID，返回成功前调用 `onThreadStarted`；不删除或捕获 `provider-session-id-missing`。
- [x] 实跑 `local-console-t5.ts --case primary-agent-closeout`，记录 `ok:true`、`qa,dev-manager` 调用/回复顺序、零 acceptance/integration facts，并核对两个 Agent identity 没有共用 external ID。
- [x] 改造 `local-console-agent-handoff-resume.ts` 的准备阶段：在系统临时 source root 经生产 server/store 和可控 provider 建立 handoff + graceful intent，再确定性投影 legacy footprint；动态捕获 session/run/message/provider IDs，删除作者路径与历史数字常量。
- [x] 保留副本隔离与原根未写护栏：只在 copied root 启动生产 Electron，比较 source manifest、fact log 前缀与动态历史消息稳定字段；若抽取共享 helper，只放 `src/testing/` 并让原测试共同使用，不进入生产模块。
- [x] 不带数据根参数实跑 `local-console-agent-handoff-resume.ts`；记录随机 source/copy 路径、退出码、assertion count 与 evidence 路径，逐条确认 design 列出的九项 assertion 通过，且 source/copy/project 三者不同。
- [x] 收口验证：运行 `pnpm run test --scope 02c1604`、`pnpm typecheck`，并在交付收尾只运行一次完整 `pnpm test`；记录 lint 未配置，不重复堆跑全量。
- [x] 符合度反思：逐项确认只修验收期望/fixture/可迁移性，生产 runtime、Kimi 安全分类、provider identity guard、handoff repair 与 renderer 均未改变；检查没有镜像、重复或失去意义的旧测试需要剪枝。

## 交付记录

### 三条脚本证据

- `local-runtime-supervision.ts`：退出码 0，14/14 assertion。A2 的 terminal 为 `crashed`、`safeCode=kimi-empty-response`，正文包含终端运行 `kimi` 的自查动作且不含额度/服务成因猜测，Agent 消息为空、侧边栏红点；A12、A7、两条 A8 均在 A2 后实际执行并通过。evidence：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-local-runtime-supervision-30WQJM/evidence.json`。
- `local-console-t5.ts --case primary-agent-closeout`：退出码 0，stdout 为 `ok:true`。调用与回复顺序均为 `qa,dev-manager`；QA 使用 `thread-local-console-t5-run-1`、dev-manager 使用 `thread-local-console-t5-run-2`；acceptance facts 与 integration events 均为空。evidence：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-local-console-t5-hX2iUA/t5-evidence.json`。
- `local-console-agent-handoff-resume.ts`：不带数据根参数退出码 0，随机 source/copy 根彼此不同且均不等于 project root；9/9 assertion 全部通过，动态 session/run/source/provider ID 已记录，原 QA 同 run/step/attempt/provider resume，replacement full 增量为 0，fresh continue 使用自身 source/run 与 dev-manager context，重复启动 repair 幂等，源根 manifest 未变。evidence：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-local-console-agent-handoff-resume-bqeLPW/evidence.json`。

Handoff 脚本改造过程中有三次未通过运行，均未粉饰成最终证据：第一次暴露准备 server 的注入 Agent 列表没有持久化团队快照，真实 Desktop 把 fresh message 交给默认 `ceo`；第二次暴露自造 team id 在真实 Desktop 中会进入 `team-needs-repair`；第三次已经完成 6 项断言，但旧脚本把“没有 replacement full”误写成“历史 full 总数为零”，不适用于生产写链生成的样本。最终实现持久化 `development` 团队身份与冻结 dev-manager/qa snapshot，并按运行前后 full 数增量断言 replacement 为零；没有修改产品路由、团队健康、resume 或 repair 规则。

### 自动化闸门

- 共享 helper 机械抽取后，`tests/local-console-codex-resume.test.ts` 原有 10/10 通过；该测试文件只更换 import 并删除原地 helper，既有断言零改动。
- `pnpm run test --scope 02c1604`：退出码 0，因 `02c1604` 不是当前分支祖先而命中 42 个测试文件（root 1、Desktop 6、console-ui 35），分别 10/10、104/104、412/412 通过；该结果包含上一批分叉，不冒充本批最小闭环。
- `pnpm run test --scope f7f3fcb`：退出码 0，机器命中本批 1 个测试文件，10/10 通过。
- `pnpm typecheck`：退出码 0。
- 完整 `pnpm test`：交付收尾只运行一次，退出码 0；import boundary 通过，root 947 通过/4 跳过，慢测 63/63，Desktop 424/424，console-ui 459/459。
- lint：仓库没有配置 lint 命令，未声称执行。

### 符合度反思

- 生产 `src/kimi.ts`、execution driver、provider identity guard、handoff repair、renderer、local-console API 与持久化 schema 均未修改；改动限于三条 acceptance script、一个 `src/testing/` 纯 fixture helper，以及既有测试对该 helper 的机械 import 替换。
- A2 断言稳定 code、用户自查动作、无成因猜测与外部失败状态，不读取源码或冻结整段文案；T5 断言 provider identity 的非空与隔离；handoff 断言真实写链、legacy 投影、copy 隔离和外部副作用，均不是镜像测试。
- 共享 legacy helper 完整复制原测试逻辑；既有测试断言一行未动。没有旧测试因本改动失去意义，也没有新增测试重复覆盖同一分支，因此不删除或机械改写测试。
- 产品意图和已记录行为事实均未变化，PRD、spec、ADR、module-map 无需更新；本 change 没有 spec delta、wireframe 或 architecture 产物。
- 本批没有用户可见行为变化，按批准方案不新增真机 UI 验收语句；三条脚本实跑只作为验收基础设施证据。
