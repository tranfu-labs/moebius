# Wireframe Flow Notes

## Local Console

The desktop operator console is the default local experience. Its auxiliary status page reports local runtime, provider environment, data directory, version, and update facts.

```text
启动桌面应用
  │
  ├─ 获取单实例锁
  │    └─ 第二实例启动 → 激活已有窗口并退出
  │
  ├─ 主进程启动序列
  │    ├─ 解析数据根
  │    │    ├─ 打包态默认 ~/.moebius
  │    │    ├─ 开发态默认仓库根
  │    │    └─ MOEBIUS_DATA_ROOT 覆盖
  │    ├─ macOS 图形进程 PATH 修复
  │    ├─ 首启种子拷贝 agents/ + config.toml
  │    ├─ 环境自检 Codex / Claude / Kimi CLI
  │    ├─ 127.0.0.1 动态端口启动 local console server
  │    └─ 创建操作台窗口
  │
  ├─ 操作台主窗口接收主进程快照
  │    ├─ local console URL
  │    ├─ 持久化本地项目 / 多会话列表
  │    │    ├─ [打开项目] → preload 原生目录选择 → local console API 持久化 project
  │    │    ├─ 每个 project 行 [＋] → 在该 project 新建并选中空白 session
  │    │    ├─ 空白 session 可重绑项目；有消息 / run / parent / child 后锁定
  │    │    ├─ create / open / rebind 共用 selection mutation gate
  │    │    └─ renderer 始终渲染 project → peer session 平铺列表
  │    ├─ 当前会话时间线
  │    ├─ active run 直播块 / elapsed / 中断
  │    └─ interrupted / failed / stuck 本地记录
  │
  ├─ [诊断] → 辅助状态页
  │    ├─ local console 状态
  │    ├─ provider CLI 环境自检
  │    ├─ 数据目录入口
  │    └─ 版本与更新入口
  │
  ├─ [打开数据目录] → 系统文件管理器打开数据根
  ├─ [检查更新]
  │    └─ macOS Apple Silicon：读取 GitHub Releases，有新版则跳转下载页
  │
  └─ 关闭窗口 → 关 local console server → 应用退出
```

## Landing（Moebius）

```text
部署 sites/marketeam/ → 打开唯一入口 index.html
  │
  ├─ 展示任务接手 → 处理 → 复核 → 交付
  ├─ 失败时回到处理并再次复核
  ├─ Apple Silicon Mac + provider CLI 安装指引
  ├─ prefers-reduced-motion → 静态可读终态
  └─ 静态托管只发布 sites/marketeam/
```
