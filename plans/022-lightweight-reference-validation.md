# Plan 022: Validate reference targets without reading their writing

## Status
- Priority: P1; effort: S; risk: LOW; category: perf.
- Planned at: `eb324c4e05ed73243dabc6242422baea4e855c67`, 2026-09-27.
- Depends on: none. Execute before the related Markdown optimization when sharing a sequential writer.
- User authorization is bounded implementation and isolated review; no merge/push/live-data access.

## Drift check
`git diff --stat eb324c4..HEAD -- src/objects/runtime.ts test/objects-runtime.test.ts docs/object-contract.md`. Reconcile authorized same-series changes; STOP on unexplained drift.

## Why
Reference validation needs IDs, type, and trash state, but reads full canonical targets. Creating one source with 128 references to 64 KiB target bodies loaded 8 MiB of writing in a synthetic probe. The existing lightweight summary API supplies the required data without changing domain rules.

## Current state
- `src/objects/runtime.ts:155–164` defines `getObject(id)` using SELECT * and `getObjectSummary(id)` using explicit body-free columns; both reject missing targets with AppError 404 and query the case-insensitive object ID.
- `validateValues` property-reference branch:
  ```ts
  for (const targetId of ids as string[]) {
    const target = this.getObject(targetId);
    const targetType = previous && target.id.toLowerCase() === previous.id.toLowerCase() ? write.typeId : target.typeId;
    if (targetType !== property.targetTypeId) throw new AppError(422, `${property.label}: target has the wrong object type.`);
    if (target.trashed && !retained.has(target.id.toLowerCase())) throw new AppError(422, `${property.label}: cannot add a reference to a trashed object.`);
  }
  ```
- Writing links use another `this.getObject(targetId)` and the same retained-versus-new trash distinction at lines 353–356.
- Reference UUID identity is case-insensitive; stored values must not be rewritten. A changing object's self-reference uses its proposed type. Invalid writes must leave objects, revisions, receipts and edges unchanged.
- Use ordinary methods, AppError, immediate transactions, and node:test + node:assert/strict as in `test/objects-runtime.test.ts`. No dependency or repository abstractions.

## Scope
Only `src/objects/runtime.ts`, `test/objects-runtime.test.ts`, and a focused factual note in `docs/object-contract.md`. Related same-series edits to runtime are expected with a single writer. No schema/server/UI/generator/dependency changes. Do not alter getObject's canonical return contract merely to optimize target validation.

## Steps
1. Add a targeted regression which uses real canonical targets with substantial bodies and proves reference/writing-link validation does not call full-object reads for those targets. Prefer a narrow test override of an existing runtime method that throws for target IDs, while preserving source reads; restore any shared instrumentation. Assert actual successful saved references and backlinks. Initially this regression should fail at the full-target-read call. Run `bun test test/objects-runtime.test.ts`.
2. Change only target validation reads to getObjectSummary (or an equally small existing projection). Preserve all checks and error statuses, case-insensitive behavior, and self-type handling. Do not batch into a new query framework or cache target records across commands. Run `bun test test/objects-runtime.test.ts test/objects-views.test.ts test/objects-http.test.ts`.
3. Add meaningful cases for retained trashed property/writing links, newly added trashed links, missing target, wrong type, and self-reference during a type change. Existing tests may already cover portions; strengthen rather than duplicate. Confirm failed writes leave revision/history/edges unchanged. Finish with `bun run check`, `bun test`, `git diff --check`.

## Done criteria
- Validation reads target metadata without materializing target bodies/properties.
- IDs, error behavior, retained/new trash rules, typed self-reference behavior and backlinks match the previous contract.
- Atomic rejection and stale revision tests pass.
- All focused/full tests and strict TypeScript pass; no timing thresholds in normal tests.
- Scope is clean; no schema change or version bump.

## Commands / git
Use Bun 1.4.2+. If dependencies are absent, run only `bun install --frozen-lockfile`. Follow existing node:test conventions, using in-memory DBs or owned temp paths. Commit the change in the assigned isolated worktree (e.g. `Use lightweight target reads during reference validation`). No merge, push, main-checkout mutation, or .data access. Reviewer owns plan status.

## STOP / maintenance
Stop for unexplained drift, required out-of-scope changes, inaccessible target metadata, or a requirement to weaken validation. Report verification failures rather than swallowing them. Future validation additions that genuinely require target contents should use an explicit canonical read at that point, not quietly expand ObjectSummary or restore SELECT * for all targets.
