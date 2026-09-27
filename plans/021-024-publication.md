# Publish the reviewed architecture hot-path changes

## Owner authorization

After the assistant asked “Shall I merge it into master?”, the owner answered **“yes and push”**. This supersedes the earlier no-integration/no-publication boundary for plans 021–024 only. The advisor still writes plans/reviews only; a separate Pi executor owns the authorized Git integration, record commit and normal push. No further application changes, schema/index additions, dependency upgrades, workspace redesign or real view generation are authorized.

The owner was told that updating main may restart their existing `bun --watch` server. The executor may advance the checked-out main branch, but must not interact with that server/terminal, request live application pages, read or modify `.data`, or stop/restart anything manually.

## Exact state inspected before dispatch

- Main checkout: `/home/alex/Work/GenUIExperiment`, branch `master`, HEAD `eb324c4e05ed73243dabc6242422baea4e855c67`.
- `origin/master` observed via ls-remote at the same `eb324c4`.
- Reviewed implementation: `c737ec82e357c09a019e21174c257cf0d432e9f2`, branch `alexradunet/architecture-hot-paths`, clean worktree `/home/alex/orca/workspaces/GenUIExperiment/architecture-hot-paths`.
- Accepted source spans five commits after eb324c4. Lead independently verified strict TypeScript, 134 tests, benchmark semantic equivalence and operation-count probes; see 021-024-accepted-review.md.
- Main has only the advisor's pending plans/README.md update and new 021–024 records plus **two unrelated owner drafts**: `plans/012-canonical-workspace-storage.md`, `plans/013-workspace-aware-application.md`.

## Scope and ownership

Run in a fresh Pi terminal in the **existing main worktree**, because updating that checkout is now explicitly authorized and no other writer is active. Do not take over the user's shell/watch terminal or the reviewed checkout's shell. Coordinator finishes its plan edits before dispatch and performs read-only verification thereafter.

The only newly committed record paths are this explicit allowlist:

- `plans/README.md`
- `plans/021-lazy-request-data.md`
- `plans/022-lightweight-reference-validation.md`
- `plans/023-target-first-reference-queries.md`
- `plans/024-reuse-unchanged-writing.md`
- `plans/021-024-execution.md`
- `plans/021-024-review-1.md`
- `plans/021-024-accepted-review.md`
- `plans/021-024-publication.md`

Do not add `plans/012-*`, `plans/013-*`, ignored evidence or temporary files. Never run git add -A, broad staging, stash, reset, force push, branch deletion or worktree cleanup. The application source and tests must remain byte-identical to reviewed c737ec8. Do not invoke the improve skill to re-audit; this is an explicitly authorized publication executor task.

## Procedure

1. Read the current AGENTS.md and this plan; use Bun 1.4.2+ and the checked-in lockfile. Verify main branch/HEAD/status and reviewed worktree status/HEAD. Record hashes of the two owner draft files without printing their contents. Verify the only pre-existing main changes match the allowlist and owner drafts. If anything drifted or another writer appears, STOP and ask coordinator.
2. Fetch origin normally and verify origin/master is still eb324c4 and an ancestor of c737ec8. Inspect the pending record files for accidental sensitive material, extraneous content or unsupported claims; do not print secrets. Do not mutate records except a narrowly necessary correction approved by coordinator. All publication wording is an authorization/checkpoint record, not a claim of a push that has not happened.
3. In the main checkout, run `git merge --ff-only c737ec82e357c09a019e21174c257cf0d432e9f2`. This preserves all reviewed implementation commits and avoids an unnecessary merge commit. Untracked owner drafts and the pending plans/README.md edit are not in the incoming code diff; do not move or stash them.
4. Run `bun run check`, `bun test`, and `git diff --check eb324c4..HEAD`. Expected: strict TypeScript succeeds, 134 tests pass, no hygiene failures. Tests use in-memory/owned temporary databases; do not run bun start or make requests to the live server. No reinstallation is needed when checked-in dependencies already work; stop instead of npm install.
5. Stage **only the nine allowlisted record paths**, inspect `git diff --cached --stat`, `git diff --cached --name-only`, and `git diff --cached --check`; ensure the staged changes are records only and no owner drafts entered the index. Commit with a descriptive message such as `Record architecture hot-path optimization review`. Verify application `src/`, `test/`, `scripts/`, `docs/`, `public/`, package.json, bun.lock and schema are identical to c737ec8. The record commit must have c737ec8 as parent.
6. Push normally: `git push origin master`. Never force/rebase over remote updates; a remote race is a STOP. After successful push, compare `git rev-parse HEAD`, `git rev-parse origin/master`, and `git ls-remote origin refs/heads/master`; all must identify the record commit. Verify c737ec8 is an ancestor, owner draft hashes are unchanged, and final git status contains only those two original untracked drafts.
7. Write a temporary report (not a new repository artifact after pushing) with STATUS, main/remote final SHA, source parent SHA, verification results, exact committed record list, draft preservation checks, deviations and any unverified items. Send worker_done once with the live Task/Dispatch IDs and explicit outcome, then stop. Coordinator performs independent read-only verification and native terminal release. Do not edit plan files after the commit/push just to record its own hash.

## STOP conditions

Unexpected branch/ref/dirty-file drift; missing reviewed commit; unrelated draft collision; changed original source; non-fast-forward remote; changed owner draft hashes; sensitive contents requiring removal before publication; failing tests; any need to change application code, auth/settings, server process or out-of-scope files. Preserve state and report the exact obstacle, never clean/reset your way past it.

## Record interpretation

This document and the top index update are prepared **before** publication. The executor's completion report plus independent equality of local master and the remote ref establish the actual result. Earlier isolated-review records remain valid historical evidence and do not override the later explicit owner permission above.
