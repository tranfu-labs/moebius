# 任务：marketing-site-bilingual-locales

- [x] 生成英文首屏产品预览 `sites/marketeam/assets/preview-center-en.png`，并把复现配方与补丁落到 `docs/design-explorations/marketing-site/preview-center-en/`
- [x] 把 `sites/marketeam/index.html` 改写为英文规范页（`lang="en"`、head 元信息、全文文案、英文截图）
- [x] 新建 `sites/marketeam/zh/index.html`：中文内容与英文页一一对应，资源引用改为 `../assets/`
- [x] 两页页头加语言切换控件（`<details>`、无 JS 可用、键盘可达、当前项 `aria-current`）
- [x] 两页 `<head>` 加同步语言脚本：`?lang=` 显式选择写入记忆并清理地址栏；根路径按记忆或浏览器语言跳 `/zh/`；`/zh/` 不反跳
- [x] 两页互加 `hreflang` alternate 与 `x-default`
- [x] 逐词入场动效按 `lang` 分支：英文按空白切分并保留词间空格
- [x] 带回页头 390px 溢出修复（窄屏隐藏 GitHub 幽灵链接、按钮禁换行、首屏按钮组允许折行、语言控件收成图标态）
- [x] 真实浏览器验收：默认英文、中文浏览器跳 `/zh/`、切换双向可用且被记住、375px 无横滚、下载链接可降级、静态资源 200、无控制台错误
- [x] 把验收固化为 `scripts/acceptance/marketing-site-locales.ts` 并登记进根 `AGENTS.md` 命令表
- [x] 同步 `sites/marketeam/DEPLOY.md`（发布输入、本地预览、上线检查、当前不包含）与 `sites/marketeam/AGENTS.md`（两页同改约定）
