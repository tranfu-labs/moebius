# 设计：four-layer-20-desktop-renderer

## 方案

内部按两个可独立回滚的提交推进，但作为一个 change 统一真机验收：

1. **Shell/team/settings/onboarding**：把请求 owner、generation、phase 和 reducer/model 从 React 容器
   析出；preload/localStorage 是 adapter；view 只消费 state + intents。
2. **Conversation/search/sidebar**：把 selection/presentation route、process output、analysis、search、
   project/session mutation 和 sidebar draft orchestration 收入按用例命名的 controllers。

异步 controller 测试必须覆盖父级重渲染、回调身份变化、慢返回、失败、取消与 stale result。
`app.tsx` 最终仍是 application composition root，可 import controllers/adapters/view，但必须 exact allowlist。

预估改动 5.0k–7.0k 行；累计纯比例 60–69%，完整闸门目标 102–118 秒。

## 测试对账

可降级候选是 `desktop/tests/console-app-*.test.tsx` 与 `state-sync.test.ts` 中只证明 reducer、owner、
generation 或 route transition 的重复组合。新纯测试按 controller/model 直接传事件和结果。

必须保留：真实 browser fetch receiver、preload IPC、父组件重渲染接缝、慢/失败请求、关键
OperatorConsole prop wiring 和真机副作用动作。每个删除项填写系列 ledger，不接受按文件整删。

## 真实运行验收

执行系列 RA-05、RA-05a～RA-10：

- 设置切语言/更新/复制并重启复查；
- 左侧栏 A/B 快速往返时两份草稿归属不串线，慢切换期间发送禁用，最终 selection 与未读状态一致；
  重启后持久事实符合既有契约；
- 团队/成员切换与保存只反馈目标 owner；
- onboarding 回看后原会话现场保持；
- 两次搜索迟到结果不拉回页面；
- 消息/会话分析结果进入正确右栏且不抢已离开现场；
- 改动/文件/过程/子任务/普通会话标签按 host 保持并在刷新时不抢占。

## 风险

- controller 变成 app.tsx 的复制品：按用户旅程切分，纯 transition 与 adapter 分开，不建通用 store。
- 现有缺陷被顺手修：审计 R-* 只作风险提示；发现行为差异登记独立 change，不并入本 change。
- callback identity 回归：测试明确覆盖不稳定父回调与慢返回。
