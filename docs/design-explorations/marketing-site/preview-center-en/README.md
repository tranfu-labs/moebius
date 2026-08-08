# 英文首屏产品预览的复现方式

`sites/marketeam/assets/preview-center-en.png`（2880×2000）是英文官网首屏的桌面端产品预览。
它不是手工拼图，而是把已退役的 console-ui 设计参考页渲染成截图；本目录只保留复现配方，
不把那两份文件重新搬回仓库（`2026-08-06-retire-console-ui-design-refs` 已明确退役它们）。

渲染源是 `packages/console-ui/design-refs/dashboard.html` 的 `#state=readme-en` 确定状态——
它在 `97a5a218` 就是为英文截图而建的独立静态状态，与中文交互演示隔离，
因此不依赖运行时逐字翻译。中文首屏预览 `preview-center.png` 来自同一页面的中文会话状态，
两者共用同一套设计令牌。

## 复现步骤

从仓库根目录：

```bash
D=$(mktemp -d)
git show 54c100e^:packages/console-ui/design-refs/dashboard.html > "$D/dashboard.html"
git show 54c100e^:packages/console-ui/design-refs/app.css > "$D/app.css"
patch -p1 -d "$D" < docs/design-explorations/marketing-site/preview-center-en/dashboard-readme-en-rail.patch
python3 -m http.server 4199 --directory "$D"
```

然后用 Chromium 以 `1440×1000`、`deviceScaleFactor=2`、深色配色打开
`http://127.0.0.1:4199/dashboard.html#state=readme-en`，等页面稳定后整屏截图，
输出即 `preview-center-en.png`。仓库自带 `playwright`，可直接用它驱动 Chromium。

## 补丁做了什么

`dashboard-readme-en-rail.patch` 只补一件事：让英文状态也显示消息目录轨（relay rail）。
原始的 `#state=readme-en` 是一段独立的静态 DOM，没有接上目录轨渲染，
因此英文截图会缺掉这条产品签名视觉，与中文预览不一致。补丁三处改动：

- 切到 `readme-en` 时把 `#relay-viewport` 移进英文状态的会话区并触发渲染。
- `refreshRelay()` 认得 `#readme-en-state .timeline`。
- 目录轨颜色改为读取消息上已渲染的 `role-tag tone-N`，而不是对成员名做 FNV 哈希——
  英文成员名哈希出的色号与头像色对不上，中文名恰好对得上。

补丁只服务截图复现，不代表 console-ui 的现行行为。
