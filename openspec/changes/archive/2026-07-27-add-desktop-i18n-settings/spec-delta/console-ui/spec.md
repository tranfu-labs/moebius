# console-ui delta：add-desktop-i18n-settings

## ADDED Requirements

### Requirement: Type-safe local interface translations

Source: `docs/product/pages/settings.md#语言覆盖范围`

The console UI MUST provide bundled `zh-CN` and `en` resource files with identical translation keys and interpolation contracts.

Production components MUST render Moebius-provided static interface copy through translation keys and MUST NOT choose copy with locale comparisons, locale switches, or locale ternaries.

User input, Agent output, custom names, file content, file names, local paths, and raw diagnostics MUST remain unchanged when the interface locale changes.

#### Scenario: Interface copy changes while user content does not

Given the current workspace contains a draft, messages, a project name, and a local path
When the locale provider commits a saved target locale
Then Moebius-provided labels and accessible names use the target resource
And the draft, messages, project name, and local path remain byte-for-byte unchanged.

### Requirement: Settings language dialog

Source: `docs/product/pages/settings.md#页面结构`

The console UI MUST expose a controlled modal settings dialog opened from the sidebar's single settings entry.

The first release MUST show only General and the `简体中文` and `English` language options; it MUST NOT show disabled future categories or coming-soon placeholders.

The dialog MUST trap focus, return focus to the settings entry on close, close through its close control or Escape, remain open on backdrop interaction, and switch to a stacked layout at narrow widths.

#### Scenario: Settings opens without navigating

Given a project, conversation, sidebar state, scroll position, and unsent draft are active
When the user opens Settings
Then a centered modal dialog appears without changing the current route or unmounting the workspace
And closing it restores focus and preserves all active workspace state.

#### Scenario: Failed language save remains retryable

Given the active locale is `zh-CN`
When saving `en` fails
Then the dialog and workspace remain in `zh-CN`
And the dialog exposes a localized failure message and Retry action.
