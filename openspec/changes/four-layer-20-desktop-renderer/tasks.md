# 任务：four-layer-20-desktop-renderer

## A · 基线与 ledger

- [ ] 冻结 settings/onboarding/team 与 conversation/search/sidebar 现有行为矩阵
- [ ] 从系列 design 复制 20 批五条精确 test-name 映射，建立 ledger；补齐 duration、最终替代纯测试和删除/保留结论，标出必须保留的 fetch/IPC/React 接缝

## B · Shell/team 纵切

- [ ] 提取 settings/onboarding/team/builder application controllers 与纯 state models
- [ ] 把 preload/localStorage/subscription 收敛为 adapters
- [ ] 覆盖 stale owner、generation、慢/失败返回和父级重渲染

## C · Conversation 纵切

- [ ] 提取 selection/route/search/process/analysis/project/session/sidebar controllers
- [ ] 把 HTTP/browser storage/timer 收敛为 adapters
- [ ] `app.tsx` 收为 exact composition root + view prop mapping，删除对应 layer debt

## D · 验证与真机

- [ ] 按 ledger 剪枝重复重型组合，保留唯一接缝
- [ ] scope、定向测试、typecheck、desktop build 全绿
- [ ] 执行 RA-05、RA-05a～RA-10 并按真机协议记录；RA-05a 必须记录 A/B 草稿、pending 发送禁用、最终 selection/未读及重启事实
- [ ] 报告纯比例、闸门耗时和集成测试净变化
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`
