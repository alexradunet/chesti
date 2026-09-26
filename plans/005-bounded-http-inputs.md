# Plan 005: Make bounded reference pickers and Unicode prompts usable

## Status
- Priority P1; effort M; risk LOW/MED; category bug; confidence HIGH.
- Planned at `438d497`, 2026-09-26. Dependencies: none.
- Executor implements in isolated Orca worktree; reviewer maintains plans index.

## Why this matters
Object editors fetch the first 200 objects globally, then filter by reference target type. Enough unrelated objects can leave a typed reference picker empty. Separately a valid 4,000 UTF-16-character CJK prompt URL-encodes beyond the 32,768-byte generation envelope and is rejected before draft-preserving validation. Fix both without removing bounds or changing domain rules.

## Current state
`src/objects/http.ts:82`: `const pickerObjects = () => objects.listObjects({ limit: 200 });`. Used on new/edit/create/update/type-switch/error responses. `src/objects/render.tsx:94` then filters those candidates by `property.targetTypeId`. Current selections missing from candidates are appended as selected options; saved selected objects are fetched on GET edit. The view input picker already uses `objects.listObjects({ typeId: inputType, limit: 200 })`—reuse that query contract, not new SQL.

`ObjectEditor` renders field templates for enhanced switching, not just the currently active type; inspect all PropertyControl callsites and templates before choosing candidate types. Existing objects can retain registered properties outside their type. Preserve raw draft selection arrays, inactive drafts, stale revisions, and trashed retained references. Domain commands remain the only authority for adding references.

`src/server.ts:115` has route-specific limits: objects 1,048,576, generation 32,768, others 8192. `formBody()` checks both Content-Length and streaming size. `src/objects/http.ts:285` rejects blank prompts or `model.prompt.length > 4000`; `render.tsx:74` advertises `maxlength={4000}`. A UTF-16 code unit can need 9 URL-encoded bytes (three UTF-8 bytes each percent escaped). Keep the 4,000 decoded limit and choose a finite transport cap accounting for encoding, CSRF and a single context UUID.

Tests: `test/objects-http.test.ts` uses node:test/assert, `setup(t, injectedGenerator)` with in-memory DB, real loopback server, cookie/CSRF helpers and teardown. Example:
```ts
const f = await setup(t, async () => { throw new Error('Not used'); });
const response = await f.get('/objects/new');
assert.equal(response.status, 200);
```
Use HTMLRewriter to inspect actual native select options rather than full-page string counts/snapshots. Runtime queries are already bounded/prepared; no new repository abstraction.

## Scope
Only modify:
- `src/objects/http.ts`
- `src/server.ts`
- `test/objects-http.test.ts`
- `test/http.test.ts` if useful for transport-boundary tests
- `README.md` only for accurate picker-limit wording
Do not modify render/model/client, generation internals, dependencies/lockfile, data or credentials. If render/model changes prove necessary, ask first.

## Commands / git workflow
- Drift: `git diff --stat 438d497..HEAD -- src/objects/http.ts src/server.ts test/objects-http.test.ts test/http.test.ts README.md` → no unexplained changes; compare current excerpts on drift.
- Bun >=1.4.2; if needed `bun install --frozen-lockfile`. Orca npm setup is deliberately skipped.
- `bun test test/objects-http.test.ts test/http.test.ts` → tests pass after fixes, new regressions fail on baseline.
- `bun run check && bun test && git diff --check` → exit 0.
- Commit logical changes on Orca's isolated branch, imperative message. Do not push, merge, create PR, modify original checkout, or update plans index.

## Steps
1. Reproduce missing reference choices with >200 unrelated objects and one target, via actual GET new/edit. Add per-target >200 case and selected-outside-bound case. Test POST rejected writes and native type switching, including single/multiple references. Focused tests should catch original bug.
2. Query at most 200 live candidates per needed reference target type, once per type per request; include all rendered enhanced switching templates and retained object properties. Reuse lists within this request only, no persistent cache. Keep view-input logic scoped and don't expand list/search pages. Ensure selected existing or raw-draft IDs remain visible without becoming automatically valid writes. Avoid scanning all objects or querying per field/row. Run focused tests.
3. Add valid ASCII/CJK/supplementary Unicode prompt tests with fixture generation and previous/conversation fields (mutually exclusive). Verify the fixture sees exact trimmed accepted prompt; no real provider. Increase only the generation envelope with an explanatory bound. Test 4,001 decoded UTF-16 characters rejects without generator/persistence, and truly oversized streamed/request bodies still reject 413. Native invalid prompt response retains draft. Run focused tests.
4. Browser-check actual reference picker/type-switch path using Orca embedded browser and an explicitly temporary database, with >200 unrelated records. Verify selected target survives selection/type switch and native fallback. No live `.data`, no provider calls. Use per-page browser ID to avoid colliding with other workers. Record commands/evidence and stop temporary server/remove only own temporary artifacts.
5. Update picker wording if needed; run final commands, review scope, commit.

## Done criteria
- Correct-type candidates remain selectable despite >200 unrelated objects on GET and failed/type-switch POST.
- Per-target candidate bound remains 200 plus retained selections; tests assert bounds.
- Enhanced type-switch templates have needed candidates; raw multi-reference drafts survive.
- Valid maximum Unicode prompts accepted through real HTTP with fixture generation and optional context.
- Decoded and streaming bounds still reject invalid/oversized requests before persistence/provider.
- Focused/full tests, strict TS, diff hygiene pass; browser flow exercised and limitations explicit.

## STOP conditions / maintenance
Ask if a new picker model, new search UX, dependency, unbounded catalog scan, or domain-rule change is needed. Don't silently omit enhanced templates to simplify fetching. Stop on material drift, out-of-scope edits, or repeated failed checks. Future field-template changes must keep candidate collection and bound tests aligned; prompt-length changes must revisit encoded envelope.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: each step plus actual command/result, including browser verification
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit, branch, worktree, deviations, unverified areas
