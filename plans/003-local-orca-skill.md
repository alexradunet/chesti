# Local Orca skill; retire separate package repository

Status: DONE. Owner explicitly approved on 2026-09-26 after recommending one local skill plus project rules, and archiving the public experiment rather than maintaining a package repository.

## Outcome and smallest scope

- Create one standalone, concise `~/.agents/skills/orca-development/SKILL.md` alongside existing Orca discovery skills. No symlink or dependency on a repository/package; no scripts/build/config changes.
- Point to current native Orca guides, leave process/tools/concurrency choices to the lead within authorized scope, keep safe ownership/review/mailbox/cleanup rules. State bounded native waits while work is pending; do not promise automatic idle wake.
- Add only a short development-workflow paragraph to Taskdesk `AGENTS.md`. Preserve existing application safety and embedded Pi isolation. Leave the edit uncommitted; do not stage unrelated untracked files.
- Update public pi-orca README to clearly retire the experiment and stop recommending package installation, then commit/push that documentation-only update normally and archive exactly `alexradunet/pi-orca-subagents` using GitHub's archive operation. Retain repository history, local checkouts and all worktrees.

## Verification / authority

Taskdesk base `2403c1a`, tooling main `cdc68142fde64bc35da0faa26ada073452ac1acc`; both initially have no tracked diff. Taskdesk has pre-existing untracked `.agents/`, `plans/`, `skills-lock.json`. Local target skill absent at preflight; GitHub repository currently not archived.

One Orca executor owns the changes. Parent remains advisor/reviewer. Existing isolated `skills-first` checkout may be fast-forwarded to main before README editing if clean; integration/push and GitHub archive are explicitly authorized. No force/reset/delete. Stop on unexpected drift, name collisions or failed/uncertain mutation; inspect rather than blindly retry.

Validate YAML and actual provider-free Pi skill discovery; verify project instruction diff, no package/global-setting changes, local/remote hash and `isArchived: true`. No application code changes, model smoke test, full runtime test matrix or package migration required. Existing coordination packages stay installed; removal is a separate unresolved decision, not implied by repository retirement.

Current Pi skills docs confirm `~/.agents/skills/<name>/SKILL.md` is automatically discovered on startup. Restart or reload existing Pi sessions to refresh the available-skill list.

## Delivered and independently reviewed

- Executor `task_282e5bc614e5` / `ctx_912ac69a8b08` created the 28-line standalone local skill and the single Taskdesk instruction paragraph. No Taskdesk commit; no application code/data changes.
- Only archived-repository README changed in `68304667c1ffd04fd2e575cab31fcd6bc6e2541b`. Main and remote match, local tooling checkout clean. Parent verified GitHub `isArchived: true` for the exact repository. All checkouts/history preserved.
- Real YAML parse passed. Fresh offline Pi RPC `get_commands`, without prompts/provider calls, returned exactly one `skill:orca-development`, with `sourceInfo.path` pointing to the new local file, `source: auto`, `scope: user`. Parent independently reproduced discovery. Its first checker assumed the older top-level `path` field documented in RPC examples and raised `KeyError`; inspecting the actual response confirmed the nested `sourceInfo.path`, not a skill load defect.
- Both diffs reviewed and `git diff --check` passed. No package settings/install/removal, credential reads, new runtime, scripts or dependencies. No application suite was run for instruction/documentation-only edits.
- Worker released normally: `closed_agent_terminal`, captured archive. Receipts: `plans/evidence/local-skill-archive-*`. Executor report: `/tmp/task_282e5bc614e5-report.md`.
- The earlier idle-wake and runtime cleanup discrepancies remain historical facts, not fixed or retested by archiving the repository. Legacy package removal remains separate from this completed scope.
