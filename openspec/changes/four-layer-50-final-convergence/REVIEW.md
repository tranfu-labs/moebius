# 50 批评审裁决（dev-manager）

> 不依赖消息时间线的裁决落盘处。dev 在每个检查点后先读本文件，以最新一节为准；裁决落盘晚于 dev 的
> 检查点提交属正常时序，对应裁决未出现即为尚未落盘，不必重发交棒。

## 方案复核 — 裁决：**通过，直接实施**（方案 `e95d82a`）

### 基线独立确认

- copy debt：**6 文件 / 16 条**（`attachment-client` 7、`attachment-preview` 4、`use-attachment-replacement` 2、
  `edit-resend` 1、`team-state` 1、`use-attachment-upload-queue` 1），与方案一致。
- 四层状态：`fileDebt 0 / dependencyDebt 0`，condition permits **193**，composition roots **9**。
- 方案提交未改动任何生产代码，工作区干净。

### 认可的关键判断

- **候选 B 的否决理由成立且关键**：把 `t(...)` 结果直接传入或按 locale 建闭包 client，会让在途的
  upload/restore 在语言切换后仍显示启动时的旧文案。这正是本次改造最容易埋进去的 bug，方案在选型阶段
  就排除了它。
- **候选 C 的边界正确**：failure code 是本地 plain union，attachment adapter/preview 不 import
  locale/`Translate`；翻译发生在 application 提交点，从 translation ref 读取**最新** translator。既没有
  让 adapter 反向依赖 view，也没有把它扩张成全局错误框架。
- **候选 D（重开 20/40 批）以可追溯性否决**——四层 debt 已为 0，重开已归档 change 无额外收益。
- 风险段逐条堵住了本系列五批实际发生过的作弊路径，且是立账时自写而非评审后补：
  - 「禁止 `i18n-exempt`；debt 必须删除，不能改 count」→ 对应 30 批 copy guard 棘轮。
  - 「镜像测试只断言 sentinel 行为与 key 结构，不读取生产源码断言某句 copy」→ 对应 10/30/40 批三次
    源码镜像断言在合并点断裂。
  - 「生产 diff >500 或出现新 layer debt 时停止，退回对应前序范围」→ 收敛批不得变成重构批。
  - 「指标未达记事实，不通过删测或改等待制造收益」→ 对应 10/20 批速度记账口径。
- 测试传 sentinel translator、不冻结中英文原句，避免把文案本身变成断言。

### 需记入「接受的后果」

commit 时解析 translator 可以保证**新产生**的失败使用当前语言，但**已提交并显示**的错误文案不会随后续
语言切换而重新翻译（此时状态里已是渲染好的字符串）。

完全消除该限制需把 failure code 存入 state、在 view 层翻译，这会穿透 console-ui 的 prop 契约，几乎必然
突破 500 行硬停点，与本批「收敛而非重构」的定位冲突。**因此接受该限制，但必须在 design 的接受后果中
显式记录**，使其成为已知取舍而非疏漏。若后续产品要求错误文案随语言实时切换，另开 change 处理。

### 实施约束

1. **500 行硬停点是真闸不是目标**：生产 diff 超限或出现新 layer debt 立即停止并退回对应前序范围，
   不在收口批内继续重构。
2. **16 条文案必须真正进入 locale resources**：debt 条目随之删除，不得改 `hanLiteralCount` 数字，
   不得使用 `i18n-exempt` 绕过。
3. **RA-16 按重叠改动裁剪**：判断 30 批 local-only 与 40 批 provider 验收是否需要重做——既不因
   「反正跑一遍更保险」全量重跑，也不因「应该没影响」全部跳过；判断依据写进记录。
4. 合并点跑本 change 唯一一次完整 `pnpm test`；红了修完重跑全量，不接受只补跑单个 scope。
5. 提交清单列出自上个检查点起的全部提交。

### 当前闸门基线（40 批归档后，主理人实测）

root 99/713（另 1 file / 4 tests skipped）、slow 1/63、desktop 128/566、console-ui 45/460，122s，全绿。
`check:boundaries` 617 source / 531 production / 3 roots。
