# 提案：visual-requirement-flow

## 背景

- 需求从目标到实现缺一条视觉链路：系统里没有 UI 设计角色；product-manager 不产线框；「和用户画像对齐」没有可执行的流程定义，全凭各角色自由发挥。
- 视觉类需求经常从中间进场（issue body 直接带一张设计图让 dev 做），中间产物载体多样（字符线框、手绘照片、figma 链接、截图）。固定步骤序列（画像 → 线框 → 设计稿 → 实现）对这两种情况都是脆的：要么把用户拽回第一步走过场，要么为每种进场方式堆例外规则。
- T7（agent-handoff-closing-protocol）已建立收尾行协议 + CEO 第 0 裁决 + 统一输出骨架，「执行方只管小流程、CEO 守护负责阶段路由」的机制已经就位（先例：`plan-written` → `@qa`、`code-verified` → 发起需求角色），但尚无视觉需求的路由剧本。

## 提案

以「产物盘点」模型把视觉需求大流程编排进 CEO 剧本层，角色只管自己的小流程：

1. 新增 `agents/ceo-scripts/visual-requirement-flow.md`（`action: route`）：大流程唯一事实源，含产物契约表（目标共识 / 版式基准 / 视觉基准，各带机械满足判据）、缺口路由表（按依赖序取最早缺口）、归一化动作（figma 等外链请导出贴图）；CEO 按剧本 append 时正文必带三行盘点。
2. 新增 `agents/ui.md`：视觉设计 agent，`workspace_access: read-run`，产出 SVG/PNG 设计稿由 runner artifact publisher 发布为可查看链接；只写小流程，不写自己在大流程中的位置。
3. 修改 `agents/ceo.md`：协作生态认知清单加 `ui`；新增「视觉需求产物盘点路由」业务场景（含画像 agent 走查通过后不陪等的例外）；输出格式 `as` 集合加 `ui`。
4. 修改 `agents/product-manager.md`：新增视觉需求产物职责（「需求画像切片」「版式基准」两个固定节标题产物 + 交棒画像 agent 走查）；勘误阶段 C 写死的「交棒给 `@dev`」拓扑表述（阶段切换路由归 CEO）。
5. 修改 `agents/hermes-user.md`：走查对象从「dev 的方案或实现」扩展到 PM / ui 产出的视觉产物；不通过时打回产出方而非固定 `@dev`；视觉产物走查通过后不自行指定下游。
6. 代码白名单同步：`src/format-ceo.ts` 的 `CEO_APPEND_ROLES` 加 `ui`；`src/ceo-scripts.ts` 的 `REQUIRED_CEO_SCRIPT_IDS` 加 `visual-requirement-flow`；对应测试更新。

范围假定（本 change 显式不做，留给后续独立 change）：

- 画像机制与数据分离、项目级画像推算冷启动：本次假定每个项目有对应的用户画像 agent md（当前实例 `agents/hermes-user.md`）。
- runner 停滞唤醒机械兜底（T7 路线图已列）。
- dev 直读 figma 等产物载体扩展（届时给契约表加合法载体行即可）。

## 影响

- 以 agents 提示词层为主；运行时代码只动两个白名单常量与测试，runner 每轮重读 persona，改完即生效。
- 行为变化：视觉类需求上 CEO 守护会以「盘点 + 路由」append 介入；`@ui` 落盘即可被 mention 触发（`agents/*.md` 自动发现，触发链路无角色硬编码）；dev 既有链路（plan-written → qa → 验收 → 实现）不变。
- 受影响 spec：`openspec/specs/github-issue-runner/spec.md`——可触发角色清单、CEO append `as` 集合、T7 统一输出骨架适用角色数、issue workspace 授权、必需 CEO 剧本清单（归档时合并 delta）。
- 残余风险与 T7 同类：CEO fail-open 时路由不发生、流程停等真人；缓解措施（停滞唤醒、流程看板）在既有路线图中，不混入本 change。
