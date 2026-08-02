# console-ui delta：console-ui-sidebar-composer-context

## ADDED Requirements

### Requirement: Project and session sidebar

The console UI MUST provide an independent project and session sidebar component that derives each visible project label from the final directory name of its project path.

The sidebar MUST order sessions by waiting, running, idle, and completed status, in that order, while preserving caller order within the same status.

The sidebar MUST classify goal sessions by their actual status and MUST NOT introduce a special goal-session priority tier.

The sidebar MUST keep completed sessions in a completed group that is collapsed by default.

The selected session style MUST NOT change session ordering.

#### Scenario: Sidebar Story shows four status tiers

Given a Story supplies a project path and sessions in mixed status order
When the sidebar Story opens
Then the project displays the final directory name
And waiting sessions appear before running sessions
And running sessions appear before idle sessions
And the completed group appears last and is collapsed by default.

#### Scenario: Selection does not reorder sessions

Given an idle session is selected and a waiting session is not selected
When the sidebar renders
Then the waiting session remains before the selected idle session
And the selected session is indicated only as an interaction state.

### Requirement: Protocol-safe role composer

The console UI MUST provide an independent controlled composer that opens a completion panel for the seven legal roles: ceo, dev, qa, dev-manager, product-manager, hermes-user, and secretary.

The completion panel MUST present a neutral avatar, Chinese role name, and concise responsibility for each role.

Selecting a role MUST replace the active completion token with exactly one legal `@<handle>` mention and MUST preserve surrounding ordinary text.

When the message already contains one legal role mention outside the active completion token, the composer MUST NOT insert a second legal role mention.

The completion panel MUST support pointer selection and keyboard selection.

#### Scenario: Role selection generates a legal mention

Given the composer contains an active `@` completion token and no other legal role mention
When the user selects the displayed 开发 role
Then the controlled composer value contains `@dev`
And the user did not need to type the complete protocol handle.

#### Scenario: Existing mention blocks a second insertion

Given the composer value already contains `@qa`
When the user attempts to open another completion and select 开发
Then the composer does not insert `@dev`
And the original value remains unchanged.

### Requirement: Empty conversation state

The console UI MUST provide an independent empty conversation state with an invitation to describe a goal and choose a role through the role composer.

The empty state MUST NOT use an illustration, unread language, urgency language, or more than one solid emphasis action.

#### Scenario: Empty state invites a protocol-safe start

Given a conversation has no messages
When the empty-state Story opens
Then it invites the user to describe a goal and choose a role
And the embedded composer can open the legal role completion panel
And the surface remains flat except for the completion overlay.

### Requirement: Current session context header

The console UI MUST provide an independent current-session header that renders an optional parent-session breadcrumb, the current task status, and a compact progress summary.

The current-session header MUST NOT render global waiting counts, global running counts, a new-session action, or the global waiting-list overlay.

#### Scenario: Header Story stays within current-session context

Given a task session has a parent session, status, and progress counts
When the session-context header Story opens
Then the parent breadcrumb, task status, and progress summary are visible
And global counts, a new-session action, and a global waiting-list control are absent.

### Requirement: Linear flat visual boundary

The sidebar, composer, empty state, and session header MUST use existing console semantic tokens, thin borders, near-square radii, compact spacing, and flat solid controls.

The role completion overlay MAY use one soft shadow, but non-overlay component surfaces MUST NOT use shadows.

Waiting presentation MUST remain neutral, and runtime state colors MUST NOT be used as decoration.

#### Scenario: Component Stories match the conversation-console source

Given the four component Stories are rendered in light or dark mode
When they are compared with the conversation-console design source and the AcceptCard component-library reference
Then borders, radii, spacing, buttons, and neutral status presentation use the same flat visual language
And only the open role-completion overlay has a shadow.
