# 0002. dev 期为 Electron 打开 Chromium 远程调试端口

## 状态
accepted

## 背景
桌面壳 Electron（见 [0001](0001-desktop-shell-electron.md)）在 dev 期对 AI agent 不友好：GUI 窗口只能截屏或系统级自动化硬驱，主进程与渲染进程日志分裂，且已知隐藏标签页会冻结 WAAPI 使动画验证失真。项目已在使用基于 CDP 的浏览器调试 MCP，AI agent 已具备通过 Chrome DevTools Protocol 观察 Chromium 的心智基础。

关键事实：

- `desktop/src/main.ts` 现有 IPC 面很小（7 个 handler + 1 个 status push），preload 只暴露 `window.moebius` 一个面。
- 已有 ADR-0001 承诺主进程为 Node 运行时，业务逻辑与桌面壳解耦仍未完成。
- 生态里有多个专用 Electron MCP server 可选：Playwright 派（`electron-driver` / `playwright-mcp-electron`）要求 MCP 自己 `start_app`，无法 attach 用户手动启动的窗口；CDP 派（`@laststance/electron-mcp-server`）走 `--remote-debugging-port` 端口 attach 已运行进程。
- 用户实际调试场景是「自己 `pnpm desktop` 起窗口 + AI 陪调同一个窗口」，与 Playwright 派的会话所有权模型硬冲突。
- 更长期方向是 renderer 独立 vite / backend 独立 Node 的分体调试架构，但改造预算超「最小验证」范围，本 ADR 不落地。

## 决策
在 dev-only 条件下（`!app.isPackaged`）为 Electron 打开 Chromium 远程调试端口 `9222`，允许 AI agent 通过 CDP 走 `@laststance/electron-mcp-server` attach 已运行的 desktop 进程。具体：

- `desktop/src/main.ts` 在 `app.whenReady()` 之前调用 `app.commandLine.appendSwitch("remote-debugging-port", "9222")`，`isPackaged` 判断保证打包版本永不开放端口。
- 项目根新增 `.mcp.json` 注册 `electron` MCP server，指向 `@laststance/electron-mcp-server`。
- AGENTS.md 补一段说明 9222 端口用途与冲突排查。

被否决的备选：

- **A. renderer / backend 分体调试**：是长期理想终态，本次成本超预算；ADR 承认为未来方向，不作废。
- **B. Playwright 拥有会话**（`electron-driver`）：MCP 必须 `start_app` 自己起 Electron，不能 attach 用户手动跑的窗口，与陪调场景硬冲突。
- **C. 保持现状**（截屏 + 系统自动化）：主进程完全黑盒，不可持续。
- **D. 自建 CDP harness**（`webContents.debugger.attach()` 编程接入）：灵活但要自建整套 tool surface，生态里已有成熟方案，暂无必要。

## 后果
- AI agent 能同时读主进程 / 渲染进程 / console 三路日志，并可 eval 主进程与渲染进程；心智与已有 CDP 浏览器 MCP 一致，工具面板可复用。
- IPC 面、preload、`console-ui`、`runner-supervisor` 均零改动；回退代价 = 删 3 行代码 + 2 个配置文件。
- 引入外部 npm 依赖 `@laststance/electron-mcp-server`；需观察其维护活跃度，停滞时可切备选 D。
- dev 环境 9222 端口通过 loopback 暴露；风险面为本机其他进程可 CDP 控制 desktop 窗口。缓解：`isPackaged` 判断确保仅 dev 生效，且 Chromium 默认只绑 localhost。
- 端口冲突（9222 被 Chrome debugger 或其他 CDP 工具占用）会导致 `pnpm desktop` 启动失败；AGENTS.md 补排查说明。
- 分体调试架构（renderer / backend 独立）仍是长期方向，若本方案证明「AI 陪调」有价值，后续新起 ADR 承接。

## 补录（2026-07-11）

> 本节为附加材料，不改写上面已 accepted 的「决策」与「后果」原文，仅补充实证与横向对比。

### 实测证据

用裸 CDP 直连（不经 `@laststance/electron-mcp-server`）对已运行的 `pnpm desktop` 主窗口逐项验证，7 项全通：

