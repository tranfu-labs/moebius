# 提案：four-layer-00-boundary-foundation

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/architecture/module-map.md` | 全部模块的「禁止依赖」 | 增加四层唯一归属、依赖矩阵与 legacy debt 登记 | 实现验证后更新 |
| `openspec/changes/four-layer-architecture-series/design.md` | `四层归属与依赖矩阵` | 本 change 的已批准系列契约 | 已核验 |
| 全部现行产品 PRD / OpenSpec specs | 现有行为 | 只作为零行为变化基线 | 无变更 |

`spec-delta/` 保持为空。本 change 只增加工程边界门禁。

## 背景

现有 checker 能执行包级规则与两个 planner 传递闭包，但没有要求全生产文件唯一归属四层，
也没有阻止当前纯模块未来传递依赖 IO。后续全面迁移若没有先行 ratchet，每批都可能一边提纯
一边新增反向依赖，无法判断债务是否真正下降。

## 提案

- 扩展现有 TypeScript AST import checker，不引入第二套工具。
- 登记全部生产 TS/TSX 文件的 view/application/domain/adapter 唯一归属。
- 落地四层依赖矩阵、domain 传递闭包、composition-root exact allowlist。
- 对存量违规建立 exact importer→target debt ledger，并绑定预定移除 change；新债务禁止进入。
- 把当前已确认的 10,301 行纯业务/状态模型全部纳入 domain closure 保护。

## 影响

修改 checker、checker 测试、测试入口必要装配和架构文档；不移动生产业务代码，不改变测试
选择、用户行为或运行时依赖。
