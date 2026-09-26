# Plan 010: Browse object revisions and open a historical draft safely

## Status
- **DONE / reviewed at `50ce566758e624f2576be27ae624c23a69f57386`.** The owner-approved final repair closes multiline-text loss and native recovery/conflict gates. Reviewer independently read the full diff, reran strict TS, all 90 tests, baseline diff hygiene and the complete script-blocked Chromium flow. Worktree clean; Pi `ctx_95f73f4eaa7d` released, delivery acknowledged. This stacked tip includes fixes 007–009 and is the approved base for Plan 011; master remains unchanged.
- Priority P2; effort M–L; risk MED; category direction, selected for bounded implementation.
- Planned at `d23e17e97030cff31a16773ba3595dc8bd2c1336`, refreshed 2026-09-26 after reviewed source integration of Plans 007–009. Reviewer independently read their changes/merge resolution and ran strict TS, all 82 tests and baseline diff hygiene successfully.
- Prerequisite source work is DONE; remaining combined native-keyboard/reference-error browser evidence is tracked in `plans/007-011-execution.md` and remains a final-merge gate, not waived coverage. History implementation can proceed in its isolated worktree from this reviewed immutable base. Before browser testing, ask the coordinator whether the previous fixture owner has finished; use an isolated Orca profile and one fixture, not concurrent default-profile localhost cookies.
- Current excerpts below were rechecked against that integration commit. Stop on any further unexplained scoped drift.
- User authorized all audit items, separate Orca executors, review, and conditional local merge into master; no push. Advisor maintains plans and does not edit source.

## Outcome and bounded design
Expose existing saved object snapshots through a native, read-only History screen. Let the owner explicitly open a historical snapshot's editable title/type/properties/Markdown as an **unsaved draft** for the same object, then save through the existing revision-checked object command. The history operation must never itself update the object, restore Trash, create another object, rewrite timestamps/history, or bypass today's validation. No visual diff engine, automatic merge, retention policy, schema migration, generic undo service, or one-click force restore.

## Current state / excerpts / conventions
`src/objects/runtime.ts:149` creates `object_revisions(object_id, revision, snapshot_json, recorded_at)` with primary key `(object_id,revision)`. `remember` records the complete prior object on updates and Trash changes:
```ts
private remember(object: ObjectRecord): void {
  this.db.query('INSERT INTO object_revisions(object_id, revision, snapshot_json, recorded_at) VALUES (?, ?, ?, ?)')
    .run(object.id, object.revision, JSON.stringify(object), new Date().toISOString());
}
```
`getObject` returns the current record. Current schema upgrades already convert historical Markdown. Do not add a new snapshot store or alter old snapshots.

`src/objects/http.ts:140–154` owns `readWrite` parsing; the update route near lines 315–329 keeps raw drafts. Existing object update:
```ts
model.objectDraft = { title: fields.get('title') ?? '', body: fields.get('body') ?? model.object.body,
  revision: fields.get('reviewedRevision') ?? fields.get('revision') ?? '',
  typeId: fields.get('typeId') ?? model.object.typeId, fields: draftFields(fields) };
const originalRevision = revision(fields);
const expectedRevision = fields.has('reviewedRevision') ? revision(fields, 'reviewedRevision') : originalRevision;
objects.updateObject(objectMatch[1]!, expectedRevision, write);
```
`readWrite` currently permits fields on the selected type or current object; history may contain a still-registered extra property that was later removed from the object. Do not silently lose such properties or globally loosen normal object forms. A narrowly scoped historical-source marker, resolved against this object's persisted snapshot on every request, can extend only that draft's accepted property IDs. It is context, never write authorization.

`ObjectPageModel.objectDraft` in model.ts:161 separates draft title/body/type/properties/fields/revision from saved `model.object`. `ObjectEditor` at render.tsx:359 uses saved current data for comparison; `SavedConflict` at render.tsx:339 renders latest title/type/properties plus safe Markdown/source. Its `retainedIds` currently comes only from `record.properties`; historical extra registered properties must also remain rendered/submit-capable when a historical draft is active. Ordinary drafts must retain their existing behavior.

Project vocabulary: “Objects own data; views are ways to see it.” SQLite alone is live authority. Rejected writes retain input and exact expected revisions. Trash is a separate action; Journal uniqueness and reference/type rules remain authoritative. Writing is Markdown-authoritative; title/property-only saves preserve exact original source. Use `renderMarkdown`, trusted JSX, existing `Button`/`ButtonLink`, semantic CSS tokens, native forms and progressively enhanced submission. No innerHTML of history data.

Tests: node:test + node:assert/strict through Bun. Follow `test/objects-runtime.test.ts` test `object revisions reject stale writes and preserve recoverable pre-change content` and `test/objects-http.test.ts` `setup(t, injectedGenerator)` / `explicit review still conflicts...`. In-memory fixture:
```ts
const db = openDatabase();
t.after(() => db.close());
const objects = new ObjectRuntime(db);
```
Runtime and HTTP examples already close temporary servers/databases; never use `.data`.

