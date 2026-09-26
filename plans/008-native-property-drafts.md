# Plan 008: Retain rejected native property-creation drafts

## Status
- Priority P1; effort M; risk MED; category bug; confidence HIGH.
- Planned at `058e883`, 2026-09-26. Dependencies: none.
- User authorized implementation by a separate Orca executor, review, and conditional local master integration. No push. Reviewer maintains the plans index.

## Why this matters
Without JavaScript, submitting a Select property with duplicate choices returns 422 and re-renders an empty label/options form with the default kind. The user loses the exact draft needed to correct the error. An actual in-memory HTTP reproduction confirmed both label and choices disappear while the type revision stays unchanged. Keep rejected raw input separate from saved schemas and never silently replace a submitted revision with the latest one.

## Current state and conventions
`src/objects/http.ts:215–228` loads the saved type and immediately parses/executes the property command:
```ts
model.screen = 'type'; model.objectType = objects.getType(typeMatch[1]!);
// ...
requireFields(fields, ['csrf', 'revision', 'propertyId', 'label', 'kind', 'options', 'targetTypeId', 'multiple']);
objects.addProperty(model.objectType.id, revision(fields), fields.get('propertyId') ? { propertyId: fields.get('propertyId')! } : {
  label: fields.get('label') ?? '', kind: fields.get('kind') as PropertyKind,
  ...(fields.get('options') ? { options: fields.get('options')!.split(/\r?\n/).map(value => value.trim()).filter(Boolean) } : {}),
  ...(fields.get('targetTypeId') ? { targetTypeId: fields.get('targetTypeId')! } : {}),
  ...(fields.has('multiple') ? { multiple: fields.get('multiple') === 'on' || fields.get('multiple') === 'true' } : {}),
});
```
The error handler only sets `model.error`. `TypeEditor` in `src/objects/render.tsx:261` renders the new-property label/options empty, picks the first kind, and uses `type.revision`. The adjacent reuse-property form shares the same POST route and must not accidentally receive a new-property draft.

`ObjectPageModel` in `src/objects/model.ts` already separates `typeDraft` and `objectDraft` from saved records. Use a small explicit new-property draft shape rather than modifying catalog/type/property records. Example pattern:
```ts
model.typeDraft = { name: fields.get('name') ?? '', basedOnTypeId: fields.get('basedOnTypeId') || undefined };
```
`Types` uses `data-draft` so client dirty-form protection recognizes server-returned drafts. `client.ts` enables kind-specific controls according to the select's value; do not duplicate validation there. Native forms submit empty unused fields and the boundary already ignores empty options/target IDs.

Match node:test/assert and `setup` in `test/objects-http.test.ts`, which starts a real loopback server over an in-memory DB. Use HTMLRewriter to inspect actual successful native controls, including textarea's initial newline convention. Project rules: preserve rejected input and stale revisions; same domain command for enhanced and native forms; trusted JSX escapes all content.

## Scope
Only `src/objects/model.ts`, `src/objects/http.ts`, `src/objects/render.tsx`, `test/objects-http.test.ts`, and `docs/quickstart.md`. Scope is new-property creation, not a redesign of all schema forms. Preserve reuse-property behavior. No runtime schema/rule changes, no client rewriting, dependencies, other forms, or real data. Ask if additional scope is necessary.

## Commands / workflow
- Drift: `git diff --stat 058e883..HEAD -- src/objects/model.ts src/objects/http.ts src/objects/render.tsx test/objects-http.test.ts docs/quickstart.md`; expected no unexplained drift; compare live excerpts before edits.
- Bun >=1.4.2; only if needed in isolated worktree: `bun install --frozen-lockfile` -> exit 0.
- Focused: `bun test test/objects-http.test.ts` -> pass after changes; new regressions fail on baseline.
- Final: `bun run check && bun test && git diff --check` -> exit 0.
- Commit only scoped files in your assigned Orca worktree with an imperative message (e.g. `Preserve rejected native property drafts`). Never edit master, merge, push, update plans, or spawn agents.

## Steps
1. Add HTTP regressions for duplicate Select options and an invalid reference target. Submit label, kind, exact options (including blank lines/whitespace), target, multiplicity and revision. Inspect returned native values and assert no new property/attachment/revision on failure. Focused tests must fail on the original implementation.
2. Capture an explicit draft for new-property submission before parsing that can fail. Render that draft only in the new-property form: exact raw label/options, selected kind/target (including an unavailable value when necessary to avoid silent substitution), checkbox, and original revision. Keep raw values escaped and saved catalog unchanged. Preserve unknown/invalid inputs visibly without making them valid. Add an initial newline sentinel to options textareas if needed so a leading user newline survives HTML parsing. Mark a rejected form dirty for enhancement. Focused tests -> pass.
3. Cover stale revision 409: retain original revision rather than inserting current type revision, repeat submit still conflicts, and saved schemas/objects remain unchanged. Include correction of an ordinary 422 to a valid property and a reuse-property request to prove the other form is unaffected. Do not introduce automatic revision advancement or a force-save path. Focused tests -> pass.
4. In an isolated temporary fixture, browser-check native no-JavaScript duplicate-options error -> retained choices -> corrected successful create. Check a reference draft, keyboard focus usability and narrow viewport. Also check enhancement initialized on a native error response keeps kind controls/draft values and warns before navigation. Update the quick start with the actual retention behavior and honest stale-revision recovery instructions. Run final gates and commit.

## Done criteria
- Native HTTP tests prove exact draft label/options/kind/target/multiplicity/revision retention on validation errors and conflicts.
- Corrected nonstale draft creates exactly one property with the expected choices; failed/stale attempts leave the DB unchanged.
- Reuse-property behavior and all existing object/conversation tests pass.
- Strict TS, complete tests, diff hygiene pass; browser evidence is reported exactly.
- Changed paths are exclusively in scope.

## STOP / maintenance
Stop on unexplained drift, out-of-scope requirements, or two failed repair attempts. Do not make raw drafts authoritative saved definitions. Future kind controls must update draft rendering and native HTTP regression cases together. Stale schema drafts need deliberate reconciliation, not automatic revision refresh; broader schema conflict UI is not part of this fix.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: commands/results for every step
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit/branch/worktree, browser evidence, deviations/limits
