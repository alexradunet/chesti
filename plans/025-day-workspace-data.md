# Plan 025: Persist favorites and query a canonical day workspace

> Executor: implement in an isolated Orca worktree only. Read this entire plan and repository AGENTS.md before working. Run each gate. Reviewer maintains plans/README.md. STOP on drift, unsafe data assumptions, or out-of-scope requirements.
> Drift check: `git diff --stat ce30958..HEAD -- src/schema.ts src/objects/model.ts src/objects/runtime.ts src/objects/values.ts test/objects-schema.test.ts test/objects-runtime.test.ts`

## Status
- Priority: P1
- Effort: M–L
- Risk: HIGH (preserving schema upgrade)
- Depends on: none
- Category: direction
- Planned at: `ce30958`, 2026-09-27

## Outcome and decisions
Taskdesk's owner wants New note / Calendar quick actions, one Objects entry instead of the sidebar type list, explicitly favorited objects, and a date workspace with journal, tasks and objects created that day. Tasks match **scheduled OR due** on the selected date, with one row and Scheduled/Due/both indicators. Plan 026 supplies that UI; this plan provides data foundations.

Use the existing Page type for generic notes and existing Journal identity/date uniqueness. Do not invent a Note type or secondary daily-document storage. Favorites are shared workspace metadata in SQLite (single owner), not object properties or per-visitor authentication. Favorite changes do not modify object revision, writing or timestamps. Existing browser-local pinned views remain separate and preserved.

The calendar's today and created-day grouping use the server's local timezone consistently, including native forms. Display the timezone in Plan 026. Existing standalone `/journal` browser-local behavior need not change. Dates are real YYYY-MM-DD values. Created-day range is local midnight inclusive to the next local midnight exclusive, converted to UTC for canonical ISO timestamp comparison; do not add 24 hours across DST. Task date properties are date-only, not timestamps. No recurring tasks, overdue inclusion, task subclasses, events, reminders, or modified-that-day feed. Completed matching tasks remain visible.

## Current state / evidence
- `src/objects/model.ts:6–44` declares stable built-in types, seven core properties and Task's Done/Due fields. Task uses `propertyIds: [TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID]`.
- `src/schema.ts:186–231` installs/protects built-ins using index-named triggers (`object_builtin_property_${index}_...`). **Adding a property in the middle changes trigger indices**; append the new definition or explicitly migrate affected triggers. Do not rely on CREATE TRIGGER IF NOT EXISTS to replace old Task guards.
- `src/schema.ts:253–274` accepts versions 1–4, calls `installBuiltins`, then adds version-4 constraints when `version !== '4'`. Version 5 must NOT reinstall version-4 constraints on every reopen. Preserve old-version upgrade ordering and unknown-version rejection.
- `src/objects/runtime.ts:194–205`: `getJournal(date)` validates and reads without writing. `openJournal(date)` uses an immediate transaction and creates an empty Journal only when missing. Unique index includes Trash; never restore/replace implicitly.
- `runtime.ts:213–218` provides body-free `listObjectSummaries`; `patchProperties` at 267 uses revision checks and canonical write validation. Creation receipts, revisions and derived references are transactional. New read paths must not regress these optimized projections.
- `test/objects-schema.test.ts:43–80` builds old-schema fixtures from today's BUILTIN arrays. Freeze historical fixture definitions when adding a core property or the fixture will silently stop exercising actual old data.
- Test exemplar: `test/objects-http.test.ts:1–33` uses node:test, node:assert/strict, `openDatabase()` in memory, test cleanup and injected no-network generators. Follow that convention for new tests.
- Product contract: SQLite is sole live authority; objects own data, views reference it. Stable built-in identity is independent of editable labels. Supported upgrades must preserve canonical objects, snapshots, receipts, custom labels and unrelated tables or fail transactionally.

## Scope
Allowed: `src/schema.ts`, `src/objects/model.ts`, `src/objects/runtime.ts`, optional cohesive new `src/objects/day.ts`, `src/objects/values.ts` only for shared date helpers; relevant tests under `test/objects-*.test.ts`, `test/database*.test.ts`, `test/sqlite-*.test.ts` when their explicit schema assumptions must change; `README.md`, `docs/object-contract.md`, `docs/quickstart.md` for data contract changes.
Out of scope: `.data/`, workspace redesign in owner plans 012/013, generator/Pi isolation, dependencies/lockfile, generic services or query frameworks, new caches/FTS/index experiments, view semantics, renaming or resetting existing objects/types.

