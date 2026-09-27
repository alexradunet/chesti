# Plan 020 — owner-authorized additional benchmark repair

## Authority, base and outcome
On 2026-09-27 the owner explicitly said **“i authorize another one”** after the second repair was blocked. Gate `gate_63220a55eeb3` is resolved for **one additional bounded repair plus independent review**, not more automatic review rounds. You are a separate Pi implementation executor, not the read-only improve advisor.

Work only in `/home/alex/orca/workspaces/GenUIExperiment/sqlite-reviewed-integration`, branch `alexradunet/sqlite-reviewed-integration`, clean starting HEAD **`8e61f6a5b06f1c078529c74fb6fe644efa2a7b94`**. Last approved application/integration checkpoint is `9282c6d13d9228f1c5c16e3de018447b89db985b`. Original master is `133f8a6` and must stay untouched. The prior worker has exited; you are the sole writer. No setup/install needed unless dependencies are genuinely absent, then Bun frozen lockfile only.

Outcome: finish the existing three synthetic experiments (property expression index, reference membership, FTS candidate + exact literal LIKE) with trustworthy comparable costs and real semantic regressions. Preserve existing correct read SQL/projection/order, NOCASE/reference provenance, explicit FTS integer identity and conservative Unicode/special-character fallback. No production adoption. A negative result is valid; invented/missing measurements are not.

## Scope
Only `scripts/sqlite-bench.ts`, `scripts/sqlite-fixture.ts`, `test/sqlite-bench.test.ts`, `test/sqlite-storage.test.ts`, `docs/sqlite-benchmarks.md`, `docs/sqlite-measurements.md`, `package.json`, and only necessary changes. No `src`, other application code, dependencies/lockfile, engine upgrade, production schema/index changes, user database paths/`.data`, provider calls, `.agents`, plans edits, merge/push/reset, browser/UI changes or subdelegation. Native beforeunload-dialog cancellation remains unverified under an earlier owner-approved exception; do not claim otherwise.

Read current README, object contract, the entire benchmark/fixture/tests/docs and actual runtime/views callsites. Match strict TS and node:test/node:assert/strict conventions. Prefer direct functions and `try/finally`, not a generic benchmark framework. Existing script/report types can change with all local test/doc callers. Do not keep dead placeholder fields for compatibility.

## Work in this order; write regressions before claiming fixes

### 1. Correct property index identity and equivalent write samples
Current `propertyIndexScenario` derives a JSON path from the read fixture, then uses that path when creating an index in a NEW `candidateWrites` database. UUIDs differ. Lead inspected actual CREATE INDEX statements: read fixture ID matches; write fixture ID does not. Its property index indexes NULL, not the dates being changed.

- Derive every index's path from the fixture/database that owns the measured records. Add a regression checking actual index DDL/expression values, not a metadata boolean. Verify an update changes the indexed value on both measurement paths.
- Use deterministic per-sample values; remove `Math.random()` for write schedules. Keep the same title/body/property changes, body byte budget, initial revision/history and operation count on paired sides. Candidate differs only in the index/maintenance. Measure insert AND update medians/spread/sample count. Do not compare an empty-body FTS boundary object to a normal large-body baseline page.
- A simple option is same-fixture per-sample savepoints: restore state outside the timed interval, toggle the relevant candidate between phases, and label timings as canonical write/maintenance work excluding outer commit/rollback/fsync. Separately built fixtures are also fine if their logical workloads are actually equal and IDs are resolved locally. Pick one clear approach, document its scope, do not build both.
- Prove comparability in tests with captured writes or explicit measured record inputs/history, not merely timing values >= 0. Probe values must remain bounded through all 20 warmups and 50 repetitions; derive from an initial base or alternate fixed values, never append cumulatively.

### 2. Real setup/build timing and complete failure cleanup
Current `collectOne` builds a fixture then reports `const setupMs = 0`. Measure real elapsed setup and name the included work. If there are several read/write fixtures, report individual/total setup consistently; do not report unmeasured values as zero. Record index/FTS build time separately from read/write timing and use dbstat bytes for storage, not main-file size under WAL. The FTS key-table unique index is part of its added storage too.

Current `searchScenario(f,0,30)` with 24 objects/64-byte bodies fails `Title must contain 1–500 characters.` and leaks its internal baseline fixture. Several pairs/triples are also allocated before `try`, leaking earlier successful allocations if a later creation fails.

- Register cleanup immediately after each successful fixture construction; ensure every acquired fixture closes/removes in finally on success, semantic failure, measurement failure and partial initialization. Propagate the original error, not fake-success output. Restrict cleanup to owned paths.
- Permanent tests: run the original 30-repetition repro and a small report at maximum 20 warmups/50 repetitions; both pass without growth errors. Inject a failure after at least one internal fixture has been created and assert exact owned directories are removed. Do not assert against unrelated shared-/tmp directories. Preserve existing storage cleanup coverage.
- Regression for setup timing must establish that reported data comes from the measured construction, not a constant. No machine-speed threshold. A controlled clock in a scoped test or structurally checked report setup accounting is preferable to a brittle latency assertion.

