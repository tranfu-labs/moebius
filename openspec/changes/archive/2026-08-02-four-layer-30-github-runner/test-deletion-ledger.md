# 30 批测试删除 ledger

基线：d7373e3。机械判据：标题存在于基线、在当前同路径测试中不存在。文件级分类不抵扣 local/shared 接缝；替代与保留证据见末节。

删除 test-name 总数：342（含两条参数化展开用例和归档后补正删除的 20 条孤儿 goal-ledger 用例）。

## desktop/tests/runner-launch.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- keeps the supervised child in explicit GitHub mode

## desktop/tests/runner-supervisor.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- restarts abnormal exits and stops after the crash limit
- does not restart after manual stop

## tests/acceptance-prepass.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- records a child acceptance fact and requests parent integration acceptance only when join is ready
- bounds a never-resolving child fact ledger write
- keeps repair child references empty when repair lookup fails and posts a fail-closed trace

## tests/agent-context-state.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- returns an empty store when the state file does not exist
- saves and loads agent context state
- fails safely on invalid state shape
- loads issue workspace context fields and rejects invalid optional values
- merges concurrent entry saves without overwriting other issue contexts

## tests/agent-manifest.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- parses canonical pre_script frontmatter and keeps markdown body
- treats markdown without frontmatter as persona body only
- parses canonical workspace access frontmatter
- keeps legacy camelCase aliases readable
- rejects conflicting canonical and legacy aliases
- rejects invalid workspace access values
- rejects preScript paths outside the trusted directory
- keeps issue workspace access limited to the first enabled roles

## tests/ceo-ledger-context.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- returns bootstrap context that allows default plan-chain routing for a loadable issue with no active ledger owner
- keeps malformed multiple active owner candidates fail-closed

## tests/ceo-orchestration.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- builds a stable orchestration key that ignores title and description drift
- renders child issue body with required fields and exactly one handoff mention
- renders roundtable child, route, and parent summary bodies with stable keys

## tests/codex-execution-reaction.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- resolves the issue body as the issue reaction target
- resolves a timeline comment as an issue-comment reaction target
- keeps reaction failures best-effort
- does not throw when a comment reaction target cannot be found

## tests/conversation-interrupt.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- does not interrupt while the message count is unchanged
- interrupts when a driver reports new messages
- polls snapshots without depending on a specific driver

## tests/conversation.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- counts issue body plus comments
- selects the first mentioned agent that exists
- does not select an agent from historical messages when the latest message has none
- selects an agent even when the message count is even
- has deterministic behavior for multiple agent mentions
- normalizes issue body and agent comments into a speaker timeline
- selects the latest timeline message as the trigger source
- builds a full prompt for a role without existing thread state
- builds a resume prompt from new external messages only
- skips resume when there are no new external messages
- selects delta messages after the last seen index excluding the current role
- resolves the next role thread state from codex output or the existing resume thread

## tests/current-repo-workspace.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- returns the moebius repository root as Codex cwd
- resolves the repository root from the source file location

## tests/dev-workspace.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- creates a repo cache and issue-specific worktree on first run
- reuses an existing context after confirming it contains latest main
- fetches an existing repo cache before creating a new issue worktree
- rebuilds an existing worktree when it is behind latest main
- fails closed when rebuilding a stale worktree cannot re-add the worktree
- falls back to rm -rf plus worktree prune when git worktree remove fails
- fails closed before deleting when an existing context points at an unexpected worktree path
- fails closed when an existing context points to a missing worktree
- sanitizes path segments
- includes git stderr when a git command fails
- derives a controlled local branch name from role/owner/repo/issue
- normalizes owner/repo characters when building the local branch name
- serializes calls sharing the same repo cache key
- runs different repo cache keys in parallel
- releases the repo lock when the critical section throws
- rebuilds a stale worktree with -B and the derived local branch name

## tests/driver-pool.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- starts all jobs immediately when no maxConcurrent limit is configured
- limits running jobs when maxConcurrent is configured
- starts queued jobs after a rejected job releases capacity
- rejects invalid maxConcurrent values

## tests/external-route.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- rejects an append route when publishing the visible handoff fails
- records deterministic no_action for an agent-authored comment on an already passed ledger child
- recovers a roundtable participant comment that does not hand control back to CEO

