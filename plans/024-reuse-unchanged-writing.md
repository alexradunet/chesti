# Plan 024: Reuse unchanged writing derivations during canonical object updates

## Status
- Priority: P1; effort: M; risk: MED; category: perf.
- Planned at: `eb324c4e05ed73243dabc6242422baea4e855c67`, 2026-09-27.
- Depends on: none semantically. Recommended after Plan 022 in the same single-writer checkout because both touch target validation in runtime.ts.
- User authorizes optimization of existing writes, not skipping revisions, dropping history, moving authority, or schema changes.

## Drift check
`git diff --stat eb324c4..HEAD -- src/objects/runtime.ts src/objects/markdown.ts test/objects-runtime.test.ts test/objects-markdown.test.ts test/objects-views.test.ts docs/object-contract.md`. Reconcile intentional earlier 021–023 changes; stop on unexplained changes.

## Why
A property-only update of a 240,000-byte document currently performs four Markdown parses (960,000 bytes processed) and reloads the source three times. It regenerates body_text and rewrites writing edges despite exact unchanged writing. Reuse derived work without creating a privileged fast-write path.

## Current state
- `src/objects/runtime.ts:281–290`: patchProperties loads the previous full object, checks revision and patch shape, merges properties, then calls updateObject with the unchanged title/body. updateObject reloads the previous record, validates all values, remembers a complete historical snapshot, updates body_text via markdownText(write.body), reloads the result and calls indexReferences.
- `validateValues` at lines 353–356 computes previous and submitted markdownReferences independently and checks each submitted target against retained trash rules.
- `indexReferences` at lines 382–389 deletes all source edges, inserts property edges, then reparses Markdown to insert writing edges with property_id=''.
- `src/objects/markdown.ts`: markdownReferences uses Bun.markdown.render to extract real local links; markdownText separately derives search text. Raw HTML/images/code examples do not create links.
- `setTrashed` validates the full previous write and saves a snapshot, but does not rebuild edges. It must not lose typed/self-reference or built-in rules during refactoring.
- `test/objects-runtime.test.ts` uses node:test, strict assert, in-memory DBs and explicit failed-write state checks. Match these; no global cache, DI layer or boolean-flag maze.

## Boundaries
Writing is exact Markdown, not normalized text. Unchanged body does not excuse reference existence/type/trash validation. Retained trashed links are allowed; newly added ones reject. Type changes may invalidate incoming references and must remain checked. Canonical writes, previous snapshot and edge updates commit atomically at the expected revision; normal saves retain their revision/history semantics even when content is unchanged. Creation fingerprints and receipts still use submitted content before built-in Task normalization.

## Scope
Only `src/objects/runtime.ts`, `src/objects/markdown.ts` if a coherent derived-writing helper truly simplifies the flow, `test/objects-runtime.test.ts`, `test/objects-markdown.test.ts`, `test/objects-views.test.ts`, and focused docs/object-contract.md wording. Do not edit schema.ts, database setup, HTTP/UI, upgrade-markdown.ts, generator or dependencies. Do not rewrite the older upgrade behavior or introduce content-addressed bodies.

## Steps
1. Add a regression around real canonical property edits showing unchanged Markdown source, body_text, writing backlinks, reference checks, and snapshots. Instrument Bun.markdown.render or an existing method only within the test with reliable restoration to count parses; pair operation-count assertions with actual persisted behavior. Establish the existing redundant work using `bun test test/objects-runtime.test.ts test/objects-markdown.test.ts`.
2. Refactor writing-derived values into request/transaction-local reuse only. Compute parsed submitted writing links once and reuse for validation/indexing. If previous.body === write.body, reuse the same link set for retained membership checks rather than parsing twice. Do not bypass link checks solely because source matches. A small private method/data value is acceptable if it captures this coherent rule; avoid unrelated optional flags or new public write commands. Verify focused tests pass.
3. When exact Markdown is unchanged, avoid recomputing body_text and avoid deleting/reinserting writing edges. Preserve existing writing edges and still validate canonical links. Refresh property edges without deleting property_id='' edges; do not silently treat an absent/corrupt edge as an authorization fallback. For writing changes, rebuild only the relevant writing edges using the already-computed set and regenerate search text. All changes remain in the same write transaction. If simpler, property edges may still be rebuilt on every update initially; do not invent a generic diff engine. Verify `bun test test/objects-runtime.test.ts test/objects-views.test.ts test/objects-http.test.ts test/objects-upgrade.test.ts`.
4. Removing duplicate source reads inside patchProperties is optional only if it makes the common private update implementation clearer and preserves all public validation. Do not broaden the refactor solely to reach a particular query count. The required win is less repeated Markdown work and no churn of unchanged writing derivatives. Test actual published view actions as well as direct patchProperties. Document the changed internal behavior conservatively.
5. Run `bun run check`, `bun test`, `git diff --check` and a provider-free isolated writing/reference probe. Use operation counts rather than machine-dependent normal-test timing thresholds.

## Required tests / done criteria
- A title/property-only save of substantial exact Markdown retains body, body_text, writing edges and full prior revision snapshot, with fewer parses than the old four and no rewriting of unchanged writing derivations. Use a narrowly scoped test trigger or trace if useful to prove no body_text/writing-edge rewrite; do not weaken the database in production.
- Actual writing edits update search text and add/remove/dedupe the correct parsed writing links. Properties and writing linking the same target retain distinct provenance.
- Retained trashed target links succeed; newly introduced trashed/missing target links reject atomically. Repeat through changed and unchanged bodies and type/property writes where relevant.
- A stale write does not mutate object/history/edges. An injected derived-edge persistence failure after validation rolls back object, history and all edges. Do not force a write to unchanged derivatives just to trigger an outdated failure fixture; exercise an actually changed derivative for the rollback test.
- Creation receipts/replays, daily Journal uniqueness, Event/Reminder exclusivity, typed self-references and incoming-reference type changes remain intact.
- All focused/full tests, strict TypeScript and diff hygiene pass with no extra schema, runtime dependency or UI behavior.

## Commands / git / STOP
Bun 1.4.2+; install only with frozen Bun lockfile if needed. Use openDatabase() or explicitly owned temporary files, never user's .data. Commit logical changes on assigned isolated branch; no merge/push. Reviewer updates plan index. Stop if the approach requires trusting stale external derived data instead of validating authoritative Markdown, changing revision semantics, schema migration, code outside scope, or a second failed verification repair. Future optimizations must preserve authoritative Markdown and all-or-nothing snapshots/edges rather than introducing a separate patch bypass.
