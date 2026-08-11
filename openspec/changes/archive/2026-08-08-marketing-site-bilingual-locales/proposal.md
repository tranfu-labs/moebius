# 提案：marketing-site-bilingual-locales

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/home-page.md` | 页面目标 | 首页面向全球访客，英文是默认语言，中文是并列的完整语言版本 | 已写入 |
| `docs/product/pages/home-page.md` | 入口与去向 | 新增 `/` 与 `/zh/` 两条语言路由及其相互去向 | 已写入 |
| `docs/product/pages/home-page.md` | 区域与信息 | 页头新增语言切换控件；产品预览按语言取用同语言截图 | 已写入 |
| `docs/product/pages/home-page.md` | 操作与反馈 | 语言切换、浏览器语言首访推断、语言选择记忆的行为 | 已写入 |
| `docs/product/pages/home-page.md` | 页面状态 | 新增语言状态：默认英文、推断为中文、显式选定语言 | 已写入 |
| `docs/product/pages/home-page.md` | 指标与验收 | 两个语言版本各自完整可读，且不出现另一语言的残留 | 已写入 |
| `docs/product/pages/home-page.md` | 非目标 | 明确不做英中之外的语言、不做服务端语言协商 | 已写入 |

## 背景

官网当前只有一份中文页面（`sites/marketeam/index.html`，`<html lang="zh-CN">`），从
标题、正文、导航到首屏产品预览截图全部是中文。产品本身面向的是「全世界享用 AI 提效的
普通专业者」，README 早已是英文优先（`README.md` 英文 + `README.zh-CN.md` 中文），
官网却把非中文访客挡在门外：他们看不懂主张，也读不懂截图里的产品界面。

同时，页头在 390px 宽度下下载按钮会换行溢出——这是 `sites/marketeam/AGENTS.md`
在品牌叙事样张中已记录、但正式页尚未修复的缺陷。本次要往页头再加一个语言切换控件，
必须一并带回该修复，否则窄屏页头会更挤。

## 提案

把官网从「单一中文页」改为「英文默认 + 中文并列」的双语言静态站：

- `sites/marketeam/index.html` 改为英文规范页，`<html lang="en">`，是站点根路径与默认语言。
- 新增 `sites/marketeam/zh/index.html` 作为中文页，路径 `/zh/`，内容与英文页一一对应。
- 两页页头右上角提供语言切换控件，`<details>` 实现，无 JavaScript 也可用、可键盘操作。
- 根路径首访时按浏览器语言推断：`navigator.language` 为中文则替换跳转到 `/zh/`。
  访客一旦显式选过语言就记住选择，不再按浏览器语言推断；`/zh/` 不做反向自动跳转，
  分享出去的中文链接始终打开中文页。
- 新增英文首屏产品预览截图 `assets/preview-center-en.png`，英文页使用它，中文页继续用
  `assets/preview-center.png`；两张图来自同一渲染源的两个语言状态，复现方式记在
  `docs/design-explorations/marketing-site/preview-center-en/`。
- 顺带修复页头 390px 溢出。

## 影响

- 业务域：`marketing-site`。运行时（runner / Electron / console-ui / SQLite）零影响。
- 部署：发布目录仍是 `sites/marketeam/`，但产物从单文件变为「根页 + `zh/` 子目录」，
  `DEPLOY.md` 的发布输入、上线检查与「当前不包含」需要同步。
- 事实源：`openspec/specs/marketing-site/spec.md` 的「唯一页面与部署」不再成立，
  由 spec-delta 替换为双语言路由规则。
- 对外行为：中文访客的落点从 `/` 变成 `/zh/`；此前分享出去的 `/` 链接对中文浏览器
  仍会落到中文内容，不会出现语言倒退。
