# 官网部署

当前官网是两个语言版本的静态页面：[`index.html`](./index.html)（英文，站点根路径）与
[`zh/index.html`](./zh/index.html)（中文，`/zh/`）。两页各自内联 CSS 与 JavaScript，
共用同一份 `assets/`；不需要安装依赖、执行构建或启动 Node.js 服务。

英文是默认语言。根路径首访时按浏览器语言决定落点：判定为中文则替换跳转到 `/zh/`。
访客用页头语言控件显式选过语言后，该选择记在 `localStorage['moebius-site-lang']` 并优先于
浏览器语言；`/zh/` 不会因浏览器语言反跳英文页。跳转是页面内联 JS，不依赖托管平台的
重定向规则或 `Accept-Language` 协商。

## 部署输入

| 配置项 | 值 |
| --- | --- |
| 站点类型 | 静态站点 / Static site |
| 项目根目录 | 仓库根目录 |
| 构建命令 | 留空 |
| 发布目录 | `sites/marketeam` |
| 首页 | `index.html`（英文） |
| 语言子路径 | `zh/index.html` → `/zh/` |
| SPA fallback / rewrite | 不需要 |
| `Accept-Language` 重定向 | 不要开启，语言策略在页面内 |
| 环境变量与密钥 | 不需要 |

部署时只发布 `sites/marketeam/`。不要把仓库根目录或 `docs/marketing-site/` 设为发布目录；
后者包含设计资料和已明确废弃的历史产物，不属于线上内容。

`hreflang` 声明用的是根绝对路径（`/` 与 `/zh/`），因此发布目录必须挂在站点根上；
若将来改挂到子路径，需要同步这两页 `<head>` 里的 `hreflang`。

## 两页必须同改

英文页与中文页是同一份设计的两个语言版本，除了本语言文案、`lang`、`hreflang`、
语言控件的当前项、资源相对深度（`./assets/` vs `../assets/`）、首屏预览截图
（`preview-center-en.png` vs `preview-center.png`）和语言落点脚本以外，CSS 与主脚本
是逐字一致的。改任何一页都必须同步另一页，否则一种语言的访客会看到旧版本。

改完可以用下面两条确认结构没有漂移：

```bash
diff <(grep -o 'data-od-id="[^"]*"' sites/marketeam/index.html) <(grep -o 'data-od-id="[^"]*"' sites/marketeam/zh/index.html)
diff <(awk '/document.documentElement.classList.add/{p=1} p' sites/marketeam/index.html) <(awk '/document.documentElement.classList.add/{p=1} p' sites/marketeam/zh/index.html)
```

两条都应无输出。

## 本地预览

从仓库根目录执行：

```bash
python3 -m http.server 4173 --directory sites/marketeam
```

然后打开 <http://127.0.0.1:4173/>（英文）与 <http://127.0.0.1:4173/zh/>（中文）。
不要只用 `file://` 双击作为上线验收：`file://` 下语言跳转与相对路径的行为和静态托管不同，
HTTP 预览更接近真实环境，也更容易发现资源与控制台错误。

验证浏览器语言推断时，用浏览器的语言设置或无痕窗口，并先清掉
`localStorage['moebius-site-lang']`——否则读到的是上一次的显式选择。

## 外部运行依赖

页面本体自包含，但浏览器会访问以下公共资源：

- Google Fonts：Inter、Inter Tight
- GitHub Releases API：把下载按钮升级为最新稳定版 `-mac-arm64.dmg` 直链
- GitHub 仓库、Releases、Issues 与开源许可链接

Google Fonts 不可用时字体会回退到系统字体。GitHub API 不可用或达到限额时，下载按钮会保留
`releases/latest` 后备地址。若部署环境设置了 Content Security Policy，需要允许 Google Fonts
与 GitHub API 来源，否则必须保持上述降级可用。

## 上线前检查