## tests/format-ceo.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- parses no_change JSON
- parses no_change JSON wrapped in fenced code block
- parses replace JSON with body
- parses append JSON with as and body
- returns invalid_json for non-JSON output
- returns invalid_json for JSON array
- returns unknown_action for unknown action value
- parses no_action JSON
- parses append JSON wrapped in fenced code
- rejects non-object JSON and unknown actions
- returns NO_ACTION when CEO says no_action
- returns APPEND and targetRole for a single valid non-code mention
- injects ledgerTaskContext and the agent-authored intro when ledgerContext is provided
- returns APPEND when an unclear external route is handed to CEO
- fail-opens and aborts a never-settling route Codex run when the timeout fires
- replaces a missing marker response when CEO returns a valid repair
- returns APPEND when CEO decides to add an independent comment as=ceo
- returns APPEND when CEO corrects GitHub interaction protocol violations
- returns APPEND with the plan review template to qa for plan-written
- returns APPEND with the post-implementation retro template to the requester for code-verified
- returns APPEND when CEO asks dev to add missing acceptance statements
- returns APPEND with as=dev when CEO impersonates dev
- returns APPEND with as=dev-manager when CEO speaks as the tech lead
- returns APPEND with as=secretary when CEO delegates rule maintenance
- fail-opens CEO self-loop append decisions for CEO agent responses
- returns the original body when CEO says no_change
- passes full public issue context to CEO prompt
- does not invoke CEO again for already corrected text
- fail-opens when CEO returns non-JSON output
- fail-opens when CEO returns an unknown action
- fail-opens when append.as is not in allowed set
- fail-opens when append.as is the removed reflector role
- fail-opens when append body is empty
- fail-opens when replace body lacks a valid trailing stage marker
- fail-opens when replace body stage marker is outside AllStages
- fail-opens when CEO throws, times out, or returns empty text
- aborts the CEO Codex run when timeout fires

## tests/github-intake-state.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- returns an empty store when the state file does not exist
- saves and loads intake state
- loads legacy issue state without failure accounting fields
- fails safely on invalid state shape

## tests/github-response-intake.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- selects repositories due for idle scans
- baselines the first repository scan without processing historical issues
- returns changed issues on later repository scans without advancing processed timestamps
- records no-trigger as idle and triggered-success as active
- records failed processing without advancing updatedAt or burning the no-change budget
- increments existing failure count without demoting at the no-change limit
- starts failed retry accounting from one when a previously idle issue changes again
- uses an epoch cursor for failed processing when the issue was not previously tracked
- records dead-lettered processing as visible ack and clears failure accounting
- removes issue state after issue-closed outcomes
- keeps interrupted issues active without advancing past the interrupted baseline
- keeps already active issues active after no-trigger changes
- records external comment fallback route outcomes by comment id across no_action, append, and fail_open
- keeps loading and folding legacy issue state without fallback route fields
- demotes active issues after five unchanged active polls
- returns due active issue sources only for watched repositories and enforces their active issue limit

## tests/github-state-store.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- keeps fresh local messages and GitHub intake writes in separate stores
- migrates only GitHub runner state from the legacy shared SQLite store
- does not re-import legacy state over newer GitHub-mode state
- fails within the configured bound when the GitHub-mode store is locked

## tests/github.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- classifies GitHub issue number not found errors
- does not classify unrelated gh failures as issue not found
- identifies GitHubIssueNotFoundError instances
- builds safe gh argument arrays for issue summary discovery
- builds safe gh argument arrays for issue detail fetch and comments
- parses GitHub release asset URLs and rejects non-release URLs
- builds safe gh argument arrays for authenticated release asset download
- accepts GitHub issue shapes with OPEN or CLOSED state and rejects unknown states
- terminates a hanging gh command attempt after its timeout

## tests/goal-ledger-state.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- loads a missing state file as an empty ledger
- saves and loads valid state atomically
- fails closed on malformed or unsupported state files
- preserves the old ledger when temporary file writing fails
- preserves the old ledger when rename fails
- serializes overlapping entry saves without stale snapshot overwrites
- releases the entry lock after timeout or abort

## tests/issue-dispatcher.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- skips dispatching an issue that is already in flight
- folds each job result as soon as it completes without waiting for slower jobs
- removes a crashed job from the in-flight set so the issue can be dispatched again
- does not demote in-flight issues when enforcing the active issue limit
- folds dead-lettered job results
- folds failed job results
- derives the issue key from either job shape

## tests/issue-media.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- extracts image and video references from GitHub-flavored issue text
- filters SVG issue input references across supported syntaxes
- appends prepared media manifest to prompts

