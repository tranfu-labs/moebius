# z-index 层级契约

本文件定义 Moebius 所有可执行、可渲染 UI 资产的层级语义。生产 UI 使用
`packages/console-ui/src/styles/tokens.css`，Tailwind 使用 `z-layer-*`；原型、
自包含站点以及可渲染的历史设计/归档 HTML 镜像同一套 token，不跨域导入生产实现。

## 层级范围

| 范围 | 语义 | 当前 token |
| --- | --- | --- |
| `-9..-1` | underlay，背景伪元素或底层装饰 | `layer-underlay` |
| `0` | base；没有明确层级时使用 `auto` | `layer-base` |
| `1..9` | local，组件内部局部层 | `layer-local-low/mid/high` |
| `10..19` | content，内容和 sticky 内容 | `layer-content` |
| `20..29` | rail、Ray、Relay | `layer-rail` |
| `30..39` | panel、composer、子会话 | `layer-panel` |
| `40..59` | 局部浮层和共享 floating surface | `layer-floating-local/floating` |
| `60..79` | drawer、sheet | `layer-drawer` |
| `80..99` | app chrome、toast、notice | `layer-app-chrome/app-notice` |
| `100..109` | modal backdrop 和 surface | `layer-modal-backdrop/modal` |
| `110..129` | system 层和嵌套 modal | `layer-system-backdrop/system/system-nested` |
| `130..199` | 预留，不分配给当前组件 | 无 |
| `>=200` | 禁止 | 无 |

已有数值必须按组件语义迁移，不允许把历史数字机械替换成同一个 token。一个
组件内若没有跨越其他应用层的需求，父级保持 `z-index: auto`。`transform`、
`opacity`、`filter`、`isolation`、`contain` 以及带 z-index 的定位元素建立的
stacking context 必须在代码评审和真实 UI 验收中检查。

`pnpm check:z-index` 是新增门禁。它扫描生产 UI、原型、站点和可渲染历史 HTML，
拒绝裸数字 Tailwind class、裸数字 CSS/JS z-index、未知 layer token 和越界值。
