# Plan 023: Evaluate multiple-reference membership through target-first derived edges

## Status
- Priority: P1; effort: M; risk: MED; category: perf.
- Planned at: `eb324c4e05ed73243dabc6242422baea4e855c67`, 2026-09-27.
- Depends on: none. Can share a single sequential executor with 021/022/024.
- User authorizes this query change, not extra indexes, FTS, JSONB, schema migrations, or a new query engine.

## Drift check
`git diff --stat eb324c4..HEAD -- src/objects/views.ts test/objects-views.test.ts scripts/sqlite-bench.ts test/sqlite-bench.test.ts docs/object-contract.md docs/sqlite-benchmarks.md`. Reconcile same-series changes only; stop on unrelated drift.

## Why
The current multiple-reference contains predicate runs json_each for every candidate object. The schema already transactionally maintains property-specific reference edges and an index on target_id. A target-first subquery can retrieve matching object IDs directly. On a 10,000-object/90,980-edge dense synthetic fixture, a one-match query fell from about 20.81 to 0.088 ms and a 7,097-match query from 37.79 to 27.40 ms, with no additional index. These are exploratory warm measurements, not a universal production guarantee.

## Current state and invariant
- `src/objects/views.ts:139–164`, sourcePredicate accumulates source type/trash predicates and bound values. Multiple-reference contains currently generates:
  ```ts
  EXISTS (SELECT 1 FROM json_each(${expression(property.id)}) AS member WHERE member.value COLLATE NOCASE = ?)
  ```
- `ViewService.evaluate` combines sources with UNION ALL, orders source-major/property/missing/title/ID and uses LIMIT 101 for 100 display rows.
- `ViewService.act` calls the same sourcePredicate inside its immediate transaction, alongside publication/capability/view-revision/object-revision checks. Do NOT create separate read and command predicate semantics.
- `src/schema.ts:51–55`: object_references has NOCASE source_id and target_id, primary key(source_id,target_id,property_id), and object_references_target(target_id). property_id='' means a writing link; real reference fields have their stable UUID property identity.
- `ObjectRuntime.indexReferences` updates edges atomically with canonical writes. Trashed targets can remain referenced. Filtering by target must not accidentally require target.trashed=0; source trash filtering remains mandatory.
- `scripts/sqlite-bench.ts` already compares JSON membership, correlated edge EXISTS, and an optional composite index, validates ordered IDs/full counts, and safely owns disposable fixtures. Preserve that historic comparison rather than relabeling it as the new production algorithm.
- Ordinary direct SQL with prepared values, AppError, node:test and node:assert/strict are the conventions. Tests in objects-views and sqlite-bench contain existing upper-case/provenance/ordering cases.

## Scope
Only `src/objects/views.ts`, `test/objects-views.test.ts`, `scripts/sqlite-bench.ts`, `test/sqlite-bench.test.ts`, and focused changes to `docs/object-contract.md` / `docs/sqlite-benchmarks.md`. No schema/runtime/HTTP/UI/model/generator changes for this plan. No additional index, forced INDEXED BY, migration, or caching.

## Steps
1. Add direct behavioral tests with real runtime objects/views for the intended target-first membership. Capture and inspect the actual production evaluated SQL only where necessary to establish the bounded no-json_each query path; do not introduce a production testing API. Compare actual records, order, truncation and command success/rejection. Run `bun test test/objects-views.test.ts test/sqlite-bench.test.ts` to establish the current behavior and expected new-path failure.
2. Change only the multiple-reference contains branch to a noncorrelated subquery of this shape:
  ```sql
  o.id IN (
    SELECT source_id FROM object_references
    WHERE property_id = ? AND target_id = ?
  )
  ```
  Bind the property UUID and the literal/resolved-input target in exact SQL placeholder order. Ensure the existing generic values.push does not leave an extra/misordered binding. Existing column NOCASE identity must be respected for target and source. Do not alter scalar reference equality/notEquals, text substring semantics, empty/notEmpty, temporal comparisons or missing input handling. Verify focused tests pass.
3. Extend the existing benchmark narrowly to report a clearly named target-first/no-added-index candidate alongside historical JSON/correlated-edge/composite scenarios. Keep IDs, complete counts, 101 lookahead, projection and ordering equivalent. Capture EXPLAIN QUERY PLAN before/after stats as appropriate and assert use of the existing target index in a realistic populated fixture, not fragile exact plan text. Preserve cleanup, comparable phases, opt-in profiles, and no fake write-cost measurements. Report zero incremental DDL/storage for a query-only change, with baseline canonical edge maintenance already paid. Run `bun test test/sqlite-bench.test.ts`; keep runtime bounded and no normal timing assertions.
4. Run the default `bun run sqlite:bench` on owned synthetic DBs only; summarize observed benefit/regression honestly in docs. Include sparse/common/rare cases and do not claim cold-cache or durable-write results. Finish `bun run check`, `bun test`, `git diff --check`.

## Required semantic tests
- Literal and input-bound multiple-reference contains; uppercase targets and stored reference values.
- Correct property identity; exclude writing-only and another-property-only edges; empty/missing arrays.
- Add/replace/remove references, retained trashed targets, excluded trashed sources.
- Combined scalar/date filters with multiple contains clauses, including placeholder ordering and source type boundaries.
- Multiple sources, stable title/ID ordering, more than 100 matches and explicit truncation.
- Commands on a published editable input-bound view: correct input succeeds, wrong input/wrong property/no membership rejects without changes, removed membership rejects freshly, stale revisions/publication/capability remain enforced.
- Benchmark checks actual complete counts and ordered IDs; its intentionally missing derived-edge regression must still fail instead of reporting equivalent results.

## Done criteria
All listed semantic cases pass through actual ViewService methods. The production membership predicate uses target-first existing edges for reads AND commands. No schema/version change or extra index. Existing benchmark contracts and cleanup tests pass. `bun run check`, `bun test`, `bun run sqlite:bench`, and `git diff --check` pass. Docs distinguish historic experiments from this adopted query-only optimization and preserve deferral of unrelated index/FTS candidates.

## Workflow and STOP
Use Bun 1.4.2+ and `bun install --frozen-lockfile` only if needed. Commit within the assigned isolated worktree, never merge/push or touch .data. Reviewer owns plans index. Stop if canonical edges prove insufficient to preserve current semantics, input-bound or action checks diverge, more schema/index changes are required, or verification fails twice after reasonable repair. Do not mask a failing benchmark by weakening its comparison. Future property kinds/operators must deliberately preserve property provenance and shared read/write scope checks.
