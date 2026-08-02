# Console error source audit

## Baseline and invariant

- Baseline `47f2031`: 53 non-null writes and 23 non-refresh null clears flowed through an unowned
  `setClientError(string | null)` slot.
- Current implementation: `rg "setError|setClientError" desktop/src/console-page` returns no shared client-error
  writer; the 53 failure publications are represented by exactly 53 `errors.fail(...)` / `errors.report(...)`
  calls.
- A source key is `family + instance/action scope`. Family alone never grants clear authority.
- `begin` advances only that source generation; `fail` and `succeed` settle only the latest generation.

## Owner mapping

| Owner family | Scope identity | Production owners | Failure publications |
| --- | --- | --- | ---: |
| `state-refresh` | project + session | `refresh-console-state.ts` | 1 |
| `result-acknowledgement` | acknowledgement key | `use-console-state-sync.ts` | 1 |
| `desktop-shell` | update action or external URL | `use-desktop-shell-actions.ts` | 3 |
| `attachment` | main / sub-session / sidebar draft key | `use-console-attachment-drafts.ts` | 3 |
| `process-data` | process source key | `load-previous-process-output.ts` | 1 |
| `analysis` | session + create/navigation action | `use-conversation-analysis.ts`, `use-analysis-panel-navigation.ts` | 4 |
| `conversation` | session + mutation/send/transition action | `conversation-actions.ts`, `project-session-actions.ts`, `use-conversation-transition.ts` | 12 |
| `new-conversation` | project + creation/preference action | `session-creation-actions.ts`, `use-new-conversation-submission.ts` | 3 |
| `project` | project + mutation action | `project-opening-actions.ts`, `project-session-actions.ts`, `use-project-mutations.ts` | 13 |
| `search-navigation` | target session | `use-searched-session-navigation.ts` | 1 |
| `session-run` | session + send/retry/interrupt action | `use-session-run-actions.ts` | 4 |
| `sidebar-draft` | draft id | `use-sidebar-draft-actions.ts` | 2 |
| `sidebar-message` | session/message + action | `use-sidebar-message-actions.ts` | 4 |
| `edit-resend` | session + stopped message | `use-edit-resend.ts` | 1 |
| **Total** | | | **53** |

## Test ledger

- Added `console-error-model.test.ts`: cross-source retention, same-source replacement/recovery, stale
  generation rejection, scope isolation, and A→B→B-success→A restoration.
- Added `use-console-error-state.test.tsx`: parent rerender, callback identity change, and slow stale settlement.
- Extended `console-state-sync.test.ts`: three successful polls cannot clear a project error; refresh failure is
  cleared by a later success from the same refresh source.
- Existing project, attachment, session, analysis, sidebar, and shell tests keep their original behavioral
  assertions while using an ownership-aware test controller.
- Deleted tests: none.
