# Plan 026: Replace type-heavy navigation with favorites and a day workspace

> Executor: follow in order, in the same isolated branch as accepted Plan 025. Reviewer owns plans/README.md. Do not merge/push or edit the original checkout.
> Drift check: `git diff --stat ce30958..HEAD -- src/objects/model.ts src/objects/runtime.ts src/objects/http.ts src/objects/render.tsx src/objects/client.ts src/objects/ui.tsx public/objects.css public/writing.css README.md docs/object-contract.md docs/quickstart.md test`
> Changes from your own completed Plan 025 are expected; reconcile those only. STOP on other unaccounted drift.

## Status
- Priority: P1
- Effort: L
- Risk: MED–HIGH (draft preservation, native forms, UI)
- Depends on: Plan 025's schema-v5 Scheduled date, favorites and bounded day queries
- Category: direction
- Planned at: `ce30958`, 2026-09-27

## Self-contained product outcome
Taskdesk is a Bun/SQLite local single-owner object workspace with Hono JSX, native forms and optional Milkdown Markdown editing. Owner explicitly selected this feature:
- Top of left sidebar: **New note** (generic existing Page type, no new Note type) and **Calendar** quick actions.
- **Objects** retains current type overview/search access; remove the sidebar's exhaustive object-type section, not the types themselves.
- **Favorites** shows only explicitly favorited objects, not all objects. Provide favorite/unfavorite on saved object pages. SQLite membership works natively, survives restart and label changes, and does not mutate object data/revisions. Trashed favorites are hidden but return after restoration. Show 50 max plus a route to all favorites with bounded pagination.
- Keep Search, Views, Manage types and Trash reachable as secondary controls. Preserve existing pinned-view feature/data; it can remain a quiet secondary section. Do not remove AI view creation/refinement or retarget conversations. Dedicated Tasks/Journal sidebar entries may be removed as redundant; keep their existing routes working.
- `/calendar` becomes the **day workspace**, opening today by default. Center: date heading; previous day, Today, next day; three always-visible sections: **Journal**, **Tasks**, **Created on this day**.
- Tasks include canonical Task objects scheduled OR due that date, once if both match. Indicate Scheduled / Due / both; include completed rows and completion controls. Do not broaden to custom types, recurring tasks, overdue tasks or events.
- Right of center: small month date picker (not a month event grid). Previous/next month and date links, selected/today accessible states. On narrow screens collapse to a native date input above content. Right assistant remains functional without overlapping the calendar; allow the mini calendar to move inline when the AI panel consumes desktop space.
- Journal is the existing unique Journal object. Render/edit its writing in the day workspace using the existing formatted editor/native fallback. An empty day's journal is only persisted on explicit Save after entering writing, never on date navigation, loading editor assets or GET. Existing journal updates preserve its title, properties, exact original Markdown on initialization and canonical revision/conflict checks. In-Trash journal must offer the existing object/restore route, not silently restore/create replacement.
- Created section links original live objects created on that date; no copies. Empty states for all sections.

Use server-local timezone consistently for day-workspace Today and created-at grouping and display the timezone. Date-only scheduled/due/journal fields are calendar dates. Day bounds are midnight-to-next-midnight, not fixed 24h arithmetic. Explicit date always wins. Keep existing standalone Journal timezone behavior unless necessary; do not apply its browser-local redirect logic to this new page accidentally.

The reference screenshot shows a narrow persistent left nav, wide centered date/journal/task/created column, mini month calendar in a right rail. It includes many other controls NOT requested: do not copy its type list, month/week/three-day event modes, chips for object types, Reviewed journal flag, tabbed section filters or extra dashboard widgets. Use Taskdesk's warm paper/forest semantic CSS tokens, not the screenshot's exact styling.