## tests/issue-worktree.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- creates a role-free issue worktree on first run
- reuses an existing issue workspace without rebuilding when main has advanced
- lazily migrates a legacy dev context without moving the worktree
- times out a hanging git fetch and releases the repo lock for another issue
- times out a hanging merge-base check when reusing a workspace
- fails closed when an existing workspace context points at a missing worktree
- builds sanitized branch names

## tests/local-config.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- uses an empty repository whitelist when config.local.toml does not exist
- parses TOML repository whitelist entries
- treats a pure-comment config as an empty repository whitelist
- loads config.local.toml from disk
- loads config.toml defaults and lets config.local.toml override them

## tests/media-assets.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- downloads and validates images and videos into the run directory
- downloads GitHub release assets through the authenticated gh downloader instead of anonymous fetch
- still enforces size limits for GitHub release assets
- reports gh download failures for GitHub release assets
- reports media preparation failures instead of silently dropping bad media
- discovers explicitly referenced worktree artifacts and formats preview markdown
- does not publish unreferenced worktree artifacts
- rejects absolute and escaping artifact references

## tests/observer.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- shows a no-records state when whitelisted repos have no state files
- renders ledger goal tree, unassigned tasks, task details, gates, evidence, and filtered goals
- keeps the tree available for owner-level no-active and multiple-active phase errors
- distinguishes exact roundtable child notes from near-miss text without rendering hidden keys
- keeps legacy issue runs visible when the ledger is malformed
- times out goal ledger reads while keeping legacy issue runs visible without gh or codex
- keeps valid manifest records while diagnosing malformed JSON, missing fields, and truncated tail lines
- aggregates whitelisted issue sources and renders published and unpublished artifacts
- renders project issue DAG, selected run details, intake outcomes, and token cache diagnostics
- diagnoses malformed local config without reporting all repos as no records
- serves the page without modifying files or invoking gh and codex

## tests/retry.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- classifies GitHub network blips as transient
- classifies client-side and auth failures as deterministic
- defaults unknown gh runtime failures to transient
- retries transient failures and eventually succeeds
- does not retry deterministic errors
- rethrows the original error after retries are exhausted
- stops retrying once the abort signal fires

