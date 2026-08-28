# 任务：electron-43-upgrade

## 0. 输入、方案与 spike

- [x] 建立需求基线，更新 `docs/product/flows/state-change-delivery.md` 的 Electron 43 退出后历史通知回流语义。
- [x] 盘点 Electron 39–43 官方 breaking changes 与仓库生产代码命中点。
- [x] 用 Electron 43.4.1 临时依赖和 TypeScript 探针验证 `Notification.getHistory()`、`id`、`groupId`，并确认没有 macOS notification authorization API。
- [x] 在 `design.md` 记录 spike 命令输出、方向性风险判定、保留 Swift bridge 的理由和未验证项。

## 1. Electron 43 依赖与运行时适配

- [x] 将 desktop Electron 依赖与 pnpm lockfile 更新至 `43.4.1`，确认 lazy binary download 的安装/首次运行路径（前台 install-electron 与 electron-builder 均完成 binary 下载/解压）。
- [x] 按 `design.md` 的 39–43 账本完成源码、类型、构建配置和运行时行为复核；静态扫描无生产命中，只修复基线测试中的重复字段。
- [x] 用 `env -u ELECTRON_RUN_AS_NODE` 验证开发启动、desktop typecheck、desktop build 和 arm64 dist。

## 2. 通知历史回流

- [x] 新增通知 ID 编码/解码纯逻辑，保证同一 `eventId` 跨重启稳定且非法输入安全降级（纯函数测试 2/2）。
- [x] 扩展通知状态文档，向后兼容旧状态并原子保存 `notificationId -> click target` 映射（state/runtime 测试覆盖）。
- [x] 更新 `MacOsNotificationChannel`，提交 `id/groupId`，实现幂等 `Notification.getHistory()` 恢复和已知历史对象 click listener（channel 测试覆盖 show/failed/timeout/history）。
- [x] 让历史恢复在 app ready 后、local-console 就绪前启动，点击先持久化并复用现有 `recordClick` / renderer 定位 / `consumeClick` 链路（wiring 测试覆盖）。
- [x] 确认普通启动、未知历史 ID、history 查询失败和重复恢复都不自动导航、不伪造点击（未知 ID/wiring 与恢复幂等测试；查询失败由 channel 异常降级实现，真实通知中心留待 M4）。

## 3. 授权桥与打包

- [x] 保留 `desktop/native/macos-notification-permission` Swift bridge，验证 Electron 43 开发/生产 bundle 选择、签名和 extraResources 路径（两变体与打包资源均已检查）。
- [x] 不新增与宿主同 bundle id 的第二套通知提交通道；通知提交由 Electron `Notification` 负责，bridge 只负责授权状态/请求。

## 4. 测试与验收

- [x] 新增/调整 notification channel、history、state、runtime、wiring 和 lifecycle 行为测试；不写镜像实现测试。最终 `--scope` 根 11/11、desktop 99/99；另修复既有 wrapper 测试监听竞态。
- [x] 每个功能单元完成验收标准落位自查，补齐前后台点击、退出后历史点击和 task-reminder 单测覆盖或登记差异；记录见 `boundary-matrix.md`，真实通知中心动作留待步骤 5。
- [x] 步骤 4 产出边界矩阵并按基线重跑全量 `pnpm test`，如实对比通过/失败/跳过/耗时/新增测试数；修复 wrapper 测试竞态后的最终全量为退出码 0，完整对账见 `boundary-matrix.md`。
- [ ] 用本地 arm64 签名 `release/mac-arm64/Moebius.app` 完成本地真实验收：通知中心注册、前台/后台横幅点击、退出后历史通知冷启动定位。
- [ ] 仅在用户终验收通过后执行 push/merge 等外发动作；验收前不修改 release skill、不发布。

## 5. 交付记录（2026-08-27，待用户验收）

### 5.1 变更摘要

