# design-prototypes delta：add-desktop-i18n-settings

## ADDED Requirements

### Requirement: Self-contained settings language prototype

Source: `docs/product/pages/settings.md#页面结构`

The isolated settings prototype MUST build to `docs/product/pages/settings.prototype.html` as one self-contained file that opens from a local file URL without network access.

The prototype MUST place Settings over a representative active workspace, expose only General with `简体中文` and `English`, and model close, Escape, failed save, retry, successful locale commit, narrow layout, dark appearance, and reduced-motion review states without calling product runtime capabilities.

#### Scenario: Reviewer validates the language-save journey offline

- **GIVEN** the settings prototype is opened through `file://`
- **WHEN** the reviewer selects English, observes a deterministic failed save, and retries
- **THEN** the first failure keeps the Chinese workspace and dialog active
- **AND** the retry commits English across the representative workspace and dialog
- **AND** no required resource request leaves the local file.
