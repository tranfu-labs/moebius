# console-ui 规格增量

## REMOVED Requirements

### Requirement: Claude workspace trust requires an explicit, non-dismissible decision

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

**Reason**: 用户已将 Claude 原生信任提示的产品行为改为自动确认；该人工决策 UI 不再是当前产品行为。

## ADDED Requirements

### Requirement: Claude native workspace trust auto-confirmation creates no interactive control

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

When local-console recognizes Claude's native workspace-trust prompt, console-ui MUST continue rendering the ordered raw terminal trace in its existing read-only surface and MUST NOT render a trust dialog, trust/decline button, or editable terminal input. The UI MUST NOT expose an API action for sending a workspace-trust choice; the normal Agent Markdown block remains governed by the final-result flow.

#### Scenario: Native trust prompt does not block the console

- **GIVEN** a new Claude run reaches its native workspace-trust prompt
- **WHEN** local-console automatically confirms it in the PTY
- **THEN** no Claude trust dialog or decision control is present in the console
- **AND** the user can observe only the read-only terminal trace until the normal run result appears.