- Electron：`desktop/package.json` 与 `pnpm-lock.yaml` 锁定 `43.4.1`；逐项复核 Electron 39–43 breaking changes，未命中生产 API 的项目不增加无依据适配。
- 通知历史：新增 `desktop/src/task-reminder-notification-identity.ts`；`notification-channel.ts` 接入 `id`、`groupId`、`Notification.getHistory()` 和幂等 live-object listener；delivery state 原子保存 `notificationId -> { sessionId, roundId, terminalMessageId }`；历史点击复用既有持久化 click/renderer 定位/consume 链路。
- 授权：保留 `desktop/native/macos-notification-permission` Swift bridge；Electron 43 只负责通知提交与历史对象恢复，未新增第二套通知提交通道。
- 测试：新增/调整 channel、identity、state、runtime、wiring、permission adapter 行为测试；另修复 `tests/managed-process-wrapper.test.ts` 的 close 监听竞态和基线重复对象键。
- 文档：更新 `docs/product/flows/state-change-delivery.md`，新增本 change 的 OpenSpec 文件和 `boundary-matrix.md`。
- 运行：`env -u ELECTRON_RUN_AS_NODE pnpm --filter @moebius/desktop dist` 生成 `desktop/release/mac-arm64/Moebius.app`、arm64 ZIP/DMG；包内主程序与 `MoebiusPermissionBridge.app` 均为 arm64 且 deep/strict 签名校验通过。按用户要求未公证，electron-builder 明确输出 notarization skipped；未执行 push、merge 或发布，未修改 `moebius-release-moebius` skill。

### 5.2 测试报告

证据与长日志均在系统临时目录，未写入仓库 `artifacts/`。

