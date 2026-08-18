# 提案：session-title-generation-entry-points

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-conversation.md | 区域与信息 · 页面标题 | 新增自动生成标题语义（异步、≤20 字、失败静默、不覆盖手动改名） | 已写入 |
| docs/product/pages/main-conversation.md | 验收标准 #3 | 首条消息后异步生成并重命名标题纳入验收 | 已写入 |
| docs/product/pages/search.md | 操作与反馈 | 「没有重命名时是自动生成标题」——与修复后行为一致，无需修改 | 无需修改 |

## 背景

v0.5.2 引入的「新会话自动生成对话标题（提示词 v2）」（#214）只在 `submit()` 路径接线：向已存在空会话追加首条消息时触发。但桌面端「新对话 → 发送首条消息」的真实形态是 **create + initialMessage**（`POST /api/local-console/sessions` 携带 `initialMessage`，会话与首条消息原子落库），该路径从未调用标题生成——桌面端新建的每个会话都保留默认截断标题，且无任何失败提示（静默缺失）。

根因（四层）：机制层两条「首条消息落库」路径互不相通，功能只接了一条；设计层未枚举全部入口（#214 只动 submit 侧）；验证层测试与真机均只覆盖 submit 形态；治理层该行为从未进入 spec，触发面无锚点。

## 提案

1. 把标题生成触发接到 creation 路径：`session-creation-runtime.create()` 在会话+首条消息原子落库后，复用 domain 判定 `decideTitleGeneration`（wasFirstMessage 恒 true + 有文本），命中则 fire-and-forget 触发；
2. 两条入口共享同一个 `LocalConsoleSessionTitleRuntime` 实例与同一个触发端口形状（`generateSessionTitle({sessionId, firstMessageBody})`），由 `runtime-session-wiring` 构造一次注入两处——inFlight 守卫、失败静默、乐观锁语义、开关语义全部保持不变；
3. 测试补桌面形态（create + initialMessage）：触发生成、不重复生成、纯附件不生成、无消息创建不触发；
4. 行为进入 `openspec/specs/local-console/spec.md`（触发面 MUST 覆盖两条入口），架构图更新为双入口。

## 影响

- **修改**：`src/local-console/session-creation-runtime.ts`（触发）、`session-command-wiring.ts`（creation 端口组）、`runtime-session-wiring.ts`（共享触发注入）；`tests/local-console-session-title.test.ts`（+4 用例）；`docs/product/pages/main-conversation.md`（PRD 落盘）；`docs/architecture/session-title-generation.svg`（双入口，归档时回流）；`docs/architecture/module-map.md`（图引用与职责描述）。
- **不动**：`message-command-runtime.ts`（submit 触发保持）、renderer/desktop 侧（零改动）、SQLite schema（复用 renameSession）、提示词与清洗逻辑（强基准不动）。
- **对外行为**：桌面端新建对话首条消息后，标题从默认截断变为模型生成（≤20 字）；失败时与现状一致静默保留默认标题。生成会额外消耗一次执行引擎调用。