## Current-state evidence and conventions
- `src/objects/render.tsx:31–50` WorkspaceNav currently renders New content, links including Calendar/Tasks/Journal, browser-local Pinned views and exhaustive Object types. `ObjectHome` already provides type cards; this remains canonical browse entry.
- `src/objects/http.ts:289–306` has nonmutating journal/date and new-object GETs. New objects default to `PAGE_TYPE_ID`. `/calendar` currently sets screen views/section calendar (`http.ts:307–310`), filtering saved calendar views. Keep those views discoverable under Views; do not delete/convert their records.
- `src/objects/runtime.ts:194–205` provides `getJournal` and atomic `openJournal`; don't use `openJournal` during GET. Plan 025 introduces `TASK_SCHEDULED_PROPERTY_ID` ...0103 and schema v5, plus bounded tasks/created/favorite APIs; inspect their signatures before wiring callers.
- `src/objects/render.tsx:365–434` ObjectEditor owns normal revision/create receipt fields, source string, formatting toolbar and writing hooks. Client initializes one writing surface; reuse/extract coherent shared writing markup, do not invent another editor or serialization path. A focused day journal form is preferable to duplicating the entire full object editor and schema controls.
- `src/objects/client.ts:319–345` stores existing view pins under `taskdesk:pinned-views`; don't migrate/delete them. `client.ts:536+` dirtyForms and form submission handling govern unsaved-edit protection. Navigating dates OR submitting a task/favorite form must not drop an unsaved journal draft.
- `src/objects/http.ts:97–101` page() lazily loads presentation state, while lookup/conversation JSON and successful redirect-only mutations avoid it. Load favorite summaries only for HTML, not in every request prologue.
- UI exemplar: `Button` defaults to type=button; mutation forms explicitly use `type="submit"`; links navigate. Shared atoms are in ui.tsx, screens in render.tsx, native form input parsing at HTTP boundary, domain commands remain in runtime/day helper.
- Tests follow node:test + node:assert/strict. `test/objects-http.test.ts:15–33` setup starts an in-memory application with injected generator and registers server/database cleanup. Do not use real provider credentials.

## Scope
Allowed: `src/objects/model.ts`, `runtime.ts` and optional `day.ts` only for focused journal save/task completion domain commands; `src/objects/http.ts`, `render.tsx`, `client.ts`, `ui.tsx`; optional cohesive `src/objects/day-render.tsx` or `writing-fields.tsx` to share markup without circular imports; `public/objects.css`, `public/writing.css` only for affected layout; relevant `test/objects-*.test.ts`, `test/http.test.ts`; `README.md`, `docs/object-contract.md`, `docs/quickstart.md`; `src/objects/demo.ts` only to correct now-stale navigation instructions embedded in bundled writing (no new demo objects/reseed).
No dependency/lock changes, generic routing/UI framework, generator/Pi/isolation edits, new services, original checkout/source mutation, user `.data/`, migrations beyond Plan 025, owner plans 012/013, unrelated format/rename sweeps. No paid real model generation.

## Commands / toolkit
- `bun install --frozen-lockfile` if dependencies absent in isolated worktree; Bun 1.4.2+.
- `bun run check` → no errors.
- `bun test test/objects-http.test.ts test/objects-client-state.test.ts test/objects-runtime.test.ts` plus new focused files → all pass.
- `bun test` → all pass; `git diff --check` → exit 0.
- UI: use local orca-cli skill, resolve CLI and load its live guide. Only Orca's embedded browser. Start a server with explicitly temporary DATABASE_PATH or synthetic in-memory fixture. Never default `bun start` against real data. Temporary fixtures/logs may live under /tmp; close only owned servers/tabs.

## Steps
### 1. Wire safe domain/HTTP actions and native screens
Implement GET `/calendar?date=YYYY-MM-DD` with optional bounded independent task/created offsets. Invalid/duplicate date or offsets get explicit 422, no mutation. Add bounded favorite index route under `/objects/...` avoiding object-ID routing collisions. Keep `/tasks`, `/journal` and journal/open compatibility. New note goes to explicit Page creation and creates no empty object on GET.

Add explicit desired favorite/unfavorite POST (CSRF, allowlisted fields, validated object identity, same-origin fixed/allowlisted return context; never arbitrary redirect URL). Render object favorite control outside the object save form. Keep object drafts safe when this other form is submitted.

Journal saves use a dedicated focused command/route for selected day writing. On creation carry normal request UUID; canonical createObject must enforce uniqueness and receipt idempotency. Check empty/non-writing initial submissions without creating blank journal; report a useful validation message. On update, use submitted expected revision; preserve latest saved title/properties within one transaction, never silently advance the submitted revision. Do not overwrite concurrent edits on stale revision. Rejected saves retain original body, date, request ID and revision. Show conflict/latest writing with explicit reconcile action following the existing editor contract (normal update/reviewedRevision validation, no force save). If the selected journal changes date/type or moves to Trash before saving, reject rather than silently save a different day's object. Do not change ordinary standalone object-editor behavior.

Task completion POST accepts ID, explicit desired Done boolean, expected revision and selected day. Domain command must transactionally verify current canonical Task type, live status, scheduled/due scope and revision before patchProperties; don't trust submitted property ID or membership. Failure must not mutate anything. Render visible row-level/section feedback. When an unsaved journal exists, task/favorite actions must not reload away its writing: preserve the current draft via an in-place narrowly scoped response or block navigation with the existing unsaved-edit confirmation. Prefer the simplest complete behavior and document it accurately. Native forms retain normal explicit-save behavior; do not pretend JS-less unsaved input can survive arbitrary link navigation.

