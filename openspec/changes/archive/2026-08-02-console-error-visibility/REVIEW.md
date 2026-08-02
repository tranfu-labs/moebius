# `console-error-visibility` 评审裁决（dev-manager）

> 不依赖消息时间线的裁决落盘处。dev 在每个检查点后先读本文件，以最新一节为准；裁决落盘晚于 dev 的
> 检查点提交属正常时序。

## 方案复核 — 裁决：**通过，附一项必改**（方案 `c7ceccb`）

### 认可的判断

- **候选 C 的模型是对的**。`begin/fail/succeed` + `{ sourceKey, generation }` 直接对准根因——
  「一个成功回调清除了不属于它的错误」。`begin` 只推进 generation 而不清错，避免了重试一发起就把
  当前错误抹白，这一点考虑到位。
- **来源粒度正确**。6 个 source family 只是归类，清除条件全部锚在实例上（同 draft/tab、同 session/action、
  同 project/query action），不是按 family 粗放清除。粒度过粗会让跨源保护形同虚设，这里没有犯。
- **候选 B 的否决理由成立**：只拦轮询这一处，其余 23 个成功清除点仍可跨用例抹掉错误。候选中对 TTL 的
  否决同样正确——延时只把错误被错误来源清除的时点推后，不定义所有权。
- **层边界守住了**：domain 无 React/fetch/Electron/timer/locale 依赖；不新增 composition root、不新增
  condition permit；`app.tsx` 262 → 目标 ≤285（硬门禁 300）；view props 不变。
- 验收语句 1 与 4 是机械可执行的（等待 ≥3.2 秒跨三次轮询、两种语言下无需 MutationObserver），
  直接对应 50 批 RA-16 的实际观察，不是泛泛的「行为正常」。

### 必改项：错误遮蔽（affects state shape，须实施前定）

按 design §5 现行规则可推出如下序列：

```
A 失败        → 可见 = A 的错误
B 失败        → 可见 = B 的错误（§5「B 失败可以作为更新的可见错误替换 A」）
B 重试成功    → succeed(B)：token 最新且当前可见错误属于 B → 清除
结果：显示空白，但 A 从未恢复
```

**后来的失败替换掉先前未解决的失败后，一旦后者被消解，前者就永久消失**，用户再也看不到 A 失败过。
这不是单槽显示表面的固有限制，而是模型缺了一步：所有权解决了「谁能清除」，但没有解决「清除之后
该显示什么」。

**要求**：在既有 source 所有权结构上保留「每个 source 当前未解决的错误」；`succeed` 清除当前可见错误后，
若仍存在其他未解决错误，渲染其中最新的一条，而非置空。view 侧仍然只输出一个字符串，`OperatorConsole`
props 与布局不变，改动限于 domain 状态形状与 reducer。

配套验收补充：

- A 失败 → B 失败 → B 成功 → **A 的错误重新可见**；
- A 失败 → B 失败 → B 成功 → A 成功 → 显示清空；
- 上述序列在 stale token 与父级重渲染下结论不变。

不接受的替代做法：靠 view 侧缓存上一条错误（把规则漏进 view）；靠时间顺序数组无上限增长而不按 source
去重；把未解决错误堆成通知列表（proposal 已排除重设计通知体系）。

### 实施约束（沿用四层系列既定口径）

1. `fileDebt=0`、`dependencyDebt=0`、permit **193**、roots **9**，任一变化即停止并回主理人。
2. `app.tsx` ≤285 逻辑行（硬门禁 300）；不在 root 拼来源表，`setClientError` 接缝换成 error controller bundle。
3. 生产 diff 预算 350–650 行；超出预算主动报告，不静默扩张。
4. 不新增 TTL、不做附件特例、不引入通知框架。
5. 测试净删除目标 0；等价替代须逐条写 test-name。
6. 提交清单列出自上个检查点起的全部提交。
7. 合并点跑本 change 唯一一次完整 `pnpm test`；红了修完重跑全量。

### 备注：闸门稳定性

`tests/local-console-execution-runtime.test.ts` 的 `retries a detached Kimi empty response ...` 使用测试
自设 8,000ms 轮询阈值，在机器满载时会以个位数毫秒差距翻红（四层 50 批合并点实测四次中红两次）。
本 change 合并点若单独红于该条，先复跑确认，不得据此改动生产代码。该项已作为独立遗留记录在
`archive/2026-08-02-four-layer-50-final-convergence/REVIEW.md`。

### 当前基线（四层系列归档后，主理人实测）

`pnpm test` 退出码 0、总墙钟 129s：root 99/713（另 1 file / 4 tests skipped）、slow 1/63、
desktop 128/571、console-ui 45/459。`check:boundaries` 617 source / 531 production / 3 roots。
`app.tsx` 262 逻辑行。
