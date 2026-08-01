# 设计：four-layer-30-github-runner

## 方案

application flow 显式保持以下阶段：build timeline → acceptance pre-pass → roundtable recovery → mention
trigger → external no-mention fallback → workspace/prescript/media/reaction/provider → artifact/guardrail/comment
→ manifest/role-thread/intake save。

每个阶段只接收窄端口。conversation、trigger、intake、goal-ledger、ceo-orchestration 等纯模块继续
拥有业务判据；application 只决定调用时序和提交/补偿。GitHub、provider、media、state persistence
是 adapters。预估改动 3.0k–4.5k 行；累计纯比例 66–74%，完整闸门 98–114 秒。

## 测试对账

`tests/runner.test.ts` 中可由纯 route/intake/acceptance decision 覆盖的参数组合可降级；保留主流程
顺序、gh/Codex adapter、reaction-before-provider、L1 never-resolve、S1 visible-before-cursor、V1
failure visibility 与 state restart 接缝。每个 test name 按系列 ledger 对账。

## 真实运行验收

- RA-11：白名单 sandbox issue 的合法 mention 先出现受控 reaction，后只出现一条目标 Agent 评论，
  runner 最终释放 in-flight。
- RA-12：active issue 无 mention 评论只产生一次既有 fallback result，runner 重启后不重复。

sandbox 或真实 provider 前提不满足即把对应条目标记“未验证”，fake gh/mock provider 不抵扣真实
页面；合并/归档策略按 proposal 的待决环境策略执行，并须在本批开工前确定。

## 风险

- 发布顺序漂移：以 L1/S1/V1 故障注入和真实 sandbox 为双 oracle。
- 新 application 模块复制 domain 规则：每个条件分支必须指向既有/新 domain decision。
- 为统一而重写现有模块：禁止；只移动主链装配和剩余内联判据。