**Verify:** focused HTTP/domain tests, strict TS. Exercise real CSRF/origin guard, GET nonmutation, duplicate date, unknown IDs, favorite toggle, native save retry, journal conflict/date move/trash, task scope/revision failure and explicit boolean semantics. Ensure redirect and JSON paths retain lazy presentation reads.

### 2. Compose the day UI and sidebar
Remove exhaustive sidebar type section; move Manage types to secondary links. Add New note and Calendar quick actions, Objects and server-rendered Favorites with empty/overflow states. Preserve search shortcut and pinned views.

Render date heading/navigation, journal writing form, task rows with completion and match labels, and created rows with independent Previous/Next links. Use actual bounded query metadata; don't claim zero when truncated. Each pagination/date/month link preserves explicit relevant context, resets page offsets on day change, and is protected from discarding dirty enhanced journal edits. Invalid inputs render an error rather than throwing in calendar construction.

Implement a small semantic month table of day links with descriptive accessible names and aria-current=date/selected state as appropriate. Month browsing must not accidentally change selected day; date selection changes all three sections. Handle leap February/year boundaries and supported extreme years without invalid links. No custom ARIA grid keyboard implementation is required: ordinary native links/buttons + Tab suffice. Share writing controls and include the same-origin editor CSS/bundle on the day screen. Exactly one editable journal writing surface; no nested forms/duplicate IDs.

**Verify:** focused HTTP/render tests and strict TS; expect selected-day navigation, bounds/labels, no object-type sidebar section, reachable Views/Manage types/Search/Trash, native journal and generic Page routes. Test renamed built-ins still use stable IDs. Existing object editing/writing/AI tests continue to pass.

### 3. Exercise enhancement and browser behavior
Extend only necessary day/favorite behavior in client.ts, preserving explicit assistant targeting and unsent prompt. Do not autoredirect an explicit date or a restored/error draft. Reuse dirtyForms/writing initialization and link insertion. Verify task/favorite secondary actions with a dirty journal really cancel/preserve writing rather than resetting dirty state on another form's success.

Use Orca browser against a synthetic database containing: due-only, scheduled-only, both, completed, unrelated, trashed tasks; existing journal, empty day and journal in Trash; ordinary objects near date boundaries; favorited/nonfavorited objects. Exercise:
1. Desktop date selection: correct date heading/three sections, labels and no duplicate both-task; previous/next/month/Today.
2. Write and save empty day's journal, reload and edit existing journal; browsing unused dates creates nothing. Native textarea submission (disable enhancement for fixture or otherwise verify actual native path), stale revision retains submitted writing, trash restoration link.
3. Task completion persists original object; stale/removed-from-day task refuses. Dirty journal remains after cancelled task or favorite action/date navigation; verify actual writing, not just a confirmation flag.
4. New note is Page; favorite then sidebar link, rename title refresh, unfavorite; no JS native favorite form works. Existing saved views/search and AI panel still reachable; no live model call required.
5. Actual keyboard Tab/Enter date selection, visible focus, writing focus, mobile nav/AI drawer, desktop and narrow screenshots (e.g. 390px). Calendar collapses, no horizontal overflow/overlap. Orca keyboard may need trusted click to focus visible tab before Tab. Report browser tooling blockers precisely, never switch browsers or substitute DOM assertions for visual proof.

**Verify:** `bun run check && bun test && git diff --check` all pass plus recorded Orca commands/results and inspect screenshots. A blocked browser acceptance check is not DONE.

### 4. Update docs and finish
Update README, object contract, quickstart for New note/Objects/Favorites navigation, Calendar day meaning, Saved views discovery, scheduled/due union, completed tasks, explicit journal saving, local timezone and pagination. Remove obsolete claims that `/calendar` only lists saved views or that type links live in sidebar. Correct bundled demo prose only if actually stale. No data reseed.

**Verify:** `rg -n 'Calendar|sidebar|Scheduled|Favorites|schema version' README.md docs/object-contract.md docs/quickstart.md` and review each relevant claim; full checks above pass. All changes are in scope.

## Done / stop / review
Done requires all focused/full tests, strict TS, diff hygiene, real browser flow/keyboard/responsive evidence and source review. Test names/assertions must prove behavior rather than exact-markup snapshots. No native mutation relies on JS alone. Existing Markdown/revision/idempotency/AI isolation contracts remain intact. Commit logical stages in the isolated worktree, do not merge or push.

STOP if Plan 025 prerequisites fail, source has unrelated drift, old behavior cannot be preserved safely, out-of-scope dependency/architecture changes appear necessary, or a gate fails after two reasonable attempts. Report missing browser verification without faking success. Reviewer may request at most two repair rounds. Maintenance: new calendar is trusted first-party UI, not a special generated view permission; its limited task action must stay explicitly scoped. Daily note is still an ordinary canonical Journal object, not a second storage format.
