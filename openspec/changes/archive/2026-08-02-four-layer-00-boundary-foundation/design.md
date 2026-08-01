# 设计：four-layer-00-boundary-foundation

## 方案

复用 `src/testing/import-boundaries.ts` 的 parser、runtime edge 和 transitive path 机制，新增：

1. layer scope registry 与生产文件 total-assignment 检查；
2. caller-layer → target-layer matrix；
3. domain 禁止副作用 external/repository targets 的传递闭包；
4. exact composition-root allowlist；
5. exact legacy debt ledger，字段为 importer、target、reason、removalChange；
6. stale debt、prefix debt、未归属和多重归属诊断。

静态官网没有 TS import 图且不参与桌面、local-console 或 runner 的运行时装配，明确排除在本批
layer registry 之外；不新增 marketing-site 登记。测试、Story、fixture、generated、scripts 和
prototypes 明确排除。

门禁 ID、矩阵与量化目标以系列 [design.md](../four-layer-architecture-series/design.md) 为准。

## 验收与最小验证

- fixture 新增未归属生产文件时失败并打印路径。
- 同一文件命中两个 scope 时失败并打印两个归属。
- domain 直接/两跳 import fs、SQLite、provider 或 Electron 时失败并打印完整路径。
- application 直接按业务字段分支或超过 use-case budget 时失败；复杂度、use-case 逻辑行、
  composition-root 逻辑行、多个 runtime use-case export 分别由只触发自身规则的反例 fixture 锁定；
  条件删除后留下的 exact transport-control permit 也失败。
- adapter 内联 `role + stage` 业务过滤且没有 external-contract permit 时失败；codec 改写非传输字段
  时 lossless contract fixture 失败。
- type-only edge 不计 runtime closure。
- view→adapter、application→view、adapter→application use case 分别红；合法 port type edge 绿。
- legacy debt 只 exact 豁免；扩大 prefix、目标消失后留 stale 条目均红。
- 现有 25 条规则继续双向匹配文档，`pnpm test` 的 suite 选择不变。

本 change 不删除任何测试。纯比例保持 34–41%；已知 10,301 行纯模块受保护率达到 100%。
完整闸门允许因 checker 增加到 132–136 秒，不声明速度收益。

## 权衡

- 不按目录强制搬家：先登记真实归属，避免用大规模 rename 制造无行为价值的 diff。
- 允许 exact debt：当前结构不能一步通过最终矩阵；显式、有 owner 的 debt 能让每批独立绿。
- 不允许 wildcard debt：否则门禁会成为永久豁免区。

## 风险

- 归属表过度手工：total-assignment 与 stale 检查防止漂移，最终 change 归零 exact debt。
- 把 type-only 误判运行时依赖：沿用现有 runtime edge 规则并补反证。
- checker 变慢：记录 preflight 单独耗时；超过 5 秒增量则优化扫描缓存，不放宽规则。