## Scope
Only `src/objects/runtime.ts`, `src/objects/model.ts`, `src/objects/http.ts`, `src/objects/render.tsx`, `src/objects/client.ts` (only history-navigation/draft integration if required), `public/objects.css`, `test/objects-runtime.test.ts`, `test/objects-http.test.ts`, `README.md`, `docs/object-contract.md`, `docs/quickstart.md`.
No database migrations/DDL, dependencies/lockfile, generator/Pi/conversations, writing-format/editor internals, arbitrary restoration SQL, or unrelated refactors. A cohesive history component may remain in render.tsx; do not create a wrapper maze.

## Commands / workflow
- Drift first: `git diff --stat d23e17e97030cff31a16773ba3595dc8bd2c1336..HEAD -- src/objects/runtime.ts src/objects/model.ts src/objects/http.ts src/objects/render.tsx src/objects/client.ts public/objects.css test/objects-runtime.test.ts test/objects-http.test.ts README.md docs/object-contract.md docs/quickstart.md`. Compare refreshed plan to assigned base, stop on unexplained changes.
- Bun >=1.4.2; if missing dependencies in isolated worktree: `bun install --frozen-lockfile` -> exit 0.
- Focused: `bun test test/objects-runtime.test.ts test/objects-http.test.ts test/objects-upgrade.test.ts` -> all pass.
- Final: `bun run check && bun test && git diff --check` -> exit 0.
- One assigned isolated worktree, one writer. Commit with imperative messages, e.g. `Add safe object history draft recovery`. No master edits, merge, push, plan edits or recursive agents.

## Implementation steps
1. Establish read contracts and tests. Add bounded runtime methods to list this object's historical revision summaries (20/page plus one truncation sentinel, descending revision; strict safe offsets) and fetch one exact positive safe revision snapshot belonging to this object. Missing object/revision returns AppError 404; malformed input 422. The current record is displayed separately, not duplicated into history. Never return another object's snapshot or load all bodies for a summary list. Assert calls leave objects/history/backlinks/receipts untouched, bound pagination, empty histories, Trash accessibility and missing/malformed revision behavior. Verify focused tests -> pass.
2. Add native `GET /objects/:id/history` with optional bounded pagination and explicit selected historical revision (use a clearly named query parameter such as `revision`). Reject unsupported/repeated input at this boundary. Add History link on the object page; screen shows current revision, historical summaries, selected snapshot title/type/properties, read-only rendered Markdown and exact copyable source. Use current catalog labels where identities still exist; show explicit unavailable labels/raw safe values rather than discard data. Limit bodies to the one selected snapshot. GET is strictly nonmutating. Add native HTTP tests -> focused suite passes.
3. Add a CSRF-protected native action such as `POST /objects/:id/history/draft` that accepts only CSRF, selected historical revision and the current revision shown on the history page. Read the snapshot from SQLite, not client-submitted JSON. Render the existing editor with current `model.object` and historical editable data in `objectDraft`, retaining the submitted current revision as the draft's expected revision. If another save occurred meanwhile, show the existing comparison/reconciled-save flow rather than silently advancing it. Both matching and stale draft-open operations make zero canonical writes. Mark it visibly “Unsaved draft from revision N” and use `data-draft` for unload protection.
4. Preserve historical extra property IDs without weakening ordinary writes. The editor currently renders values via `(draft?.properties ?? record?.properties)?.[id]`; use a complete historical property draft so fields absent from history do not accidentally inherit newer saved values. Include historical extra reference definitions and selected targets in bounded picker enrichment, preserving Plans 007/009 identity/retention behavior. Carry only a validated `historyRevision` marker if needed; on each update/type-switch/rejected response resolve it against the same object's saved snapshot and add those registered property IDs to the draft's allowed field/template set. No arbitrary property-ID lists from the client. The actual Save calls ordinary `updateObject` with the displayed expected revision; all current validations apply. Do not carry historical object ID/revision/timestamps/Trash state as values to restore. If a historical type/property is truly unavailable or cannot be represented, show an explicit read-only/copy-source fallback and do not silently offer a lossy restore. Verify tests covering extra properties, exact CRLF/Markdown source, cleared properties, invalid current references, journals, trashed objects, and forged/cross-object historical-source context -> focused suite passes.
5. Exercise complete native flow: create/edit -> history -> historical draft -> change a field -> explicit save creates a new revision of the same object and correct backlinks. Concurrent save before draft opening or before final save must conflict and preserve the historical draft. Failed validation adds no revision/backlinks/receipt. Requests without CSRF fail. Existing editor create/update/type-switch behavior and unchanged-source fidelity tests must still pass. Run focused suite -> all pass.
6. Browser-check in an isolated temporary/in-memory fixture: keyboard navigation to history, readable selected revision, load draft, dirty warning on navigation, enhanced save, ordinary Markdown-editor initialization, conflict recovery and native no-JavaScript save. Check a narrow viewport and ensure history does not cover writing/save controls. Use a per-page Orca browser ID and record actual commands/results. If tools cannot verify, report exact block; never claim DOM assertions prove focus/layout. Update docs with the bounded history/recovery rules, no force restore, and current validation limits. Run final gates, inspect scoped diff and commit.