### 3. Finish a SMALL real selectivity/array matrix (no Cartesian explosion)
The latest report calls profiles sparse/dense, but both have only missing arrays or length two with essentially the same fraction. Rare targets are listed, never queried. All property timings use one Page/date threshold. Fix the actual workloads, not only labels.

Smallest complete design: two named profiles (modest writing/sparse arrays; larger writing/dense arrays), and a few queries per read experiment, reusing each profile's read fixture. The matrix must actually include:
- Common and rare type/property selections, with counts and corresponding executed queries. For example, a rare synthetic type sharing the chosen date property plus common/rare date predicates; create it consistently rather than changing a referenced Page's type after the fact. Compare each with actual validated ViewService results.
- Arrays of genuinely different bounded lengths (e.g. 2 vs 12 when enough targets exist), live and trashed sources, history, and common/rare queried targets with nonempty matches. Report actual array-length/type/match distributions and any small additional semantic records separately from requested object counts.
- `json_each` vs edge EXISTS using existing indexes FIRST; optional composite candidate separately with its own plan/read/write/build/storage. Existing-index alternative needs its full measurement, not only notes.
- Preserve source-major/property/title/UUID ordering and 101-row lookahead / 100-row display cap. Check semantic equality and truncation before reporting comparable costs. A failed equivalent case must throw/nonzero; include an actual scenario failure regression (e.g. remove one derived reference edge in an owned fixture so JSON/view and candidate differ), not just a unit test of `assertSameIds`.
- Compare equivalent state; read probes before mutations. Alternate existing-index/FTS baseline and candidate timing order where practical; label fixed expression-index phases honestly. Record relevant before/after-statistics plans without silently attributing ANALYZE's benefit to an index.

Keep benchmark-only properties/profile changes opt-in so the storage diagnostic's ordinary workload stays unchanged. Remove unused status/score/flag metadata if it only adds complexity. Do not add CLI flags/services for hypothetical future experiments.

### 4. Finish meaningful semantic tests, then make docs exactly match
- Chosen date property: explicit missing, exactly-at-boundary, before, after, and trash records. Assert expected IDs/order with actual ViewService and candidate; do not claim date-only comparisons verify datetime offsets/false/zero.
- Reference: a LIVE uppercase-stored match; exact property ID versus another-property-only edge and writing-only edge; missing/empty arrays; change/remove/replace an edge canonically; source trash exclusion; a target actually trashed AFTER establishing valid references, with retained references still queried; and >100 results with exact cap/lookahead/truncated assertions. Keep reference write probes independent of that trashed target. Assert known positive and negative IDs, not just a boolean from the implementation. The current “retained target” test never trashes a target.
- Search: retain actual candidate-or-baseline dispatch, safely quoted ASCII eligibility, `😀a`/Unicode/wildcard/quote/operator fallbacks, known title/body positive and negative records, insertion/replacement/removal/trash/restore and explicit key/rowid consistency. Keep exact original LIKE and ordering as authority. Do not return canned fallback lists or skip failing cases. No production search maintenance is authorized.
- Fresh docs: exact invocations, actual fixture distributions, read/write/build/storage measures with units/sample counts, plans, fallback/semantic limitations and per-candidate adopt/defer conclusion. No promise of real-user speedups. No claims unsupported by the new tests/artifacts. JSONB/deep pagination remain deferred. Previous benchmark conclusions are unapproved and must not be copied as evidence.

## Verification / completion checklist
Run from this isolated checkout; use a NEW owned /tmp evidence directory and preserve earlier evidence:

```sh
bun run check
bun test test/sqlite-bench.test.ts test/sqlite-storage.test.ts test/database-backup.test.ts
bun test
bun run sqlite:bench
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=2 --repetitions=5 --warmups=1
bun run sqlite:bench -- --objects=24 --large-objects=30 --body-bytes=64 --revisions=0 --reference-every=2 --repetitions=50 --warmups=20
bun run sqlite:runtime
bun run sqlite:storage
bun run sqlite:storage -- --objects=20 --body-bytes=256 --revisions=1 --checkpoint
git diff --check 9282c6d..HEAD
git diff --exit-code 9282c6d HEAD -- src
```

Also verify changed-file scope and clean status after committing. Do not weaken tests to make commands pass. Normal tests use small fixtures/no timing thresholds or network/credentials. Prior combined suite has 124 tests; meaningful regressions matter more than a target count. Routine edit/test iterations within this assignment are fine, but no autonomous post-review follow-up is authorized.

STOP on unexpected checkout drift, scope expansion, inability to satisfy the above without changing product semantics, or missing authority. Ask the coordinator rather than silently narrowing the agreed workload. Commit scoped changes locally. Audit every completion claim against actual outputs. Report `STATUS: COMPLETE | STOPPED`, per-section (1–4) actual regression names and evidence, all commands/counts, path/branch/HEAD, files changed, deviations and remaining limitations. Send one accurate worker_done and end the turn. A suite passing while any numbered criterion is unfulfilled is STOPPED, not complete.
