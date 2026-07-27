# 线框：open-markdown-file-references

基线：`docs/product/pages/main-right-sidebar.md#页面结构`

## pages/main-right-sidebar.md

```text
│ 改动 × │ rollout-…jsonl:292 × │ ＋                  │
│ ─────────────────────────────────────────────────── │
│ /Users/…/.codex/sessions/…/rollout-….jsonl         │
│ ─────────────────────────────────────────────────── │
│  290 │ {"timestamp":"…","type":"response_item",…}  │
│  291 │ {"timestamp":"…","type":"event_msg",…}      │
│› 292 │ {"timestamp":"…","type":"response_item",…}  │
│  293 │ {"timestamp":"…","type":"turn_context",…}   │
```

文件引用从正文链接进入，不加入空白标签的通用类型选择；首次打开将目标行滚入视野并突出。