## tests/runner.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- removes closed active issues without processing triggers or comments
- records fetch failures as failed without advancing the intake cursor
- runs changed issue jobs through the injected driver pool without serializing them
- passes prior active intake state into changed issue jobs so fallback routing stays active-only
- passes prior idle intake state into changed issue jobs without enabling fallback routing
- dedupes duplicate issue jobs within a heartbeat
- keeps later heartbeats scanning and dispatching while a job runs long
- posts a dead-letter comment and records dead-lettered when the failure retry budget is reached
- dead-letters sustained GitHub fetch failures without interrupting heartbeat dispatch
- keeps retrying when dead-letter posting fails
- does not post a dead-letter comment when processing recovers on the budget round
- pins the default concurrent limit at 5 to guard against silent bumps
- caps the default codex driver pool at 5 concurrent jobs
- isolates a hanging job so other slots stay usable
- folds a Codex idle-timeout into a failed outcome and releases driver pool capacity
- keeps the GitHub max-duration watchdog and folds its structured terminal into a failed outcome
- keeps a structured Codex crash on the ordinary GitHub retry path
- dead-letters a fifth structured Codex failure without advancing the role cursor
- recovers after a structured Codex failure without dead-lettering and advances the role cursor once
- generates unique run directories for the same timestamp and message count
- does not treat bundled runner-child output as src/runner.ts direct execution
- adds an eyes reaction to the issue before running Codex when issue body triggers
- adds an eyes reaction to the latest comment before running Codex when comment triggers
- continues running Codex when adding the reaction fails
- passes preScript Codex cwd to the secretary Codex run
- passes workspace Codex cwd and prompt context to a workspace-capable agent
- returns a failed outcome when workspace preparation fails before Codex
- fails closed after one resume call and does not add a second reaction
- rejects an unavailable role thread before Codex can create a replacement
- fails the turn, retries thread-state persistence, and never starts full again
- does not post a stale Codex result when a new comment arrives before posting
- passes prepared issue images and media manifest to Codex
- posts a media preparation error without running Codex or saving role state
- publishes output artifacts before CEO sees the final response
- writes a run manifest with an empty artifacts array when no artifacts are discovered
- posts an artifact publishing error without saving role state
- does not let manifest writer failures block comments or role state
- does not let manifest writer failures block artifact error comments
- returns a failed outcome with the pre script reason before any comment is posted
- does not nack after the first visible agent comment has been posted
- fails open and still posts the Codex result when the final interrupt check hits a transient gh error
- does not add a reaction when no Codex driver will run
- posts a visible fail-closed comment when the CEO ledger prescript fails
- posts a visible fail-closed comment when CEO orchestration context reload fails after Codex
- runs CEO spawn orchestration through the GitHub adapter and writes a child ledger ref
- runs goal-intake propose by writing pending ledger and publishing a hidden proposal key
- routes a plain CEO bootstrap goal to the default plan chain without child issue or ledger writes
- keeps no-mention plain goals as fallback-to-CEO then default plan-chain route without goal-intake side effects
- allows explicit split bootstrap to use goal-intake propose without default-plan-chain or child issue creation
- recovers goal-intake confirm from an active phase with missing child refs by hidden key
- settles with a visible fail-closed comment when createIssue never settles
- includes the created issue URL when ledger child ref saving times out
- returns failed when fail-closed comment publishing also fails and preserves created URLs in the reason
- does not create a duplicate child issue when the ledger already has the orchestration key
- recovers an existing child issue by hidden orchestration key before creating a duplicate
- starts a CEO roundtable by creating a child issue and saving a bounded roundtable ref
- includes the roundtable child URL when ledger ref saving times out after creation
- bounds roundtable hidden-key lookup before creating a duplicate child issue
- routes the next roundtable participant with one handoff mention and a forced CEO-return instruction
- recovers a roundtable participant no-handoff once and suppresses duplicate recovery for the same comment
- intercepts a roundtable participant handoff to a non-CEO role before the target role runs
- fails closed instead of completing a roundtable before all participants have spoken
- dedupes parent roundtable summaries with a stable completion key when CEO retries with changed wording
- integration acceptance prepass posts one parent request only after every ledger child has passed
- integration acceptance prepass leaves parent untouched when some in-scope child is not passed
- integration acceptance parent request publish failure returns failed without recording requested
- integration acceptance prepass records failed child acceptance before a handoff mention triggers dev
- integration acceptance parent failure creates a repair child and suppresses a ceo handoff mention
- integration acceptance fail-closed is visible on the child issue when parent ref is missing
- integration repair hidden key lookup timeout is bounded and does not create duplicate repair issues
- routes the latest external no-mention comment on active issues with a CEO append envelope
- records no_action fallback routing without posting a comment
- routes an obvious no-mention issue body goal with a bounded body digest key
- returns failed when target handoff publishing fails before recording a route decision
- records fail_open fallback routing without posting a comment
- does not re-run fallback routing for the same comment id
- does not fallback-route idle comments or runner metadata comments
- bounds a never-settling fallback route call through timeout injection and suppresses the second pass by comment id
- runs CEO guardrail for every Codex agent response
- passes full public issue context to CEO with comments in order
- posts CEO repaired text with correction metadata after role metadata
- posts CEO fail-open original text with review metadata and without correction metadata
- posts dev original + independent CEO comment when CEO returns APPEND as=ceo
- impersonates dev and posts a second dev comment when CEO returns APPEND as=dev
- does not run CEO or post comments for stage-only agent comments
- posts one CEO format reminder when a pass-claiming walkthrough cannot be parsed
- caps the format reminder at two per issue and falls through afterwards
- does not post a reminder for reviewer comments without an overall pass conclusion
- does not treat a narrative statement reference without a verdict as a walkthrough line
- reports a blocked join on the parent when a missing child issue is closed
- dedupes the blocked report by hidden key on the parent issue
- fails open and keeps waiting when the child state query fails
- routes an agent-authored naked comment on an unclosed ledger child through the CEO fallback
- records a deterministic no_action for agent comments when the ledger child already passed
- does not trigger the agent-authored branch for issues outside the ledger
- does not re-judge an agent-authored comment id that already has a route decision

## tests/runtime-start.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- defaults to local and accepts only the exact GitHub flag
- starts a clean local console without preparing or creating GitHub runtime
- starts only the GitHub runner when GitHub mode is explicit
- does not create either runtime when startup arguments or migration fail
- cold-starts pnpm start without repositories or GitHub authentication
- exits non-zero for a non-exact GitHub flag before starting a runtime
- accepts the documented pnpm GitHub-mode command without starting local console

## tests/scanner.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- returns changed issues and records the scan time
- does not clobber state mutations that land while the issue list fetch is in flight
- continues scanning the remaining repositories when one repository fails
- skips repositories that are not due yet

## tests/sqlite-state.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- rolls back failed source imports and retries without a successful marker
- leaves legacy JSON untouched after migration while saving all state sources to SQLite

