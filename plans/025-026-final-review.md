# Favorites/day workspace final review — BLOCKED

2026-09-27. Source tip `14dc6beb8ba06b92adba9ddd33b96f718b96a43c`, branch `alexradunet/day-workspace`, isolated `/home/alex/orca/workspaces/GenUIExperiment/day-workspace`. Original checkout remains `ce30958`; no merge/push or real application database access. Original owner drafts 012/013 untouched.

## Result
Two allowed review-repair rounds exhausted. **BLOCK**, not accepted/ready to integrate. Executor's final report says no remaining blockers, but independent source and real browser review contradict it. Plans and partial implementation remain preserved for a separately authorized focused continuation; no third repair has been dispatched.

## Verified
- Independent `bun run check`: PASS.
- Independent `bun test`: **149 pass, 0 fail**, 16 files.
- `git diff --check ce30958..HEAD`: PASS; worktree clean.
- Full baseline-to-tip diff examined, within original plan source/test/docs allowlists; no dependencies, generator/Pi boundaries or view command permission changes.
- Initial bugs: save redirect 422 and non-idempotent create retries were reproduced, then fixed. Native moved-journal retargeting was reproduced after first repair, then submitted identity retained in second repair.
- Default no-date Calendar/Journal 422 introduced by first repair's four-digit month was fixed in second repair, with regression test.
- Favorite invalid-return-context persistence fixed; schema preservation full logical row assertion restored.
- Orca device emulation is available: `orca set device --name 'iPhone 12' --page <id> --json` after page navigation yields innerWidth/screen.width 390. Earlier claimed responsive tooling blocker is obsolete.
- Opened executor screenshots `/tmp/taskdesk-r2-calendar-dirty.png` and `/tmp/taskdesk-r2-responsive.png`. Desktop shows new sidebar/day journal/month rail. Mobile capture has duplicated viewport bands; it is not reliable proof of the complete narrow flow or focus. No blanket responsive/keyboard acceptance.

## Remaining blockers with evidence

### 1. Enhanced stale-save recovery still unusable (confirmed Orca browser)
`render.tsx` creates `[data-conflict-panel]` only after a conflict. Initial Calendar DOM has no placeholder. `client.ts` replacement requires both nextPanel and currentPanel; currentPanel is null on the first failed save.

Independent actual browser flow at synthetic server `http://127.0.0.1:37061`, reviewer page `ed322795-6dee-4447-b3f8-183c9d77d7c8`:
1. Load `/calendar?date=2026-09-27`, initial journal revision 1.
2. Same-origin fixture fetch saves new body with revision 1, returning 200 after successful redirect. Original loaded page remains stale.
3. Orca snapshot identifies actual Save journal button; trusted `orca click --element @e62` submits it.
4. Wait for `This journal changed` succeeds.
5. DOM inspection returns error `This journal changed. Compare the latest saved writing with your draft before saving.`, original revision `1`, `panel:false`, `reconcile:false`.

Saved concurrent data wasn't overwritten, but user cannot perform the advertised recovery without leaving/copying draft. Fix requires a persistent conflict placeholder or explicit installation behavior preserving live writing and identity. Add browser regression of first stale save, explicit reconciliation, and second concurrent conflict; don't treat server-only conflict markup tests as enhanced acceptance.

### 2. Correctable rejected creation loses Save
All calendar POST errors set `dayJournalDraft.safeConflict = false` unless they are safe 409 same-object updates. Renderer treats false as unsafe target and replaces Save with Reload, also removing enhancement hooks. Independent in-memory route probe: new-day empty body with valid request UUID => 422, **no Save journal**, only Reload selected day. User cannot correct blank input and save normally. Distinguish ordinary validation errors retaining valid create/update mode from genuinely unsafe identity/date/type/trash changes. Keep draft and request UUID, writing editor and Save for correctable input.

### 3. Original revision validation missing on reconciliation
HTTP chooses `reviewedRevision` without validating original `revision`. Probe update body with objectId and reviewedRevision=1 but **no original revision** => 303 and saved content changed. Existing project conflict contract explicitly requires both to be valid. Validate original separately; preserve it in errors. The requested regression test is still absent.

### 4. Scope/verification incomplete
- Shared writing markup is still duplicated as a long single-line second implementation despite both review requests. Need coherent reusable writing component and readable JSX, not another editor path.
- Genuine v4→v5 successful upgrade with original structural/built-in guards is not permanently tested. The new test changes a v3 fixture's metadata to 4 and tests only reserved-ID failure. Add actual old v4 fixture and preservation/reopen protection checks.
- Narrow layout CSS moves month rail below content instead of collapsing it as agreed; keyboard/nav/assistant and enhanced editing/save/conflict evidence is incomplete. Calendar exists twice in sidebar (top action and nav item), though intended simplified navigation.
- Dirty warning says save or discard but provides no discard action; generic object favorite guard refers incorrectly to journal/calendar. Date GET form relies on beforeunload rather than the explicit calendar guard and remains unverified.
- Favorites empty screen/title still reuse Search wording. Minor stale demo Journal navigation prose and backup docs' unqualified unchanged revisions claim remain.
- Extreme date bounds need correct numeric timestamp comparison on expanded +010000-year end (currently lexicographic ISO created-at bound); lower-priority but original supported-date tests don't cover actual query at upper bound.

## Executor resources / evidence
Single Pi terminal `term_05f61b14-f587-4d79-a459-fa27f22c97be` in isolated child. No Tasks/Dispatches were created; simple terminal supervision. Commits: `b0c2886`, `742c7f1`, `cf8e2ca`, `14dc6be`.
Reports: `/tmp/taskdesk-025-026-revision-1-report.md`, `/tmp/taskdesk-025-026-revision-2-report.md` (claims subject to independent corrections above).
Final synthetic server reported PID 217836, port 37061, DB `/tmp/taskdesk-smoke-r2-pYAihQ/smoke.sqlite`; executor browser page `0ecf7123-96e4-4851-a2a6-2275275dbbc7`. Cleanup-only request will stop owned synthetic servers and close owned tabs without deleting worktree/history or making source edits. Cleanup completed: executor reports stopped owned PIDs 217836/217839 and 214470; lead independently confirms reported parent PIDs 210304/214470/217836 absent and child-worktree browser tabs empty. Executor closed its two fixture tabs; lead closed reviewer page with successful Orca response. Worktree remains clean at `14dc6be`, original HEAD `ce30958`; evidence/temporary DBs preserved. Executor terminal left idle, no further source work queued.

## Safe continuation
Ask owner before further repair. If authorized, one separate executor may fix the specific remaining items on the preserved branch, with no live checkout or data access. Required acceptance: native correctable failure/retry, unchanged original identity on conflicts, original+reviewed revision validation, actual enhanced conflict roundtrip, real v4 migration preservation, readable shared editor markup and truthful browser responsive/keyboard evidence. Only after accepted review should owner decide integration/publication; this task grants neither automatically.