## Commands
- Bun 1.4.2+; `bun install --frozen-lockfile` only if the isolated worktree needs dependencies. Skip Orca's configured npm setup hook.
- `bun run check` → exit 0.
- `bun test test/objects-schema.test.ts test/objects-runtime.test.ts` → all pass; add new day test file to command if created.
- `bun test` → all pass with no provider calls or user database access.
- `git diff --check` → exit 0.

## Steps
### 1. Upgrade schema transactionally
Add `TASK_SCHEDULED_PROPERTY_ID = '00000000-0000-4000-8000-000000000103'`, label Scheduled date, kind date, optional. Append to BUILTIN_PROPERTIES to preserve prior property trigger indexes. Add to Task core attachments and description. Advance schema to version 5. Install a small STRICT favorites relation keyed by object ID (matching NOCASE identity and FK); no duplicated titles/bodies or generic preferences store.

Upgrade versions 1–4 through existing preservation paths, then attach Scheduled date to built-in Task exactly once. Keep editable Task/property labels, existing extra fields and their ordering. Increment Task schema revision once when its attachments change, never object revisions. Do not attach it automatically to existing custom types based on Task. Refresh only affected built-in protection triggers so Task's new core field is protected after upgrades. Fail on incompatible reserved property ID/shape before overwriting anything. Do not reapply version-4 ALTER constraints for existing v4/v5 databases. Reopening v5 must not rewrite labels/revisions or reseed data.

**Verify:** focused schema tests and `bun run check`, all pass. Include fresh, real historical v4, supported v1–3 chain, v5 reopen, future unknown-version rollback and conflicting reserved-ID rollback fixtures. Historical fixture data must exclude the new property.

### 2. Add small domain APIs
Implement explicit body-free reads for:
- date's canonical Task rows with Done, Due and Scheduled values (or booleans for match) plus summary metadata; SQL OR predicate yields no duplicate when both dates match;
- objects created during that local date, excluding Trash, across all types;
- favorite object summaries, excluding Trash, current title/type read from objects.
Use prepared bound values, validated dates, deterministic ordering (tasks by title/ID, created rows by creation timestamp/ID), bounded pages (50 shown plus sentinel for hasMore) and bounded independent offsets. Do not load full Markdown to filter these lists. Dates/offset validation belongs in domain as well as HTTP boundary where relevant. A cohesive Day service/helper is allowed, but not a generic repository.

Favorites: explicit desired set/unset operations, idempotent duplicate requests, normalize UUID case, reject unknown objects and adding trashed objects, allow removing an existing favorite. Preserve membership while an object is in Trash but hide it; restoration brings it back. Bound sidebar to 50 with an explicit overflow route/page in Plan 026, not a silent inaccessible tail. Adding/removing favorites must not create an object history entry.

**Verify:** focused domain tests (new `test/objects-day.test.ts` allowed) + strict TS. Cover scheduled-only/due-only/both/nonmatching/missing/completed/trashed/wrong type; changed display labels; creation boundaries, leap dates, DST transitions in explicit process TZ and bounded pagination; no Markdown in list projections; favorite repeat/case/rename/trash/restore/persistence. Use synthetic fixtures only.

### 3. Record contracts and full verification
Update the protected-built-in table and schema preservation claims in docs. Document timezone, matching, favorites ownership and bounds, avoiding claims that UI is already done. Adapt assertions for changed deliberate schema version/attachment without weakening preservation checks. Run full suite and inspect all diff hunks for unrelated change.

**Verify:** `bun run check && bun test && git diff --check` → all exit 0.

## Done criteria
- All commands above pass; real old-format fixture upgrades without modifying object content/history/receipts/views/conversations/visitor or unrelated rows.
- Schema v5 fresh/upgrade/reopen and rollback tests exist and pass; Task attachment/revision changes are explicitly asserted.
- Favorites mutate only the relation; read projections are bounded and body-free.
- Task union/date boundary tests pass, including DST and deterministic next pages.
- No changes outside allowlist; no real provider calls or `.data/` access.

## Git / stop / maintenance
Use a single isolated branch from `ce30958`, one writer. Commit logical stages with short imperative messages matching repository history (e.g. `Add canonical day workspace data`). Do not merge, push or change original master. Reviewer owns index.
STOP on unexpected source drift, conflicting ownership, required external dependency, inability to preserve historical data, or verification failure after two reasonable attempts. Report exact failure rather than weakening checks. Inspect built-in trigger identities and migration order especially carefully in review. Future custom Task copies remain independent, and later time-of-day scheduling would need a separate contract, not reinterpretation of date values.
