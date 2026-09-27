# Publish the reviewed six SQLite priorities

## Authority and placement — 2026-09-27

The owner now requests **“let's commit and push.”** This supersedes the original no-push restriction only for the accepted six-priority SQLite stack and its planning/review records. The established default branch is `master`; the authorized destination is `origin/master` at `https://github.com/alexradunet/chesti.git`. Do not rename branches, create a PR, publish artifacts, or force-push.

The advisor remains source-read-only and delegates Git mutations to one separate Pi executor. A new isolated child is necessary: the original checkout has an owner-run `bun --watch src/server.ts` process, so updating its source could trigger a live database upgrade; the reviewed integration checkout also has a retained user-owned terminal. Neither existing checkout, terminal, server, nor user database may be changed. The original local `master` and uncommitted plan copies remain in place; they are not a second publication target. A later local source update requires coordination with that running application.

## Exact starting state

- Original checkout: `/home/alex/Work/GenUIExperiment`, `master` at `133f8a6fae62437085c758b064778605ef160833`.
- Remote `refs/heads/master`: independently observed at that same baseline before dispatch; recheck it before publishing.
- Accepted source branch: `alexradunet/sqlite-reviewed-integration` at **`cc46cae2bfb8eadb46ec70e49e5c3c238f3040d7`**.
- Reviewed checkout: `/home/alex/orca/workspaces/GenUIExperiment/sqlite-reviewed-integration`; inspect read-only only.
- The accepted tip descends from baseline and changes no `plans/` files. All source was independently reviewed; strict TypeScript and 128 tests passed, plus runtime/storage/benchmark diagnostics. This publication authorizes no additional source repair.
- The new child must start at exactly `cc46cae`; retain existing commits and branches. Skip the configured npm setup hook because the project requires the checked-in Bun lockfile. If dependencies are absent, use only `bun install --frozen-lockfile` in the new checkout.

## Authorized new commit paths

Copy the following files byte-for-byte from the original checkout to the new child, verify their source/destination hashes, and stage only these exact paths. Never use `git add .`, `git add -A`, or a broad directory/glob stage.

```text
plans/README.md
plans/015-019-integration.md
plans/015-020-execution.md
plans/015-020-publication.md
plans/015-browser-final.md
plans/015-lightweight-object-queries.md
plans/015-review-1.md
plans/016-sqlite-connection-hardening.md
plans/017-evaluate-sqlite-runtime.md
plans/018-canonical-schema-invariants.md
plans/018-review-1.md
plans/019-review-1.md
plans/019-review-2.md
plans/019-storage-and-backup-verification.md
plans/020-accepted-review.md
plans/020-authorized-repair.md
plans/020-final-review.md
plans/020-review-1.md
plans/020-review-2.md
plans/020-sqlite-query-experiments.md
```

Do not edit these copied records or the index: the advisor owns them. Earlier no-push statements are historical checkpoints; the current index and this publication authorization explain the transition. Review records remain truthful, including rejected intermediate benchmark reviews.

**Exclude and preserve** the pre-existing owner drafts `plans/012-canonical-workspace-storage.md` and `plans/013-workspace-aware-application.md`, and all `.agents/`, user data, environment files, credentials, logs, temporary evidence and other unrelated content. Original owner-draft SHA256 values:

- 012: `aa743e762fb15855dcc4295c2a24edf667fed7b0c3983e90eb057a19033e3383`
- 013: `3c237bcc48b858380da914bccccbd9c50930337fdac752120799b50af1bcea14`

## Procedure and verification

1. Read `AGENTS.md`, `README.md`, `docs/object-contract.md`, and the local `orca-development` skill. You are the assigned publication executor, not the improve advisor. Confirm exact branch/path/HEAD, a clean new child, original HEAD, accepted source HEAD and normal origin URL. Do not inspect `.data/` or run the app.
2. Fetch only normal origin refs, without prune or a history rewrite, and require remote master still equals baseline and is an ancestor of the accepted tip. If drift, unexpected changes, sensitive material or any other scope ambiguity appears, STOP and report. Never reset, stash, clean, rebase, amend, force-push, change Git configuration, or override hooks to get through a gate.
3. Copy only the twenty listed records from the original checkout. Verify exact bytes and inspect the complete staged diff for unrelated/sensitive content. Keep plans 012/013 unchanged and untracked in the original checkout. No new tests or source edits are authorized.
4. In the isolated child run `bun run check`, `bun test`, and `git diff --check 133f8a6..HEAD` plus staged whitespace checks. Expect strict TypeScript and **128 tests / 0 failures**. Tests use isolated/in-memory fixtures; no app server, paid/provider call or real-data benchmark. Retain actual command output in an owned temporary report directory, not in Git. Installation must not change package or lockfile.
5. Commit only the scoped planning/review records, with a clear SQLite review-record message. Verify the commit parent is exactly accepted `cc46cae`, the delta consists only of the twenty listed paths, every non-plan path is identical to `cc46cae`, and the new checkout is clean. Check original/master and both owner-draft hashes remain unchanged.
6. **Before pushing, use the native blocking `orchestration ask` to report the candidate commit, checkout, verification and report path and ask the coordinator for the final pre-push review.** Do not publish until the reply explicitly approves the exact candidate. This is one assignment with a review checkpoint, not another implementation round.
7. After approval, recheck the candidate HEAD, clean status, original HEAD and current remote master. Push the exact candidate normally with `git push origin HEAD:refs/heads/master` (no tags, other branches or force). If remote drift or a rejection occurs, STOP and report; do not merge unseen remote work automatically.
8. Verify the authoritative remote with `git ls-remote --heads origin master` equals the candidate commit. Verify local isolated HEAD/status, unchanged reviewed tip/original master/owner draft hashes, and no modifications outside this task. Do not update original local master or remove its pending files just to make it look clean. End with the completion report and native `worker_done`, then idle; lifecycle cleanup belongs to the coordinator.

## Retained boundaries and report

Native beforeunload-dialog cancellation remains **unverified** under the owner's prior continuation exception. This publication does not close or reopen that browser work. The completed benchmarks do not authorize production expression-index, reference-query, FTS, JSONB or deep-pagination adoption. Workspace plans remain unimplemented; their proposed format/version must be reconciled before future execution.

Report `STATUS: COMPLETE | STOPPED`, exact commit/remote hash, commands/results, paths added/modified, deviations/blockers, and original checkout preservation. Distinguish an actual successful push from a prepared local commit. The checked-in authorization is prepared before publication; the executor's report, remote ref and final coordinator response establish the actual publication outcome, avoiding a circular commit-hash claim in this file.
