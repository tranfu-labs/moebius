## MODIFIED Requirements

### Requirement: 验收 #20 团队菜单披露创建时载入的快照语义
Source: docs/product/pages/main-conversation.md#团队按钮展开

New conversation, analysis new conversation and existing-session team menus MUST reuse one team-option component and one viewport-bounded menu shell. Every selectable option MUST show name, source, one-line purpose, primary Agent and member count by default. Ordered readable members MUST be available through a keyboard-operable disclosure that expands/collapses a bounded member region without selecting the team or closing the menu. The menu MUST NOT show member CLI/model/effort, internal identifiers or a native title tooltip.

The menu MUST remain inside the available viewport and a product height budget. Existing-session current summary and snapshot notice MUST remain pinned while only the catalog scrolls; new-conversation and analysis menus MUST scroll only their catalog. An expanded member region MUST scroll independently when needed and MUST NOT create page-level overflow.

An existing-session trigger and checked current item MUST use the effective historical snapshot summary. Current catalog teams MUST appear only after a separator, excluding the stable team represented by the current snapshot. A pending explicit switch MUST show its frozen target summary. New-conversation options MUST use current saved catalog state.

#### Scenario: Compact options disclose members without selection

- GIVEN an option has seven members and the compact menu is open
- WHEN the user activates its member disclosure by mouse, Enter or Space
- THEN the full ordered member list is reachable in a bounded region
- AND the option is not selected and the menu remains open.

#### Scenario: Tall catalog stays inside a narrow viewport

- GIVEN the viewport is narrow and six teams have long names and purposes
- WHEN the team menu opens
- THEN the content remains within the viewport safety margin
- AND only the catalog scrolls while existing-session current and snapshot sections remain visible.
