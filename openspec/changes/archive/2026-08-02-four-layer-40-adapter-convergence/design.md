# 设计：four-layer-40-adapter-convergence

## 方案

按外部边界逐组清债：

1. desktop main/team/onboarding/updater/file-manager/IPC/browser storage；
2. Codex/Claude/Kimi process、trusted JSONL、workspace/files/attachments；
3. local SQLite/JSONL state、HTTP server 与 composition roots。

实施前簇级账按最新债务形状拆开维护；第一簇见
[`provider-infra-cluster-ledger.md`](provider-infra-cluster-ledger.md)，第二簇见
[`ai-team-builder-cluster-ledger.md`](ai-team-builder-cluster-ledger.md)，第三簇见
[`desktop-team-cluster-ledger.md`](desktop-team-cluster-ledger.md)。账面目标未经主理人核验不得实施。

adapter 可以包含外部协议校验、路径安全、原子写和 wire→DTO 映射；“用户/会话/任务在什么条件下
允许什么结果”属于 domain。application 只调用 ports。`LocalConsoleStore` 名称、方法和 schema 不变。

预估改动 2.5k–4.5k 行；以 30 批删除后新基线提升 6–10pp，完整闸门目标 92–116 秒。若剩余集成用例都在证明
真实 IO，此批速度收益允许为零；其必要性是消除非法依赖和业务规则共居，不以删测试凑指标。

## 测试对账

只有 parser/classifier 参数组合可以迁到纯测试。以下不可删除：

- SQLite/JSONL 原子性、锁、重启和 migration；
- realpath/regular-file/device/inode/size/path traversal；
- provider spawn、watchdog、session link、native transcript/wire；
- preload IPC channel、fetch receiver、HTTP error mapping；
- local HTTP/preload 边界与 provider argv/stdin。

每个候选仍按系列 test-name ledger 证明等价。

## 真实运行验收

- RA-13：真实附件预览、发送、重启恢复和删除生命周期归属正确。
- RA-14：本批触及的 IPC/文件管理器/外链动作产生正确系统动作和屏幕反馈；取消/失败可恢复。
- RA-15：本批触及且环境可用的 Codex/Claude/Kimi 各完成一次真实链路，过程、terminal、resume link
  与重启展示一致；不可用前提逐 provider 标记“未验证”，合并/归档策略按 proposal 的待决环境策略
  执行，并须在本批开工前确定。

## 风险

- 把 data adapter 拆成新 repository 层：禁止，store port identity 是验收项。
- 误把安全校验当领域规则：与外部路径/wire 可信性直接相关的校验留 adapter。
- 为纯比例移动 DTO/常量：不计收益；只统计包含业务决策的行。
