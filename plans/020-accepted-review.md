# Plan 020 — additional authorized repair accepted

**APPROVED `cc46cae2bfb8eadb46ec70e49e5c3c238f3040d7`**, 2026-09-27, after the owner's explicit “i authorize another one”. This supersedes the blocked benchmark verdict at `8e61f6a`, not its historical findings. Gate `gate_63220a55eeb3` authorized this one repair/review; no further work, master merge, push or production optimization is implied.

## Delivered review branch
- Branch: `alexradunet/sqlite-reviewed-integration`
- Checkout: `/home/alex/orca/workspaces/GenUIExperiment/sqlite-reviewed-integration`
- New commits: partial checkpoint `a83fa90b5d0d5ebf336d9420dbe06e753b71f92c`, complete repair `cc46cae2bfb8eadb46ec70e49e5c3c238f3040d7`.
- Exactly six authorized changed files: `scripts/sqlite-bench.ts`, `scripts/sqlite-fixture.ts`, `test/sqlite-bench.test.ts`, `test/sqlite-storage.test.ts`, `docs/sqlite-benchmarks.md`, `docs/sqlite-measurements.md`.
- Production `src` remains byte-for-byte identical to the independently reviewed 015–019 integration `9282c6d`. No dependencies/package/lockfile/runtime, original master, `.agents`, owner workspace plans, real databases, UI or provider integration changed in this repair.

## Review findings closed
Lead read the complete implementation, tests, fixture/doc changes and report, not just test counts.

1. **Index identity/write comparability:** same-fixture write probes derive DDL from their actual owning property ID. Canonical insert/update inputs, initial history/revisions and body bytes match on both sides. Per-sample savepoints restore state outside timing. Tests capture actual operations at 20 warmups/50 samples and inspect real DDL/indexed date values; no random schedules or append growth remain.
2. **Real setup/build/storage:** setup uses the actual constructor's elapsed time. A controlled-clock regression proves construction-derived measurement. Build time is separate; storage uses dbstat, including FTS key uniqueness. Independent reports have genuine nonzero setup durations, not the former constant zero. Existing-reference-index costs correctly distinguish no new schema/maintenance from the optional composite.
3. **Repetition and cleanup:** the original 30-repetition path and full maximum-sample CLI pass. Internal paired/triple fixture allocations were removed; the single owned profile fixture is cleaned in finally. Tests force post-construction, candidate measurement and later-profile construction failures and verify exact owned-directory removal/closure while preserving the original failure. No unrelated /tmp sweep.
4. **Actual matrix/equivalence:** three executed property predicates cover common Page/date, rarer Page/date and rare type. Both common/rare reference targets are timed against JSON, existing indexes and the optional composite. Sparse arrays are length two; dense arrays genuinely reach length twelve. All reads precede write setup, candidate schema is removed between experiments, and mismatched real reference edges cause a thrown scenario failure rather than successful false-equivalence output. Reference/FTS paired reads alternate order; fixed property/write phase order and shared warm statistics are documented.
5. **Meaningful semantics/report:** tests assert known date boundary/missing/trash/order IDs; live uppercase/property-versus-writing provenance; canonically replaced/removed references; an actually trashed target with retained references; exact 101/100 lookahead/display/truncation; and search positive/negative/fallback/mutation/key identity cases. Unicode `😀a` uses real baseline fallback. Docs were regenerated from current artifacts and explicitly limit timing and adoption claims.

The implementation uses ordinary functions, one profile fixture, savepoints and Bun/SQLite APIs. The existing direct architecture is retained; no production maintenance framework or speculative optimization was introduced.

## Independent verification
All commands below were rerun by lead in the isolated checkout at the unchanged clean final HEAD:

- `bun run check` — strict TypeScript passed.
- `bun test` — **128 pass / 0 fail**, 15 files.
- `bun test test/sqlite-bench.test.ts test/sqlite-storage.test.ts test/database-backup.test.ts` — **19 pass / 0 fail**.
- `bun run sqlite:bench` — passed, `/tmp/sqlite-bench-authorized-lead.json`.
- `bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=2 --repetitions=5 --warmups=1` — passed, `/tmp/sqlite-bench-authorized-matrix-lead.json`.
- `bun run sqlite:bench -- --objects=24 --large-objects=30 --body-bytes=64 --revisions=0 --reference-every=2 --repetitions=50 --warmups=20` — passed, `/tmp/sqlite-bench-authorized-max-lead.json`.
- `bun run sqlite:runtime` — passed, `/tmp/sqlite-runtime-authorized-lead.json`, Bun 1.4.2 / SQLite 3.53.2; no newer-runtime upgrade claimed.
- Default `sqlite:storage` and `-- --objects=20 --body-bytes=256 --revisions=1 --checkpoint` — passed, `/tmp/sqlite-storage-authorized-lead.json` and `/tmp/sqlite-storage-authorized-small-lead.json`.
- `git diff --check 133f8a6..HEAD`; `git diff --exit-code 9282c6d HEAD -- src`; clean status/unchanged HEAD — passed.

Additional independent JSON assertions checked exact read IDs/view caps/truncation, nonempty selected matches, owning read/write DDL equality, actual/requested counts, real setup values, write revision/history/body-byte accounting, measured sample counts, indexed update values and inclusion of the FTS unique index in storage. All passed across default, larger-writing and maximum-sample reports. Default property matches are 373/46/9 at 1k and 3780/466/75 at 10k; reference common/rare matches are 101/1 and 7097/1. Sparse/dense lengths are 0/2 versus 0/2–12. Timing values differ between runs as expected; no exact latency threshold or real-user performance guarantee is asserted.

## Conclusions and retained limits
Property indexing helps these static synthetic date queries. Reference strategies are workload-dependent; FTS loses on the common bounded query but can help the selected rare needles at significant storage/build/maintenance cost. **Defer all production adoption** pending representative need and separate migration/maintenance scope. Savepoint write/build timings exclude outer commit/rollback/fsync; they are not durable end-to-end latency. JSONB and deep pagination remain deferred.

The native beforeunload-dialog cancellation check remains **unverified** under the owner's earlier continuation exception. This repair changes no UI and does not claim to close it. No real provider call or user-data performance test was run. Owner plans 012/013 remain untouched; their future format/version still needs reconciliation with the preserving version-4 initializer.

## Lifecycle
Task `task_5e2cedde092b`, Dispatch `ctx_772edbb6cc0b`, worker `term_b91a77b1-99c8-4f42-9f77-ef3fddbae3df` completed. Native `worker-release` returned **retained/user_takeover**; worker-show confirms `user_owned`, not a disposable terminal. Lead left it untouched rather than forcing closure. Supervised dispatch is settled, but that user-owned terminal remains live. Prior release-metadata anomalies remain recorded separately. Worker report/evidence: `/tmp/taskdesk-plan020-evidence-dNPOs4/`; lead's verdict is independent of its completion claim.
