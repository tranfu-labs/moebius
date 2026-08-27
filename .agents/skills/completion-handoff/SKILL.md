---
name: completion-handoff
description: >-
  Prepares an evidence-based closeout handoff for a genuinely completed local
  repository task. Use when an Agent should ask the user to choose merge
  guidance, worktree/file guidance, tested evidence, or continued editing
  through the form capability already exposed by the runtime. Do not use for
  progress updates, automatic Git or file mutations, releases, or unfinished
  work.
---

# Completion Handoff

Use this Skill to turn a genuinely finished task into a safe, user-selectable
next step. The Skill defines the decision flow; the runtime's already available
form capability supplies the user-facing form. This Skill does not add an MCP
server, define MCP tool names, or perform Git, filesystem, or release actions.

## Trigger and evidence

Use the Skill only when all of these are true:

- The task has reached its intended implementation or investigation endpoint.
- The Agent has concrete evidence from commands, tests, builds, runtime checks,
  or links. A missing result must remain explicitly `未验证`.
- The user needs a next-step decision after completion.

Words such as “验收”, “通过”, or “完成” are not runtime evidence. Preserve
failures, skips, and unverified checks exactly as observed.

Before presenting the form, assemble a compact fact set containing the task
summary, changed files, actual commands and output summaries, tested links,
current branch/worktree facts, and unresolved items. Read branch and worktree
facts with read-only commands. Do not claim a branch, link, or result that was
not observed.

## Form flow

When the runtime exposes its existing form capability, use that capability to
inspect or collect the current facts and then present one form with these four
mutually exclusive categories:

1. **Git branch guidance** — explain a squash-merge next step. If an actual
   local `dev` or `origin/dev` ref exists, prefer `dev`; otherwise use the
   actually observed `origin/main` ref as the fallback. A missing ref stays
   unavailable rather than being invented.
2. **Files/worktree guidance** — explain the next step for detaching the
   worktree mapping and moving the worktree to Trash. This is guidance only;
   do not perform either action.
3. **Tested links or evidence** — show only links and evidence that were
   actually tested or observed, with failures, skips, and `未验证` status.
4. **Continue editing** — return to the existing task while retaining the
   recorded evidence and gaps.

Use the form capability actually advertised by the current runtime; do not
guess a tool name, fabricate JSON, or replace a required form question with a
normal chat question. If the existing form capability is unavailable,
uninitialized, or rejects the request, report that exact limitation and stop
the form path.

A submitted selection is user intent for routing only. It does not mean that a
merge, push, worktree removal, Trash move, or release has happened. Continue
through a separately authorized workflow only after the user has chosen a
direction.

## Provider availability

Moebius publishes this source Skill through provider-standard user Skill
directories for Claude Code and Codex. Their native loading should discover
frontmatter first and read this full `SKILL.md` only when the Skill is selected;
supporting files, if any, remain on demand. The projection must not modify
provider settings, credentials, hooks, or project configuration, and an
existing user entry must not be overwritten.

Kimi and Pi are outside the current native projection scope and remain TODO.
Until their native projection exists, their prompt fallback may carry the same
boundary and safety rules, but it must still use a form capability when one is
actually exposed.

## Failure and safety rules

- Incomplete evidence is reported as incomplete; never convert it into a
  successful closeout.
- Branch and worktree inspection is read-only.
- Never execute merge, push, worktree removal, Trash moves, release, or a
  user-provided command as part of this Skill.
- Never use shell background escape mechanisms. Long-running supervised work
  follows the Moebius managed-process contract.
- Keep source facts separate from conclusions and preserve the exact status of
  every check.

## Examples

User: “测试和构建都完成了，结束提交时用表单让我选合并、清理 worktree、看实测链接还是继续改。”

Agent: Verify the real outputs, inspect read-only branch/worktree facts, use the
runtime's existing form capability for the four bounded choices, then stop for
the user's selection.

User: “任务差不多好了，直接帮我 squash merge 并删掉 worktree。”

Agent: Do not perform those side effects from this Skill. Present the bounded
guidance choices only after completion evidence is available.

## Acceptance checklist

Before submitting the handoff, check that:

- every command, link, failure, skip, and `未验证` item is represented;
- exactly the four bounded categories are offered;
- branch guidance reflects observed refs;
- the runtime's existing form capability and any error are explicit;
- no Git, filesystem, release, or background-process side effect occurred.
