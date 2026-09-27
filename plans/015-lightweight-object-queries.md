# Plan 015: Use indexed typed browse and bounded lightweight reads

> Executor: implementation is authorized only in the assigned isolated Orca checkout. Follow the gates, stop on unsafe drift, and commit there; do not merge/push or edit the original checkout. The coordinator owns `plans/README.md`.
> Drift check: `git diff --stat 133f8a6..HEAD -- src/objects/runtime.ts src/objects/model.ts src/objects/views.ts src/objects/http.ts src/objects/render.tsx test/objects-runtime.test.ts test/objects-views.test.ts test/objects-http.test.ts test/objects-upgrade.test.ts README.md docs/object-contract.md docs/quickstart.md`. Expected predecessor changes are described in the assignment; compare actual code before editing.

## Status
- Priority: P1; effort: M; risk: MED; category: performance/correctness.
- Planned at: `133f8a6`, 2026-09-27.
- Depends on: none. Selected research priority 1.

## Outcome and current state
Retain the relational-plus-JSON schema and existing indexes. Remove unnecessary full-document materialization from browse, lookup, picker and view paths, and prevent an object's backlinks from loading an unbounded set of documents.

`src/objects/runtime.ts:299` currently selects full objects with:
```sql
WHERE trashed = ? AND (? IS NULL OR type_id = ?)
AND (title LIKE ? ESCAPE '\' OR body_text LIKE ? ESCAPE '\')
ORDER BY updated_at DESC, id LIMIT ? OFFSET ?
```
An isolated 20,000-row skewed fixture selected `objects_browse`; a direct type predicate selected the existing `objects_type_browse`. Measured medians were 13.38 ms versus 0.23 ms, not a production speedup promise. Browse/pickers use `listObjects` in `http.ts:128,163,227,265`; selected-reference fallbacks also load full records. `views.ts:251` selects `o.body` despite no view component using it. `runtime.ts:390` uses unbounded `SELECT o.*, r.property_id` for backlinks. `render.tsx:453` displays only backlink titles/links/provenance.

Keep `getObject`, writes, history snapshots, receipt replay, Journal reads and full `listObjects` semantics intact where full records are genuinely needed. A summary must not pretend to be an `ObjectRecord` by supplying empty writing or properties. The model in `src/objects/model.ts` remains type authority.

## Scope
Only: `src/objects/{runtime,model,views,http}.ts`, `src/objects/render.tsx`; `test/objects-{runtime,views,http,upgrade}.test.ts`; `README.md`, `docs/object-contract.md`, `docs/quickstart.md`. New `test/objects-query-plan.test.ts` is allowed if a focused query-plan fixture warrants separation.
Out of scope: schema/index changes, generated SQL extensions, search semantics, JSONB/FTS, query caches, workspace plans 012–014, editor/client rewrites, dependencies, `.data/`, provider calls.

## Commands and conventions
Use Bun 1.4.2+, `bun install --frozen-lockfile` only if dependencies are absent, `bun run check`, `bun test`, `git diff --check`. Baseline: typecheck and 91 tests pass. Tests use `node:test` and `node:assert/strict`; `test/objects-runtime.test.ts:20` opens `openDatabase()` and closes it in `t.after`. File tests use `mkdtempSync` and explicit cleanup. Read README and the object contract before editing. Use ordinary methods, prepared values and `AppError`.

## Steps
1. **Characterize and fix predicate selection.** Preserve literal `%`, `_`, backslash, Unicode/case, title/body search, trash, ordering, offsets and invalid bounds. Generate a small bounded set of trusted SQL shapes: include `type_id = ?` only for a supplied type and include search predicates only for a nonempty search. Keep all user values bound. Both full and summary browse must use the same validated filtering rule, without a generic query builder or caller-selected projection.
   - Verify: `bun test test/objects-runtime.test.ts` passes; a deliberately skewed fixture demonstrates identical IDs/order and `EXPLAIN QUERY PLAN` use of `objects_type_browse` for the actual typed statement. Avoid fragile full-plan snapshots or wall-clock test thresholds.
2. **Add explicit lightweight record types and migrate actual consumers.** Add a minimal summary type (only fields used in browse/pickers/backlink labels) and a body-free view projection containing the properties/revision required by views. Add explicit summary list and selected-ID read methods; retain the full-record API for commands/tests that truly need writing. Share meaningful query/validation logic, not a flags-based projection API. Update model, HTTP pickers, lookup, selected-reference fallbacks, view input display and rendering signatures together. View command execution must still reload/check the full canonical object.
   - Verify: `bun run check && bun test test/objects-runtime.test.ts test/objects-views.test.ts test/objects-http.test.ts` passes. New assertions prove summary/view rows omit body rather than fabricate it, while canonical reads retain exact Markdown. Audit prepared SELECT columns, including out-of-window and trashed selected references.
3. **Paginate backlinks without truncating them invisibly.** Use deterministic existing ordering `updated_at DESC, id, property_id`. Return at most 50 displayed edges with one-row lookahead and explicit continuation, using the existing bounded-offset pattern (0–1,000,000). Each property edge and writing edge remains distinct; include trashed sources as today and retain case-insensitive target lookup. Update all callers/tests. Native Previous/Next links on the object's Linked from section may use a bounded `backlinksOffset` query parameter and `#object-backlinks`; no automatic navigation, autosave or revision changes. Rejected/historical drafts must not lose fields or submitted revisions. Do not show an inaccurate "no backlinks" message merely because the first page was not loaded on a draft response.
   - Verify: focused runtime/HTTP tests pass with more than two pages, equal timestamps, multiple edges from one source, trashed sources, mixed-case target, empty/last pages, and invalid/repeated offset input. Reading every page leaves objects, history, edges and receipts unchanged.
4. **Exercise user-facing paths and document the read contract.** Use a disposable fixture server and Orca's embedded browser only. Check typed List/Gallery search and pagination, native reference selections (including old/trashed retained values), saved-view rendering/actions, backlink Next/Previous and source links. For backlinks, verify keyboard activation/focus and approximately 390px layout, and cancel attempted navigation from a dirty editor without losing title/writing. Verify native HTTP navigation as well as enhanced flow; do not claim HTTP proves layout. No real generation is necessary. If Orca cannot establish trusted interaction, record the blocker rather than changing browser tools.
   - Verify: record exact fixture/actions/results and screenshots outside user data; `bun run check && bun test && git diff --check` all exit 0. Document 50-edge pages and the distinction between read projections and canonical objects in existing docs.

## Done criteria
- Typecheck/full suite/hygiene pass; no out-of-scope file changes.
- Typed browse uses direct predicates and the existing type index on the measured fixture.
- HTTP browse/picker/lookup and evaluated rows do not load unused Markdown; canonical writes/history preserve it exactly.
- Every backlink remains reachable through bounded native pages, with provenance/trash semantics intact.
- Actual Orca browser gates pass or are explicitly BLOCKED, never replaced by jsdom/HTTP claims.
- Isolated commit and report include commands, results, remaining limits; coordinator updates status.

## STOP conditions / maintenance
Stop on unexpected source drift, a need for a new index/storage migration, lost drafts/revisions, changing literal search semantics, missing existing-selection labels, an unlisted file, or two failed repair attempts. Do not solve performance by omitting data silently. Future schema/workspace work must carry these projections and native links forward; benchmarks are synthetic evidence, not latency guarantees. Use a short imperative commit subject such as `Bound lightweight object reads`; preserve all user/unrelated work.