1. 确认部署产物包含 `index.html`、`zh/index.html`、本说明文件和 `assets/`，
   没有复制 `docs/marketing-site/archive/`。
2. 跑一遍上面「两页必须同改」的两条 `diff`，确认无输出。
3. 用本地 HTTP 服务分别打开 `/` 与 `/zh/`，各自检查桌面宽屏和约 375px 移动端。
4. 语言落点：
   - 浏览器语言设为英文、清掉语言记忆后打开 `/`，应停在英文页。
   - 浏览器语言设为中文、清掉语言记忆后打开 `/`，应落到 `/zh/`。
   - 浏览器语言为英文时直接打开 `/zh/`，应停在中文页，不反跳。
   - 页头语言控件双向切换各一次，地址栏不应残留 `?lang=`，再次打开 `/` 应按刚才的选择落地。
   - 禁用 JavaScript 后，两页正文仍完整，语言控件仍能展开并切换。
5. 点击页头的“团队 / 对话 / 分析”（英文页为 Teams / Conversation / Analysis），
   确认锚点都能到达对应板块；点击 GitHub 与更新日志，确认指向 `tranfu-labs/moebius`。
6. 检查两页的首屏、Leader Agent 宣言、三个能力段和最终行动完整，且各自语言内没有另一种语言
   的残留——包括 `title`、`meta` 描述、社交分享文案、图片 `alt` 与首屏预览截图里的产品界面。
7. 确认每页三个下载按钮至少指向 `releases/latest`；GitHub API 可用时应解析为最新的
   `-mac-arm64.dmg` 直链。
8. 在浏览器 DevTools 中确认两页都没有未预期的 JavaScript 错误、404 或页面横向滚动；
   页头 Logo、favicon、Apple Touch Icon、两张产品预览和宣言背景都应返回 `200`。
9. 开启系统“减少动态效果”后刷新两页，确认内容仍完整可读。
10. 在预发布 URL 上检查：

    ```bash
    curl -fsS https://<预发布域名>/ | grep -F '<title>'
    curl -fsS https://<预发布域名>/zh/ | grep -F '<title>'
    curl -fsSI https://<预发布域名>/
    curl -fsSI https://<预发布域名>/zh/
    curl -fsSI https://<预发布域名>/assets/moebius-icon-64.png
    curl -fsSI https://<预发布域名>/assets/favicon-32.png
    curl -fsSI https://<预发布域名>/assets/apple-touch-icon.png
    curl -fsSI https://<预发布域名>/assets/preview-center-en.png
    curl -fsSI https://<预发布域名>/assets/preview-center.png
    curl -fsSI https://<预发布域名>/assets/manifesto-ribbon.jpg
    ```

    两个页面都应返回 `200`、响应类型 `text/html`，且各自 `<title>` 是本语言的。

## 缓存、HTTPS 与回滚

- 正式域名必须启用 HTTPS。
- 两个 `index.html` 都建议使用可重新验证或较短的缓存策略，避免单文件更新后用户长期看到旧版；
  两页应同版失效，否则会出现一种语言新、另一种语言旧。
- 品牌图标与产品预览使用稳定文件名且没有内容哈希，建议与 HTML 一样使用可重新验证或较短的
  缓存策略，确保页面与图片同版更新。
- 回滚时恢复上一稳定提交中的整个 `sites/marketeam/`（含 `zh/` 与 `assets/`）并重新部署同一
  发布目录；没有数据库迁移或服务端状态需要处理。

## 当前不包含

- 英文与简体中文之外的语言
- 服务端语言协商，或托管平台的 `Accept-Language` 重定向规则
- 语言子路径以外的多页面路由
- SSR、API 或服务端进程
- npm/pnpm 构建步骤
- 注册、邮箱收集或环境密钥
- `docs/marketing-site/` 中的历史叙事、视觉资料和其他实验页面

部署平台一旦确定，只需在本文件补充该平台的项目设置或命令；不要再复制一份官网页面。
