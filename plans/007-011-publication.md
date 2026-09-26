# Plans 007–011 — owner-authorized publication before final browser acceptance

## Current authorization

The owner explicitly requested: **“push everything to main and then continue with browser verification.”** This supersedes earlier no-push and browser-before-merge restrictions for this publication. It does not waive honest reporting, data/security boundaries, or the remaining browser verification itself.

The repository's existing default branch is **master**, not main: `git ls-remote --symref origin HEAD refs/heads/main refs/heads/master` returned HEAD → refs/heads/master at `95594c4f9d0900ff76dae861f56e73dced631aac`, with no main branch. Publish to the existing `origin/master`; do not rename/create a main branch or change repository defaults.

Outcome: publish the reviewed fixes/history/search stack and all current planning records, then resume actual Orca browser verification. A separate Pi executor owns integration/commit/push. The advisor will not write concurrently during this task.

## Inputs / scope

- Original checkout: `/home/alex/Work/GenUIExperiment`, branch master at `95594c4f9d0900ff76dae861f56e73dced631aac`.
- Reviewed stacked feature: `1796ccfb1951a2ec6af8dd71a9a2476cd67e2b65`, branch improve-reference-search, clean checkout `/home/alex/orca/workspaces/GenUIExperiment/improve-reference-search`.
- That tip contains accepted fixes `d23e17e` and history `50ce566`; do not cherry-pick or merge all feature branches redundantly.
- Master differs from the common baseline `058e883d709dd384b7ebc66d81c60bf119609197` only by owner AGENTS.md commit requiring the Orca browser. **Preserve AGENTS.md byte-for-byte from 95594c4**.
- Reviewed feature changes: README.md, docs/object-contract.md, docs/quickstart.md, public/objects.css, src/objects/client.ts, http.ts, model.ts, render.tsx, runtime.ts, test/objects-http.test.ts, test/objects-runtime.test.ts. No new application edits are authorized.
- Current uncommitted scope is `plans/README.md` plus plans 007–011 and their integration/browser/review/execution/publication records. Preserve every record, including historical failed attempts; only minimal current-status documentation updates are allowed if needed.
- Do not publish ignored files, `.data/`, temporary artifacts, credentials, other branches/tags, or unrelated changes. No reset, force push, branch/worktree removal, dependency upgrade, provider call, or real-data smoke server.

## Executor procedure

1. Load current Orca development/CLI/orchestration guidance and README/AGENTS. Inspect task ownership and Git state; this task is the sole checkout writer. Confirm both expected hashes/branches and clean feature checkout. Capture names/status and hashes of existing planning files so accidental loss is detectable.
2. Fetch origin normally and verify its default branch and master remain at the expected `95594c4`. Stop on remote/local drift, unexpected files, stale lock/index/merge state, conflicts or uncertainty; do not force, reset or stash owner changes. Check credentials only through normal Git operations; never display secret values.
3. Inspect every pending plan's diff/content for unintended sensitive material before publication. Stage **only the explicit current planning-file list**, not blanket `git add .` or forced ignored paths. Commit those records with an accurate message indicating reviewed features and pending browser acceptance. All existing content must be preserved except clearly scoped status corrections.
4. Merge the exact reviewed stacked commit `1796ccfb1951a2ec6af8dd71a9a2476cd67e2b65` into master with a normal merge commit (no squash/rebase/history rewriting). Stop on conflict; do not improvise resolutions. Verify 1796ccf and 95594c4 are ancestors; AGENTS.md exactly matches 95594c4; application/docs files match the reviewed feature tree; no source modifications beyond that merge.
5. Run `bun run check`, `bun test` (expected 91 passing / 0 failing), `git diff --check 95594c4..HEAD`, and verify clean tracked/untracked status. Use Bun 1.4.2+ and existing dependencies; only if needed use `bun install --frozen-lockfile`. Never use real `.data` or real model calls.
6. Recheck remote master immediately before publication. If unchanged and checks pass, use a **normal explicit `git push origin HEAD:refs/heads/master`**, never force or `--all`. Verify `git ls-remote origin refs/heads/master` equals local HEAD. If rejected/uncertain, inspect and report; do not assume success or retry destructively.
7. Report exact planning commit/merge/remote hashes, files, checks, source/AGENTS preservation, final Git status, and any blocker. Keep all worktrees and branches. Send worker_done using the injected Task/Dispatch IDs. Do not start browser verification in this publication task; the coordinator will dispatch it against the published checkout afterward.

## Known browser limits (must not claim closed)

Strict TypeScript, all 91 tests, source diff review and hygiene passed independently on 1796ccf. Earlier accepted source/browser records are in plans/007-011-execution.md. The final Orca browser checklist remains in plans/011-final-browser-gate.md.

Most recently, a real Title click followed by trusted Tab moved focus to typeId; a searched out-of-window reference was selected through the real modal. Writing textbox click/type returned success without focus or content change, so that verification attempt stopped. This is unresolved interaction evidence, not a demonstrated product bug. Publication is now explicitly authorized **before** resolving it. Do not mark browser acceptance DONE merely because publication succeeds.
