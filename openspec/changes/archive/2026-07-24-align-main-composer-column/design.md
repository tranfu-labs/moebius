# 设计：align-main-composer-column

## 方案

新增两个只承载主会话正文列布局的静态 Tailwind 类常量：

```ts
export const MAIN_CONVERSATION_COLUMN_WIDTH_CLASS = "max-w-[760px]";
export const MAIN_CONVERSATION_COLUMN_GUTTER_CLASS = "px-8";
```

`OperatorConsole` 用它们约束 sticky 标题、时间线正文宿主、待发射区和主 composer；`NewConversationPage` 用它们约束标题与新对话 composer 宿主。完整类名以静态字符串存在，确保 Tailwind 构建可以发现。

主 composer 和新对话宿主继续保留 `w-full`，待发射区补上显式 `w-full`。标题、时间线与输入区的父宿主统一使用 `px-8`；当可用宽度小于 `760px` 时，三个区域在相同 gutter 内响应式收缩，不会因为原有 `px-8` / `px-6` 差异反向错位。

## 权衡

- 选择共享语义常量，而不是把两个 `720px` 直接替换为 `760px`：改动稍多一行模块与 import，但能让标题、正文和输入器共用同一事实，避免下一次只改其中一处。
- 不把主会话宽度做成全局设计令牌：它是页面布局约束，不是跨组件的颜色、间距或圆角令牌。
- 不修改 `RoleComposer` 默认宽度：组件本身保持容器无关，由主会话和右侧栏宿主分别决定宽度。

## 风险

- 窄窗口可能因显式 `w-full` 与 padding 组合产生溢出；现有 `box-sizing` 与父级 padding 应可正确收缩，需用测试、构建和窄宽度渲染核对。
- Tailwind 若未扫描到常量文件会丢失类；静态字面量和 console-ui 构建可验证生成结果。
- 回滚只需恢复宿主宽度类并删除共享常量，不涉及数据或运行时协议。
