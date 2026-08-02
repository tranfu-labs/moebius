# Desktop Status Page Wireframe

Desktop status is an auxiliary read-only diagnostic window reachable from the operator console. It reports the local console, provider CLI environment, data directory, version, and update state. It does not expose configuration editing, runner controls, or a GitHub-state observer.

Normal state:

```text
┌──────────────────────────────────────────────┐
│  Moebius                       v0.2.0         │
├──────────────────────────────────────────────┤
│  运行状态                                     │
│   ● 本地操作台  127.0.0.1:52341               │
│                                              │
│  环境自检                                     │
│   ✓ Codex CLI     已找到                      │
│   ✓ Claude CLI    已找到                      │
│   ⚠ Kimi CLI      未找到                      │
│                              [打开数据目录]   │
│                                              │
├──────────────────────────────────────────────┤
│  当前版本 0.2.0                    [检查更新]  │
└──────────────────────────────────────────────┘
```

Local console unavailable:

```text
│   ✗ 本地操作台  启动失败                      │
│               日志：~/.moebius/logs/…         │
```

Provider environment failure:

```text
│   ✗ Codex CLI   未找到，请安装后重启应用       │
```
