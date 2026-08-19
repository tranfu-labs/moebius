# 0010. GitHub 团队仓库：一个仓库发布一支团队（1 repo = 1 distribution = 1 profile）

## 状态

accepted

## 背景

GitHub 团队发现、安装与持续更新落地时，讨论过「一个仓库放多个团队」的备选形态。参考对象是
Claude Code Skills 的目录式多单元惯例（`.claude/skills/<skill-name>/SKILL.md`，一个插件仓库可
承载任意多个 skill），初步设计稿为 `teams/<team-name>/` 子目录结构。

用户随后调研 hermes agent 生态并拍板：**一个 repo = 一个 distribution = 一个 profile**，即一个
仓库对应一个可分发、可安装的能力单元。这与本产品文档既有的「团队仓库约定」一致：
`docs/product/pages/github-team-discovery.md` 明确规定「一个仓库一支团队一种语言。仓库根目录
就是团队目录：`team.json` 加 `members/<slug>/AGENT.md`」，`docs/product/pages/agent-teams.md`
也按「一仓库一团队一语言」命名官方上游仓库（`moebius-team-general-assistant`、
`moebius-team-development`，加 `-zh` 后缀为中文版）。

## 决策

1. 一个公开 GitHub 仓库发布且只发布一支团队；仓库根目录即团队目录：
   `team.json` + `members/<slug>/AGENT.md`（`official.json` 为可选推荐配置 manifest）。
2. 一个仓库一种语言，由仓库 topic（`moebius-team-zh` / `moebius-team-en`）声明；同一支团队的
   中英版本是两个独立仓库、两支独立团队，产品不关联、不提供跨语言切换。
3. 不接受仓库内多团队子目录形态（`teams/<name>/` 等）。搜索（topic 恒为 `moebius-team`）、
   预览、安装、上游记录与 A/B/C 持续更新全部按「一个仓库 = 一个团队」定位，来源身份即
   `owner/repo` 加默认分支。
4. 若未来需要「一个仓库承载团队集合」或按分支/子目录定位来源，须另行产品决策并更新本 ADR。

## 后果

- 发布侧极简：作者发布一支团队 = 一个仓库 + 两个 topic；生态搜索、预览、安装与上游同步链路
  都不需要仓库内导航。
- 代价：一支仓库无法承载团队集合；作者要发布多支团队就得多建仓库（多仓库维护成本由作者承担，
  产品不提供聚合页或关联）。
- 与 Claude Code skills 的多单元目录惯例不同，原因在搜索机制：本产品发现依赖 GitHub topic
  （仓库级元数据，读不到仓库内文件），仓库内多单元需要预览期目录探测；且上游同步按整支团队
  做 A/B/C 比较，仓库边界是最简单元。此差异是机制约束下的有意选择，不是疏漏。
- 现有实现（`b025088` 起的 github-team 模块）与多团队设计稿的差异为零：设计稿未落地实现，
  本 ADR 固化的是既有实现与产品文档一致的形态。