## Done criteria
- Bounded runtime/history HTTP tests pass and prove GET/draft-open are nonmutating.
- Historical editable data survives into an unsaved same-object draft, including registered extra properties and exact unedited Markdown source.
- Explicit final Save creates a normal new revision; stale saves/current Journal/reference constraints still reject without partial writes.
- Unsupported historical data is preserved and explained rather than silently dropped.
- Native forms and enhanced flows work; browser keyboard/responsive/conflict evidence is supplied.
- `bun run check`, full `bun test`, `git diff --check` pass; only scoped files changed; no data/schema/provider changes.

## STOP / maintenance
Stop if historical snapshots lack enough provenance to load safely, if current validation requires a force/merge exception, if a new schema/editor format or dependency seems necessary, or after two failed repairs. Ask instead of silently narrowing recovery to Markdown only. Future schema removals must revisit historical display/fallback and the source-derived property whitelist. Keep History read-only until an explicit normal editor Save; do not conflate “open draft” with restoring Trash.

## Prior review blocker and owner-approved continuation (resolved)

The remaining failure is real browser control sanitization, not a missing assertion alone. At `6dcc925`, `historyAvailable` in `src/objects/http.ts` accepts a valid text property containing CR/LF because `valueError('text', value)` accepts it. `PropertyControl` in `src/objects/render.tsx` renders that value into `input[type=text]`, which removes those line breaks. A historical value `first\nsecond` opened successfully (200), Chromium's DOMParser/FormData produced `firstsecond`, and the ordinary revision-checked update accepted it (303, revision 3). The previous historical snapshot remains intact, but the recovered field is silently changed.

Independent reproduction used only an in-memory `ObjectRuntime`, a temporary loopback `createApp`, a disposable Chromium profile and valid fixture visitor/CSRF. Create a custom text property, create a Page with that extra value, update the Page to remove the property, POST revision 1 to `/objects/:id/history/draft`, parse the returned native form with Chromium, and submit its FormData through the real HTTP update route. This is Chromium parsing/serialization plus real HTTP evidence, **not a trusted click reproduction**. An earlier navigation/click probe failed with a page-evaluation error and is not counted as evidence. All owned resources from both probes were closed/removed.

If the owner authorizes a fresh bounded continuation, the smallest complete repair is to include text-input CR/LF representability in the existing history guard and keep the read-only/copy fallback. Do not broaden the ordinary property editor or normalize historical values. Reuse `Value.Check(IdSchema, ...)` rather than duplicating UUID grammar in the guard. Add a regression for both LF and CRLF historical text properties, rejecting direct draft opening and same-object historical update/type-switch context without canonical/history changes; verify the read-only value remains safe and accessible. Also browser-check the complete script-blocked History → draft → explicit Save flow with representable values and a concurrent change before final Save. Do not treat the prior no-JS save of an ordinary reopened object as that entire flow.

Prior final browser evidence is useful but bounded: `/tmp/plan010_chromium_verify.mjs`, `/tmp/plan010-cdp-verify-pCuE0o/`, and `/tmp/plan010-final-repair-report.md`. Reviewer read the whole script and opened all four nonblank full-page captures: selected history, unavailable fallback, narrow history and editor. Trusted Tab/Enter History navigation, draft-open clicks, dirty-navigation cancellation, exact enhanced LF/CRLF writing, stale opening and explicit reconciliation passed. Native Save was clicked on the ordinary object page after recovery, not through a wholly script-blocked recovery sequence. The report's “full-viewport” description is inaccurate: captureBeyondViewport was true, producing full-page images. These do not hide the failed data-preservation criterion.

The owner explicitly approved the further bounded continuation. It completed as `50ce566` with a text CR/LF guard, shared IdSchema validation, regression coverage and doc clarification. Reports: `/tmp/plan010_executor_report.md` and `/tmp/plan010-cdp-verify-3Cv7mL/`. Reviewer independently reran the current `/tmp/plan010_chromium_verify.mjs` successfully; fresh evidence is `/tmp/plan010-cdp-verify-XTu9b5/`. Its trusted native click/key path now covers complete recovery, concurrent final-save rejection, retained draft/revision and explicit reconciliation. Original stored LF/CRLF property values remain read-only and visible, with no lossy draft action. Prior narrow full-page captures remain valid because this repair changed no layout.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: each step, actual commands/results
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit/branch/worktree, browser evidence, deviations/limits
