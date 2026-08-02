# marketing-site 规格增量：视觉宪法 v0.2 统一

## 替换：视觉与语义
- MUST 以 `docs/marketing-site/视觉宪法.md` 当前 v0.2 与 `sites/marketeam/style.html` 已验收样张作为官网视觉规则的唯一来源；正式页 MUST NOT 发明样张之外的新令牌、组件或动效原语。
- MUST 使用“判断 / 解释 / 记录”三声部：判断使用中文衬线，解释使用中文无衬线，过程记录使用等宽字体；三者必须有可辨认的尺度与职责差异。
- MUST 以奶油纸、墨色阶为基础；对齐蓝、通过绿、退回橙只能表达相应流程状态，MUST NOT 作为无语义装饰。
- “你 / 需要拍板” MUST 使用菱形等结构差异表达，MUST NOT 新增专属装饰色。
- MUST 使用细线、有限圆角与参数化几何；MUST NOT 使用硬偏移阴影、荧光装饰、纸张拟物、橡皮章、手绘路径或与产品无关的场景插画。
- 每页 MUST 只有一个投入主要工艺预算的中心作品；参数化点阵、半调、套准标与发丝线只可集中用于中心作品。
- 每一主要视屏 MUST 有至少一个尺度、明度或密度反差锚点；大面积留白必须有明确视觉指向。
- hover、focus 与展开交互 MUST 揭示业务元素间的关系，MUST NOT 只做装饰变换。

## 新增：样张先行验收闸门
- 视觉系统变更 MUST 先在 `sites/marketeam/style.html` 实现和验收，再迁移到 `sites/marketeam/index.html`。
- `style.html` MUST 覆盖令牌、三声部、版式宽度、中心作品、状态、底单、交互、动效、响应式与 reduced-motion 样本。
- 用户尚未明确确认样张验收通过时，MUST NOT 将该轮视觉变化迁移到正式 `index.html`。

### 场景：样张未通过时阻止正式页迁移
Given 本轮视觉规则已经写入 `style.html`
And 用户尚未明确确认“style.html 验收通过”
When 继续执行本轮 change
Then `sites/marketeam/index.html` 保持不变
And 后续工作只允许修正样张、规则、测试和验收证据

### 场景：样张通过后迁移正式页
Given 用户已明确确认“style.html 验收通过”
When 开始阶段二
Then `index.html` 只组合样张中已通过的令牌、组件、版式和动效原语
And 正式页继续保留六板块业务叙事与单文件部署契约

## 新增：确定性视觉验收
- 中心作品的核心动画 MUST 是时间参数的确定性模型，并支持通过 `?t=` 冻结到指定状态。
- 样张与正式页 MUST 在桌面、平板、窄屏和 reduced-motion 状态下完成浏览器验收。
- 375px 窄屏下页面级 `scrollWidth` MUST 不大于 `clientWidth`。
- no-JS 或脚本初始化失败时，正文、关键判断和流程状态 MUST 保持可读，不得永久停留在隐藏初态。
- 可展开控件 MUST 通过 `aria-expanded` 与 `aria-controls` 暴露状态；键盘焦点 MUST 清晰可见。

### 场景：固定帧可复核
Given 访问样张或正式页并提供合法 `?t=` 参数
When 页面完成初始化
Then 中心作品停在该参数对应的确定状态
And 截图可复核任务位置、最远进度、当前判决和已显示底单事件

### 场景：减少动态效果仍完整
Given 用户启用 `prefers-reduced-motion: reduce`
When 打开样张或正式页
Then 非必要循环与滚动动效停止
And 中心作品停在包含关键流程信息的稳定终态
And 所有正文与交互说明仍可阅读