## tests/state-persister.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- applies mutations synchronously and exposes the latest state
- coalesces consecutive updates into at most two saves
- keeps running after a save failure and retries on the next update
- flush resolves after all scheduled writes settle

## tests/state.test.ts

处置：产品契约删除：被测 GitHub runner / observer / Desktop child 能力已退役。

- returns an empty store when the state file does not exist
- saves and loads role thread state
- fails safely on invalid state shape
- merges concurrent entry saves without overwriting other roles
- migrates legacy issue role threads without sharing thread ids across issues

## tests/triggers.test.ts

处置：shared 模块裁剪：删除 runner 专属契约，local 行为另有保留/替代。

- runs the mentioned agent through the mention trigger
- runs secretary through the ordinary mention trigger
- does not run reflector after the reflector role is removed
- runs CEO through the ordinary mention trigger
- does not run an agent when the latest mention is only inside a fenced code block
- does not run an agent when the latest mention is only inside inline code
- does not post a hook when an agent emits plan-written without a mention
- uses ordinary mentions in agent messages after stage hooks are removed
- ignores unsupported stages when there is no mention

## tests/goal-ledger.test.ts

处置：归档后可达性复核确认被测纯模块已无 local 生产消费者；模块及独立产品域随 GitHub runtime 退役，
不存在可保留的运行时接缝。

- admits partial goals as draft or pending with missing fields and provenance
- marks a goal ready only after required fields are present
- writes a pending goal-intake bundle without exposing active phase context
- treats identical goal-intake proposals as idempotent and conflicts as fail-closed
- confirms a goal-intake proposal into ready entries and a single active phase
- validates entity references and ready invariants
- accepts run manifest refs only when linked refs have a stable locator
- computes missing dependencies by field presence so an empty confirmed list is valid
- phase switch archives old active phase and starts the target phase with timestamps
- phase switch fails closed without archive inputs and records explicit no-artifact archives
- phase switch is a deterministic no-op when the target phase is already the only active phase
- active phase context projection excludes old artifacts and uses the phase baseline
- archived lookup returns completed phase summaries and references separately from current context
- phase context fails closed for multiple active phases and returns no-active without fallback
- old T1 phase records parse but projection and switch fail closed without current fields
- different owners can each have one active phase while the same owner cannot have two
- typed artifact references accept bounded summaries and locators while rejecting unsafe payloads
- upserts child acceptance facts by a stable source key so repeated comments do not change join digest
- evaluates integration acceptance join only when every in-scope child has a passed fact
- records integration acceptance events idempotently by join key and status

## 保留与替代的 local/shared 接缝

- `tests/local-console-compat-project-visibility.test.ts` 删除参数化展开用例
  `keeps the compatibility project visible when 'session_role_threads contains history'` 与
  `... 'session_agent_contexts contains history'`：local 明确忽略退役 GitHub facts；RA-30D 负责证明旧表
  原样保留，不再用其内容驱动 local project 可见性。

- local CLI：tests/runtime-start.test.ts 保留并重写为 3 条外部行为，覆盖 local 冷启动、--github-mode 可读 fail-closed、未知参数 fail-closed。
- local 路由：tests/local-route-judgment.test.ts 新增 3 条纯行为，覆盖 no_action、单 mention append 与非法输出拒绝；替代 format-ceo 的本地消费面。
- CEO child orchestration：tests/ceo-orchestration.test.ts 保留 9 条 parser/local descriptor 行为；GitHub issue 渲染与副作用测试删除。
- SQLite 动态 worker：tests/sqlite-state-worker-pool.test.ts 保留 6 条并发/错误/恢复行为，tests/sqlite-state.test.ts 保留 local canonical lane；GitHub command 与 migration 用例删除。
- conversation 与 triggers：tests/conversation.test.ts 和 tests/triggers.test.ts 保留 local timeline、latest-message mention、code-block ignore 与 unavailable-role 行为。
- local config 与 persona：tests/local-config.test.ts 保留 legacy repository 字段的校验后忽略，tests/agent-manifest.test.ts 保留 persona body 与退役 metadata 不暴露。
- Desktop local topology：desktop main/status/onboarding 与 console-ui 的既有测试改为只断言 local console、provider 环境、数据目录与更新入口；runner/observer 字段不再存在。

这批没有把 GitHub 集成用例降级成纯单测：产品契约已删除的用例按名剪枝；仍有 local 消费者的分支先保留或建立等价 local 行为测试，再删除旧 runner 断言。
