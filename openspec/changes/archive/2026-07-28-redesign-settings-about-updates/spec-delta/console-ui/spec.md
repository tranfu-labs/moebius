# console-ui spec delta：redesign-settings-about-updates

## Requirement: 设置弹窗以紧凑双分类呈现语言与关于

Source: docs/product/pages/settings.md#页面结构

生产 `SettingsDialog` MUST 只显示“常规”和“关于”两个可用分类，MUST 只有一个弹窗标题，语言选项 MUST 位于单一连续分组。“关于” MUST 显示统一品牌、当前版本、右对齐的 Apple Silicon Mac、更新状态和三个公开入口。窄窗 MUST 把分类导航移到内容上方；短窗 MUST 只滚动内容并保持标题与关闭入口可达。

### Scenario: 关于页的确定信息结构

- GIVEN 设置弹窗已打开并切换到“关于”
- WHEN 应用版本为 `0.1.4`
- THEN 页面显示 Moebius 品牌、`0.1.4`、右对齐的 `Apple Silicon Mac`
- AND 显示检查更新、查看发布记录、反馈问题和开源仓库
- AND 不出现禁用或即将推出分类

## Requirement: 设置更新、复制与外链结果受控且键盘连续

Source: docs/product/pages/settings.md#检查更新
Source: docs/product/pages/settings.md#复制版本与公开链接

`SettingsDialog` MUST 受控呈现 idle、checking、latest、available、failed 更新状态以及复制成功/失败和外链失败。检查中 MUST 禁止重复触发但 MUST 保持触发控件可聚焦；终态 MUST 原地更新并通过可访问状态通知读出，MUST NOT 自动抢焦点。下载、重试和公开链接 MUST 进入正常 Tab 顺序。打开外链失败 MUST 保留当前弹窗、分类和焦点。

### Scenario: 检查到新版

- GIVEN 当前版本为 `0.1.4`
- WHEN 受控状态变为 available 且最新版本为 `0.1.5`
- THEN 更新组显示 `0.1.5`、下载新版本和再次检查
- AND 不自动执行下载或浏览器动作

### Scenario: 更新检查失败

- GIVEN 当前版本可见
- WHEN 受控状态变为 failed
- THEN 页面显示可理解失败说明和重试
- AND MUST NOT 显示已是最新版

## Requirement: 工作区通知恢复设置异步结果

Source: docs/product/pages/settings.md#打开与关闭

`OperatorConsole` MUST 在设置关闭后仍保留进行中的语言保存和更新检查。操作在关闭后进入终态时 MUST 追加一次不抢焦点的本地通知；通知操作 MUST 重开设置并定位到“常规”或“关于”。从侧边栏重开设置时，若更新检查仍在进行，MUST 直接恢复“关于”及检查状态。弹窗保持打开时 MUST NOT 重复通知；多个终态通知 MUST NOT 互相覆盖。

### Scenario: 关闭后更新完成

- GIVEN 更新检查进行中且用户关闭设置
- WHEN 检查进入 latest、available 或 failed
- THEN 工作区出现一次对应语言的轻量通知
- AND 当前项目、对话、草稿、滚动位置与焦点不被通知改变
- AND 激活通知后重开“关于”并显示该终态
