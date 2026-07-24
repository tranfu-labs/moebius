# 线框：history-output-hover-icon

基线：`docs/wireframes/pages/console.md`。主会话页面当前事实由 `docs/product/pages/main-conversation.md` 接管；归档时按项目约定回流该页面 PRD，不向历史 wireframe 追加双源事实。

## pages/main-conversation.md

成功 Agent 历史消息保持正文下方左对齐，默认不显示操作：

```text
(开) 开发  14:32
     已完成实现，测试通过。
```

悬停整条消息或键盘焦点进入消息后，在相同位置显示图标：

```text
(开) 开发  14:32
     已完成实现，测试通过。
     [▤]
      ↑ 完整输出
```

入口不移动到 who 行右侧；活动运行和异常事实的完整输出入口继续常驻。
