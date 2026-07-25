# 任务：align-onboarding-product-surfaces

- [x] 将已确认的 Codex 错误分流、回看末步文案和返回语义写入 onboarding PRD。
- [x] 将正式页面真实版本展示、实际检查刷新及静态评审表面不固定版本的裁决写入 onboarding PRD。
- [x] 修正 `OnboardingShell`：区分 `missing` / `unavailable` 恢复内容，统一回看与首启第 4 步 CTA 为「开始使用」。
- [x] 移除 onboarding Storybook 的固定版本；无真实检测输入时只展示通用就绪文案。
- [x] 补齐 console-ui 组件测试，覆盖真实版本 detail 原样展示、无 detail 时不伪造版本、两类错误分支、固定 footer 硬门和两种模式的末步行为。
- [x] 收紧 `env-doctor` 的既有结果语义：`ENOENT` / `ENOTDIR` 为缺失，非零退出、`EACCES`、其他启动异常和空版本文本为不可运行；错误结果不携带原始 stderr、异常文本或本地路径，且不新增 IPC / DTO 字段。
- [x] 将 `OnboardingRoute` 从“文案包含未找到”的模糊判断改为对既有安全分类消息的精确映射；未知错误统一进入 `unavailable`，成功检查整体替换旧环境状态；并以 take-latest 保护确保并发检查只有最后发起者可以更新页面。
- [x] 补齐 env-doctor、onboarding IPC 与 desktop renderer 路由测试：errno fixture 显式设置真实 `error.code`；断言 `codex --version` 成功 detail 经既有链路贯通、首次 A → shell PATH 事件 → 自动复检 B 的调用次数与顺序、新版本替换旧版本、A 晚于 B 返回时仍只展示 B、成功态不新增重检按钮、失败精确映射到正确错误分支且不泄露底层错误，并证明 replay 不产生首启完成副作用。
- [x] 扩展原型状态模型与单测，加入 `unavailable`、中性 checking 和确定性 replay 返回语义。
- [x] 更新原型 UI 与 review fixture，补齐不可运行提示、回看进入 / 退出 / 末步返回和 AI 调整即时用户气泡。
- [x] 扩展 `verify-onboarding.mjs`，逐时点验证用户气泡 → typing → 单次正文收敛，并覆盖静态 ready 态无具体版本、两类错误、first-run 不变、replay 两种返回和无外部请求。
- [x] 通过既有发布脚本重新生成 `docs/product/pages/onboarding.prototype.html`，不手工修改生成物、不提交 `prototypes/dist/`。
- [x] 运行 console-ui 定向测试，实际运行 env-doctor / onboarding IPC / desktop renderer 路由测试、prototype 完整 check、根 `pnpm test`、根 typecheck、console-ui `build-storybook` 与 desktop build，并核对本轮 evidence。
- [x] 对照 PRD、wireframes 与三个 spec-delta 反思代码符合度，修正所有偏差后提交独立验收。
