# 设计：align-onboarding-prototype-with-desktop

## 方案

1. 从正式 `OnboardingShell`、`TeamBuilderView`、`TeamProposalCard`、`RelayDemo` 与内置 development team seed 提取当前可见口径，先写回 onboarding PRD。
2. 原型不 import 正式组件或 seed；在 `prototypes/src/main.tsx` 中维护一份只服务设计评审的确定性快照，并使用原型自己的 CSS 和状态模型渲染。
3. 四步共同骨架与 desktop 对齐：
   - 标题栏中央为 `Moebius`，右侧为“首次启动”；
   - 顶部步骤提示仅为“第 n 步，共 4 步”；
   - 主体统一 `max-w-lg` 量级，不为接力演示另开宽版；
   - 底部保留四点进度、`n / 4`、上一步与主 CTA。
4. AI 建队子流程改成 desktop 的内嵌会话结构和可见文案；原型继续使用确定性 mock 模拟 processing、proposal、adjust、commit。
5. 接力演示改用 desktop 的“接力演示 / 对话记录 / 第 n 棒 / 处理中或收尾 / 完成说明”信息层级，并冻结与内置 development seed 一致的接力文案。
6. Playwright 门禁除已有完整旅程、硬门、重播、减少动态效果和离线检查外，新增关键文案断言。

## 权衡

- 不共享正式 React 组件，避免破坏 prototype 与生产依赖图隔离；代价是需要显式维护可见口径快照。
- 不把 prototype 变成 desktop 的截图复刻；保留评审场景控制与确定性 mock，但产品界面区域必须匹配正式页面的信息层级和文案。
- 这次主要是展示与文案同步，不新增状态转换；沿用既有纯状态单测，以真实 `file://` 旅程和截图作为主要验证。

## 风险

- 手工投影仍可能再次漂移：通过 Playwright 对关键文案和结构做直接断言降低风险。
- 生成 HTML 体积较大且不适合人工逐行 review：只修改可维护源码，并用发布脚本验证内联资源后原子替换。
- PRD 的旧字符图可能遗漏 desktop 的细节：归档前逐项对照正式组件并回读 PRD。
