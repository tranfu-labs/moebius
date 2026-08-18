# 侧栏项目内对话渐进加载

基线页面：`docs/product/pages/main-left-sidebar.md#项目内对话的渐进加载`

## 页面结构

```text
▾ 项目 A
    对话 1
    对话 2
    对话 3
    对话 4
    对话 5
    Show More / 显示更多

点击后：

▾ 项目 A
    对话 1 … 对话 5
    对话 6 … 对话 15
    Show More / 显示更多（仍有更多时）
```

按钮属于项目对话列表底部，使用现有 ghost 控件层级；加载期间保持位置不变并显示 loading 状态。项目折叠后再次展开只回到前五条，不保留按钮的 loading 或追加批次。
