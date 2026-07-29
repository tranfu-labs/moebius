# 官网部署

当前官网只有一个静态页面：[`index.html`](./index.html)。CSS 和 JavaScript 均已内联，品牌图标与页面图片由同目录的 `assets/` 提供；不需要安装依赖、执行构建或启动 Node.js 服务。

## 部署输入

| 配置项 | 值 |
| --- | --- |
| 站点类型 | 静态站点 / Static site |
| 项目根目录 | 仓库根目录 |
| 构建命令 | 留空 |
| 发布目录 | `sites/marketeam` |
| 首页 | `index.html` |
| SPA fallback / rewrite | 不需要 |
| 环境变量与密钥 | 不需要 |

部署时只发布 `sites/marketeam/`。不要把仓库根目录或 `docs/marketing-site/` 设为发布目录；后者包含设计资料和已明确废弃的历史产物，不属于线上内容。

## 本地预览

从仓库根目录执行：

```bash
python3 -m http.server 4173 --directory sites/marketeam
```

然后打开 <http://127.0.0.1:4173/>。不要只用 `file://` 双击作为上线验收，因为 HTTP 预览更接近静态托管环境，也更容易发现资源与控制台错误。

## 外部运行依赖

页面本体自包含，但浏览器会访问以下公共资源：

- Google Fonts：Inter、Inter Tight
- GitHub Releases API：把下载按钮升级为最新稳定版 `-mac-arm64.dmg` 直链
- GitHub 仓库、Releases、Issues 与开源许可链接

Google Fonts 不可用时字体会回退到系统字体。GitHub API 不可用或达到限额时，下载按钮会保留 `releases/latest` 后备地址。若部署环境设置了 Content Security Policy，需要允许 Google Fonts 与 GitHub API 来源，否则必须保持上述降级可用。

## 上线前检查

1. 确认部署产物包含当前目录中的 `index.html`、本说明文件和 `assets/`，没有复制 `docs/marketing-site/archive/`。
2. 用本地 HTTP 服务打开页面，分别检查桌面宽屏和约 375px 移动端。
3. 点击页头的“团队 / 对话 / 分析”，确认锚点都能到达对应板块；点击 GitHub 与更新日志，确认指向 `tranfu-labs/moebius`。
4. 检查首屏、Leader Agent 宣言、团队/对话/分析三个能力段和最终行动完整。
5. 确认三个下载按钮至少指向 `releases/latest`；GitHub API 可用时应解析为最新的 `-mac-arm64.dmg` 直链。
6. 在浏览器 DevTools 中确认没有未预期的 JavaScript 错误、404 或页面横向滚动；页头 Logo、favicon、Apple Touch Icon、产品预览和宣言背景都应返回 `200`。
7. 开启系统“减少动态效果”后刷新，确认内容仍完整可读。
8. 在预发布 URL 上检查：

   ```bash
   curl -fsS https://<预发布域名>/ | grep -F '<title>'
   curl -fsSI https://<预发布域名>/
   curl -fsSI https://<预发布域名>/assets/moebius-icon-64.png
   curl -fsSI https://<预发布域名>/assets/favicon-32.png
   curl -fsSI https://<预发布域名>/assets/apple-touch-icon.png
   curl -fsSI https://<预发布域名>/assets/preview-center.png
   curl -fsSI https://<预发布域名>/assets/manifesto-ribbon.jpg
   ```

   首页应返回 `200`，响应类型应为 `text/html`。

## 缓存、HTTPS 与回滚

- 正式域名必须启用 HTTPS。
- `index.html` 建议使用可重新验证或较短的缓存策略，避免单文件更新后用户长期看到旧版。
- 品牌图标使用稳定文件名且没有内容哈希，建议与 `index.html` 一样使用可重新验证或较短的缓存策略，确保页面与图标同版更新。
- 回滚时恢复上一稳定提交中的 `sites/marketeam/index.html` 与 `sites/marketeam/assets/` 并重新部署同一发布目录；没有数据库迁移或服务端状态需要处理。

## 当前不包含

- 多页面路由
- SSR、API 或服务端进程
- npm/pnpm 构建步骤
- 注册、邮箱收集或环境密钥
- `docs/marketing-site/` 中的历史叙事、视觉资料和其他实验页面

部署平台一旦确定，只需在本文件补充该平台的项目设置或命令；不要再复制一份官网页面。