- **Attach**：从 `http://localhost:9222/json` 找到 target（`page | moebius | file:///.../console-page/index.html`）并挂 WebSocket。
- **Runtime.evaluate**：一次读回 URL / UA（`Electron/38.8.6 Chrome/140`）/ React 根挂载 = true / DOM 节点数 / `window.moebius` bridge 类型，全部正常。
- **Preload 桥面枚举**：`Object.keys(window.moebius)` 一句返回 `onStatus, getLocalConsoleUrl, openObserver, openStatusPage, openDataRoot, checkUpdates, selectProjectFolder`——把 preload 契约反查出来，agent 不用去翻源码。
- **Console 抓取**：`Runtime.consoleAPICalled` 订阅到 4 条（含 React DevTools 提示与 Electron CSP 警告），renderer 里 fire 的 `console.log('CDP-DEMO ...')` 也在其中。
- **Network 抓取**：renderer 里 fire 的 `fetch('/does-not-exist-...')`，`Network.requestWillBeSent` 立刻收到 GET，method / URL / type 全在。
- **截屏**：`Page.captureScreenshot` 拿到 77 KB PNG，界面（Projects / runner 运行中 / 默认会话 / composer）正常渲染。
- **点击面枚举**：`querySelectorAll('button,[role=button],a')` 一次抓 7 个可点元素（moebius 项目、默认会话、诊断、发送 等）。

### 实证边界：当前只覆盖渲染进程一路

实测下，本 ADR 的 CDP 通道只暴露 Chromium 渲染层的 target；「后果」段第 1 条一并提到的「主进程」一路并未随 9222 端口打开——`main.ts` 里的 local console 启动、`ipcMain.handle` 里发生的事和 `status` 对象内部状态都在 CDP 9222 视野外。属于本 ADR 未落地的边界，补齐两条路：

- **A**：dev-only 追加 `commandLine.appendSwitch("inspect", "9229")`（V8 inspector 另一个端口），再配 node-inspector 系 MCP。改动量 ≈ 3 行代码 + 1 段文档。
- **B**：走本 ADR「被否决」段落里的选项 D（`webContents.debugger.attach()` 自建 harness），换代价换灵活。

短期建议 A；本 ADR 不做，待需求出现后新起 ADR 承接。

### 横向对比：Codex Chrome 扩展 vs 本方案

底层协议同源（都是 CDP），目标物和风险面不同。此节用于回答未来同事「为何不等某个官方方案」：

| 维度 | Codex Chrome 扩展 | 本方案（CDP → Electron） |
| --- | --- | --- |
| 目的 | 让 AI 在用户日常 Chrome 里操作**真实业务系统**（LinkedIn / Gmail / Salesforce / 内网） | 让 AI 在 dev 期陪调**我们自己的桌面应用**窗口 |
| 底层协议 | CDP（官方描述「调用 DevTools」，即 `chrome.debugger` API） | CDP（`--remote-debugging-port=9222`） |
| 会话获取 | Attach 用户**已登录**的真实 Chrome 会话 | Attach 用户 `pnpm desktop` 起的桌面窗口 |
| DOM 读 / eval / console / network / 截屏 | 全支持 | 全支持（见上文实测） |
| 多标签页 | 支持，用「标签组」隔离任务 | 不适用（我们是单窗口 desktop） |
| 主进程 / 后端可见性 | 不适用（浏览器扩展本无这一层） | 目前未覆盖，需另开 `--inspect=9229`（勘误已述） |
| 提示词注入风险 | **高**——官方明确警告「网页内容不可信」，逐域名首次审批 | **低**——`file://` + 127.0.0.1 loopback，源可控 |
| 平台限制 | Chrome 本体（Arc / Brave / Edge 不支持）；上线时不含欧盟、英国 | 我们的 Electron 壳；无地区限制 |
| 分发状态 | 2026-05-07 正式版，挂 Chrome Web Store 名为 "ChatGPT"（`hehggadaopoacecdllhhajmbjkdcmajg`）；需先装 Codex 桌面应用 | dev-only 工程开关，随本 ADR 合入 main |

**结论**：协议同源、能力等价；差异在**目标物**（陌生业务系统 vs 我们自己的应用）与**风险面**（提示词注入 vs loopback 环境）。Codex 扩展比本方案「多」的（多标签页、真实登录态）对 desktop dev 场景本就无意义；本方案比 Codex「少」的（主进程一路）它自身也没有，`--inspect` 就能补齐。

来源：

- Codex 官方扩展文档：<https://developers.openai.com/codex/app/chrome-extension>
- 权限清单与商店条目：<https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg>
- 使用与限制说明：<https://learn.chatgpt.com/docs/chrome-extension>
- TechCrunch 佐证（2026-05-14）：<https://techcrunch.com/2026/05/14/openai-says-codex-is-coming-to-your-phone/>
