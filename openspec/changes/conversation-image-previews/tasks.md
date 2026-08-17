# 任务：conversation-image-previews

- [ ] 安装依赖后先运行目标 Electron/Chromium SVG 图片上下文探针，验证脚本不执行、外部资源零请求、Canvas 可输出 PNG、超大尺寸有界；任一项不满足时暂停实现并修订 `design.md`。
- [ ] 为 PNG/JPEG/GIF/WebP/SVG 图片源判定、SVG 普通文件降级、provider `imagePaths` 排除 SVG 和两档派生预算补纯 domain 测试。
- [ ] 扩展托管附件 staging/finalize 协议，保存时间线缩略图与大图派生 PNG，并让无法安全预览的 SVG 原子降级为普通文件。
- [ ] 增加带桌面 capability 的会话级本地图片预览端点，复用 realpath/普通文件/工作空间与外部文件引用边界，拒绝伪装格式、超限与非图片内容。
- [ ] 让 desktop 复用同一浏览器解码管线处理用户附件与 Agent 图片引用，实现有界并发、取消、迟到响应隔离和 object URL 释放。
- [ ] 在 `console-ui` 实现受控图片预览与大图 Dialog，接入用户消息和 Agent 消息，补齐中英文文案、键盘、焦点恢复、窄窗口和 reduced-motion 行为。
- [ ] 按新增组件模式更新 `packages/console-ui/DESIGN.md`；新增生产文件时同步四层 registry 与必要边界登记。
- [ ] 增加 local-console、desktop、console-ui 的行为测试，覆盖安全 SVG、恶意/不可解码 SVG、栅格图片、GIF 静态预览、多图顺序、文件变化、错误降级、重试、会话切换与 URL 清理。
- [ ] 新增或扩展真实 Electron 验收，从用户入口分别发送 PNG/SVG、查看 Agent 引用的工作空间内与外部图片、打开和关闭大图、验证失败降级；证据写系统临时目录。
- [ ] 复核后运行 `pnpm run test --scope [基线]`、`pnpm typecheck`、desktop build、Storybook 门禁与 `pnpm check:boundaries`；完整 `pnpm test` 只在最终复核之后、合并之前运行一次。
