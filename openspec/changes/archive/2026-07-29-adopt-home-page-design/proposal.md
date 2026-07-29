# 提案：adopt-home-page-design

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/home-page.md` | 全文 | 根据用户指定的 `packages/console-ui/design-refs/home-page.html` 建立官网首页产品事实，并确认 GitHub 与下载去向 | 已写入 |

用户于 2026-07-29 明确指定把该 UI HTML 提升为真正首页，并提供公开仓库 `tranfu-labs/moebius`；原产品文档没有官网页面 PRD，本次补齐至上述落点。

## 背景

当前生产首页仍是较早的 Relay Atlas 版本，指定的新 UI 仅保存在组件包的设计参考目录，且下载、源码和更新日志仍是占位链接。

## 提案

将指定 HTML 提升为 `sites/marketeam/index.html`，同步其产品预览资源；接入公开 GitHub 仓库、Releases 与 Apple Silicon DMG 下载解析，并保留 Releases 页面作为可靠后备。

## 影响

影响公开官网的视觉、叙事结构、生产静态资源、链接行为、营销站规格与品牌测试；不影响 Electron、console-ui 生产组件或运行时。
