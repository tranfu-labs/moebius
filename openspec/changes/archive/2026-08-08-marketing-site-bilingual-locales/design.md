# 设计：marketing-site-bilingual-locales

## 方案

### 语言路由：两份静态页，不做运行时翻译

发布目录结构：

```text
sites/marketeam/
├── index.html          # 英文，站点根路径 /
├── zh/index.html       # 中文，/zh/
└── assets/             # 两页共用；仅产品预览截图分语言
```

两页各自把本语言正文**直接写在 HTML 里**，不用 `data-i18n` + 字典在运行时替换。
理由：官网首要职责是被搜索引擎和分享卡片读到，JS 替换出来的文案在无脚本抓取下是空的
或全是另一语言；而且首屏文案本来就要配同语言截图，运行时替换救不了图片。代价是两份
文件的结构会重复，靠「改动必须同时落到两页」的约定和上线检查兜住。

中文页放在 `zh/` 子目录而不是 `index.zh.html`，是为了拿到干净的 `/zh/` 路径，
且不依赖任何静态托管平台的 rewrite 配置。

页内资源引用一律用相对路径：英文页 `./assets/x.png`，中文页 `../assets/x.png`。
访客命中 `/zh`（无尾斜杠）时浏览器把 `..` 夹在根部，`../assets/x.png` 仍解析为
`/assets/x.png`，因此不需要托管方强制补尾斜杠。

### 语言切换控件

页头右上角用原生 `<details>` + `<summary>`：无 JavaScript 时就是一个可展开的链接列表，
键盘可达，不需要自己实现 roving focus。JS 只加两件锦上添花的事——点击面板外关闭、
按 Esc 关闭。当前语言项标 `aria-current="true"`。

菜单项是真链接，不是脚本跳转：

| 当前页 | English | 简体中文 |
| --- | --- | --- |
| `/` | `./?lang=en` | `./zh/?lang=zh` |
| `/zh/` | `../?lang=en` | `./?lang=zh` |

### 语言推断与记忆

`?lang=` 是「显式选择」的唯一信号，只可能来自语言切换控件。两页 `<head>` 内联一段
同步脚本（在渲染前执行，避免闪一下再跳）：

1. 有 `?lang=en|zh`：写入 `localStorage['moebius-site-lang']`，用 `history.replaceState`
   把查询串从地址栏抹掉，需要换页时 `location.replace` 过去。
2. 无 `?lang=`，且在**根路径**：读记忆值；没有记忆值才看 `navigator.language`。
   结论为 `zh` 时 `location.replace('./zh/')`。
3. 无 `?lang=`，且在 `/zh/`：什么都不做。

`/zh/` 单向不反跳是刻意的：分享出去的中文链接对任何浏览器都必须打开中文页，
否则英文浏览器的用户点开中文同事发来的链接会被弹回英文页，链接语义就丢了。
用 `location.replace` 而不是赋值 `location.href`，让浏览器「后退」回到来源页
而不是在两页之间弹跳。

推断只在**没有记忆值**时发生，所以显式选择永远压过浏览器语言。

### 语言标注

两页互相声明 `<link rel="alternate" hreflang>`，并把 `x-default` 指向英文根路径。
自动跳转是纯 JS，抓取器拿到的仍是各自语言的完整 HTML，两个语言版本都能被索引。
`hreflang` 用根绝对路径（`/`、`/zh/`），与 `DEPLOY.md` 里「发布目录即站点根」的前提一致。

### 英文产品预览截图

`assets/preview-center-en.png`（2880×2000）由已退役的 console-ui 设计参考页
`dashboard.html` 的 `#state=readme-en` 确定状态渲染而来——那个状态本来就是
`97a5a218` 为英文 README 截图建的静态 DOM，与中文交互演示隔离。渲染用仓库自带的
playwright，1440×1000、`deviceScaleFactor=2`。

复现配方和一份小补丁记在 `docs/design-explorations/marketing-site/preview-center-en/`，
不把退役文件搬回仓库。补丁只做一件事：让英文状态也渲染消息目录轨，并让轨道颜色读取
消息上已渲染的 `tone-N` 而不是对成员名做哈希（英文名哈希出的色号和头像对不上）。

### 文字入场动效的分词

首屏与分节标题的逐词入场依赖 `Intl.Segmenter('zh')` 按字/词切分。英文照搬会把词之间的
空格 `trim` 掉，整句黏成一坨。改成按 `document.documentElement.lang` 分支：中文走原
segmenter，英文按空白切分并把空白作为纯文本节点保留在 `inline-block` 词之间。

### 顺带修复页头窄屏溢出

页头再加一个控件后，390px 下必然更挤。按 `sites/marketeam/AGENTS.md` 里已记录、
但正式页一直没带回的修复：窄屏隐藏 GitHub 幽灵链接、按钮 `white-space:nowrap`、
首屏按钮组允许折行；语言控件在窄屏收成图标态。

## 权衡

**两份静态页 vs 单页运行时字典。** 选了前者，放弃了「文案只写一遍」。字典方案能消除结构
重复，但首屏文案会在无脚本抓取下缺失，分享卡片和搜索结果都拿不到本地化标题，而这正是
官网存在的理由。重复的成本用上线检查清单和一条「两页同改」的目录约定兜。

**`zh/` 子目录 vs `index.zh.html` vs 服务端协商。** 服务端协商最贴合 HTTP 语义，但
`marketing-site` 明确不引入服务端进程，直接出局。`index.zh.html` 不需要建目录，但
路径是 `/index.zh.html`，分享出去很难看，也不符合「`/zh` 为中文页」的要求。

**JS 跳转 vs 托管平台重定向规则。** 平台重定向能避免 JS 闪烁，但会把语言策略绑到某个
具体托管商的配置文件上，而部署平台尚未最终确定；且平台级 `Accept-Language` 重定向对
搜索引擎不友好。内联同步脚本 + `location.replace` 在渲染前完成，实际不闪。

**记忆用 localStorage vs cookie。** cookie 能被将来的服务端读到，但当前没有服务端，
cookie 只会多一层同意横幅的风险面。localStorage 够用，且 `marketing-site` 不做任何
邮箱收集或追踪。

## 风险

- **两页漂移。** 只改一页会让另一语言的访客看到旧内容。缓解：`DEPLOY.md` 上线检查逐项
  对两个路径各查一遍；`sites/marketeam/AGENTS.md` 写明两页必须同改。
- **`localStorage` 不可用**（隐私模式、被禁用）。整段推断逻辑包在 `try/catch` 里，
  失败时退化为「每次按浏览器语言推断」，不会白屏也不会死循环。
- **跳转环路。** 只有根路径会跳、且只跳向 `/zh/`，`/zh/` 永不跳回，结构上不存在环路。
- **回滚。** 恢复上一稳定提交的 `sites/marketeam/` 整个目录即可；没有服务端状态或数据迁移。