| 命令 | 实际结果 |
| --- | --- |
| `env -u ELECTRON_RUN_AS_NODE pnpm test` | 退出码 0；root 151 文件通过/1 跳过、1073 测试通过/5 跳过（189.85s）；root slow 1/1、68/68（37.87s）；desktop 180/180、929/929（77.67s）；console-ui 72/72、722/722（25.78s）。日志：`/tmp/electron43-upgrade-full-test-final.log`。 |
| `env -u ELECTRON_RUN_AS_NODE pnpm run test --scope` | 退出码 0；边界检查 860 source/701 production/3 roots；根 11/11、desktop 99/99 受影响测试通过。 |
| `env -u ELECTRON_RUN_AS_NODE pnpm typecheck` | 退出码 0；root、desktop、console-ui typecheck 均完成。 |
| `env -u ELECTRON_RUN_AS_NODE pnpm --filter @moebius/desktop dist` | 退出码 0；Electron 43.4.1、macOS arm64、签名 ZIP/DMG 与 `.app` 产出。日志：`/tmp/electron43-upgrade-final-dist.log`。 |
| `env -u ELECTRON_RUN_AS_NODE desktop/release/mac-arm64/Moebius.app/Contents/Resources/native/MoebiusPermissionBridge.app/Contents/MacOS/macos-notification-permission status` | 退出码 0；`{"authorizationStatus":"authorized","alert":"enabled","sound":"enabled","badge":"enabled"}`。 |
| 真实签名包页面发送 Codex 任务并查询 `Notification.getHistory()` | 真机任务终局、授权 `authorized`、通道 `ok`、稳定 ID 映射和运行期间 history 对象均实际观察到；证据：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/electron43-task-only-evidence-8vPY4V/task-evidence.json`。 |

相对步骤 1 基线：root 非 slow 计数保持 151/1073 通过、1/5 跳过；desktop 从 176 个通过文件、1 个失败文件及 917/918 测试变为 180/180 文件、929/929 测试，新增 3 个测试文件、11 个测试；console-ui 本次完成此前未执行的 72/72 文件、722/722 测试。步骤 1 的 `shell-path.test.ts` 超时本次未复现。

### 5.3 「与需求差异清单」终稿

- 没有主动增删或改写需求条目、验收标准或用户可见语义；`Electron 43.x`、系统通知、前后台点击和退出后历史通知回流均保持原需求表述。
- **实现与真机观察不一致**：运行期间真实通知可提交、可由 `getHistory()` 读取，但正常 `app.quit()` 后立即重启，`Notification.getHistory()` 返回空数组；因此“明确退出后点击通知中心历史通知冷启动定位”当前未满足。该项不是需求回退，而是 Electron 43.4.1/macOS 26 公开通知对象生命周期的实测限制。
- **未形成可观察回流**：前台和后台横幅均由 `usernoted` 日志确认呈现，但本机原生点击后没有观察到目标会话切换；前台路径还受 Electron #51885 已知问题影响。由于系统截图/OCR不能独立绑定到当前 banner，不把坐标尝试伪报成点击通过。

### 5.4 「建议回退需求的问题」清单

- **【需求层】退出后历史回流**：Electron 43.4.1 的公开 API spike 已验证：新建通知在正常退出时会随非 restored 对象析构而从 delivered notifications 移除；`getHistory()` 重挂、保留对象、重发同 ID 后仍不能跨 `app.quit()` 保留。请用户决定是否接受“优雅退出后不承诺通知中心回流”，或批准超出当前范围的 Electron fork/独立原生通知发送通道。
- **【需求层】前台横幅点击**：Electron #51885 的上游行为是前台 banner 点击可能只消失、不发出 `click`；请用户决定是否接受已知平台限制，或另立需求设计前台替代入口/升级到能解决该问题的版本。当前实现不擅自改变“点击横幅必须回流”的语义。

### 5.5 「有意偏离清单」汇总

- `desktop/tests/desktop-local-console-runtime.test.ts`：移除重复 `skillRegistry` 字段；步骤 1 基线 typecheck 实际报 TS1117，必须消除重复对象键才能通过现有 TypeScript 门禁。【实现层】
- `desktop/src/notification-channel.ts`：构造函数增加可选 `platform` 注入；为非 macOS history 恢复提供确定性短路测试，不改变生产默认 `process.platform` 行为。【实现层】
- `tests/managed-process-wrapper.test.ts`：在等待 marker 前注册 wrapper `close` Promise；Electron 43 变更后的实际执行时序会先 close，原测试因此 20s 超时，修复测试竞态而非生产行为。【实现层】

### 5.6 遗留事项终稿与对账清单

#### 真机四段记录

1. `environment: 真机`；入口：最终签名包 → 已有隔离项目会话 → 消息输入框；操作：发送真实 Codex 任务；屏幕/系统观察：task state 为 `authorized + channelStatus=ok`，持久化存在稳定 ID 到目标会话映射，`Notification.getHistory()` 返回 `title=Moebius` 的任务提醒；与承诺一致否：**是（通知提交/历史读取前置）**。
2. `environment: 真机`；入口：目标会话完成 → 新建对话；操作：应用前台时对系统横幅执行一次原生点击尝试；屏幕/系统观察：`usernoted` 记录该通知以 banner 呈现，但页面未观察到回到目标会话；与承诺一致否：**未验证/不一致，受 #51885 与点击坐标不可独立绑定影响**。证据：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/electron43-banner-evidence-Eke4E1/banner-evidence.json`。
3. `environment: 真机`；入口：目标会话完成 → 切换到其他会话 → 隐藏 Moebius；操作：应用后台时对系统横幅执行一次原生点击尝试；屏幕/系统观察：`usernoted` 记录 banner 呈现；点击后应用仍隐藏且页面仍为其他会话，未形成可观察回流；与承诺一致否：**未验证/不一致**。证据：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/electron43-background-evidence-lSXAKD/background-evidence.json`。
4. `environment: 真机`；入口：真实签名包任务完成 → 正常 `app.quit()` → 立即重启；操作：退出前 history 含当前通知，重启后再次查询 `Notification.getHistory()`；屏幕/系统观察：退出前有当前 ID，重启后为 `[]`；与承诺一致否：**否**。证据：`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/electron43-cold-history-evidence-ojhW6P/cold-history.json`。

#### 对账

- 验收标准落位自查：**通过**。M1 Electron 43/39–43 复核、M2 稳定 ID/历史 wiring、M3 授权 API 调研与 bridge 保留均有实现和自动测试；每条真实用户验收标准均已找到实现/测试覆盖，或在上方差异与遗留清单中明确登记其未验证/不一致原因。该“落位通过”不等同于真实用户动作全部通过。
- `boundary-matrix.md` 的 M1–M3 × 五类异常情形无空白。
- 当前**不具备“验收通过”结论**：系统通知真实提交前置已通过；系统设置列表、前台/后台横幅回流、退出后历史冷启动定位仍未通过用户验收。
- 遗留 predecessor：`terminal-notification-delivery` 仍有真实 GUI 验收和归档工作；本 change 不把 predecessor 的历史证据改写为本 change 的通过证据。
- 外发状态：只停留在工作区/本地分支；用户未验收前不 push、merge、发布。

#### 遗留事项三类确认

- 不采纳的评审提醒：**无**。截至本交付记录，评审提醒均已采纳并处理；没有留下未采纳项。
- 方案中标记“无本项目依据，仅为惯例”的条目：**无**。步骤 2 已声明无方向性风险；没有待补做的惯例选型或风险判定。
- 待核实项：**无**。本 change 的来源类事实均已由仓库证据、Electron 43.4.1 本地 API/源码或实际命令核对；运行类未完成项统一列为“未验证”，不混用“待核实”。
- 未验证项：正式签名包在系统设置通知列表中的可见登记；前台横幅点击回流；后台横幅点击回流；已授权环境下从页面触发正式 bridge request 的系统设置交互；这些均有真机记录或失败边界，尚未形成通过证据。
- 已验证但不一致项：正常 `app.quit()` 后立即重启的 `Notification.getHistory()` 为空，退出后历史通知冷启动定位未满足需求；原因与公开 API/源码行为已在 5.3–5.4 登记。
