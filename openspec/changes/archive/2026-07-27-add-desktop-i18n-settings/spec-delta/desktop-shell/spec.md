# desktop-shell delta：add-desktop-i18n-settings

## ADDED Requirements

### Requirement: Durable desktop language preference

Source: `docs/product/pages/settings.md#切换语言`

The desktop shell MUST persist a versioned `zh-CN` or `en` language preference beneath the application data root using a temporary file and atomic rename.

Missing, malformed, or unsupported preferences MUST resolve to `zh-CN`.

The shell MUST create the first interactive renderer using the resolved saved locale so a saved English preference does not expose an interactive Chinese-first state.

#### Scenario: Saved language is restored on restart

Given `en` was saved successfully
When the desktop application fully exits and starts again
Then the first interactive main window uses `en`
And no network request is required to load language resources.

### Requirement: Persist before global locale commit

Source: `docs/product/pages/settings.md#切换语言`

The preload bridge MUST expose only read preference, save preference, and locale-change subscription capabilities.

The main process MUST update its in-memory locale and broadcast to all desktop windows only after the preference file is written successfully.

If persistence fails, the active locale MUST remain unchanged, no locale-change broadcast MUST occur, and the renderer MUST be able to retry.

#### Scenario: Save failure does not flash or roll back language

Given the active and last saved locale is `zh-CN`
When the user selects `en` and the preference write fails
Then every open window remains in `zh-CN`
And no window first renders English and later rolls back.

### Requirement: Desktop-wide static copy follows the saved locale

Source: `docs/product/pages/settings.md#语言覆盖范围`

The main operator window, auxiliary status window, Moebius-provided menu/dialog copy, tooltips, placeholders, errors, and accessible names MUST follow the active saved locale.

The shell MUST NOT translate or rewrite user/Agent content, custom names, file content, file names, local paths, CLI output, or raw OS diagnostics.

#### Scenario: Existing and newly opened windows agree

Given multiple desktop windows are open
When a target locale is saved successfully
Then all open windows commit that locale
And a status window opened afterward starts in the same locale.
