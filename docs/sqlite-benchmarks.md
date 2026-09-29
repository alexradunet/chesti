# SQLite benchmark experiments

These disposable synthetic experiments document bounded query/storage tradeoffs for the v7 fixed-domain schema. Property expression indexes and FTS search candidates are measured; JSONB, deep pagination, and added indexes remain deferred.

## Reproduce

Bun 1.4.2+, checked-in dependencies, no provider credentials/network:

```sh
bun run sqlite:bench
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --repetitions=5 --warmups=1
bun run sqlite:bench -- --objects=24 --large-objects=30 --body-bytes=64 --revisions=0 --repetitions=50 --warmups=20
```

Only owned temporary databases are opened. `DATABASE_PATH` is ignored and caller-selected database paths are rejected. Normal tests have no timing thresholds.

## Measurement contract

One fixture per profile is reused by all experiments; there are no internal baseline/candidate fixture pairs. `setupMs` measures directory/database/schema creation, canonical objects/history and trash. Profile setup is measured independently. Candidate builds and write-probe setup are not part of that number.

All read probes precede write probes. Property queries use the same body-free ViewService projection, ascending date, title/UUID ordering, 101-row lookahead and 100-row display. Search queries use FTS5 trigram matching with literal LIKE fallback. A mismatch throws; timing results are not returned as equivalent.

Read results contain median, p95, min/max milliseconds and measured sample count. Property reads have fixed analyzed-baseline then indexed/analyzed-candidate phases, explicitly labeled. Reference JSON/edge and LIKE/FTS reads alternate execution order per sample. Initial and post-ANALYZE plans are retained; later scenarios reuse the fixture's existing statistics. Warmups exclude the untimed semantic validation reads, so these are warm/in-process measurements, not cold-cache or end-to-end request benchmarks.

Writes use the **same database, submitted title/body/properties, initial revision/history, and number of operations** on both sides. Each sample restores its pre-write state via a savepoint **outside** the timer. The body has exactly the profile's base byte budget; updates replace it with another fixed synthetic body, not accumulated suffixes. Candidate DDL commits before its phase to avoid measuring schema-reprepare artifacts from rolling back beneath uncommitted DDL. Timings include canonical insert/update plus candidate maintenance, but **exclude probe setup, inspection, outer commit/rollback and fsync**. They are not durable write latency. Baseline phase precedes candidate phase; cache/order bias remains possible.

Each write experiment adds two dedicated canonical setup objects after all reads, then rolls back every measured mutation. Thus four write-setup records are separate from requested object counts. Search adds two temporary semantic records during reads and rolls them back afterward. These counts are explicit in the report.

Build times measure index DDL or FTS key-table/FTS population inside the read experiment's savepoint, excluding outer commit/fsync and ANALYZE. Storage uses `dbstat` allocated bytes, **not** main-file/WAL deltas. FTS storage includes all shadow tables, the explicit integer-key table **and its unique object-ID index**.

## Fixture matrix and checked evidence

Fresh evidence: `/tmp/taskdesk-plan027-evidence-v7/` (`default.json`, `large-writing.json`, command stderr logs, focused/full test logs). The default run used Bun 1.4.2 / SQLite 3.53.2, WAL, synchronous=2, trusted_schema=0; full engine/source identity is in each JSON report.

Default profiles:

| Profile | Requested records | Page / Task | Trashed | History rows | Initial body bytes | Setup ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Modest | 1,000 | 750 / 250 | 43 | 1,043 | 384 | ~200 |
| Larger | 10,000 | 7,500 / 2,500 | 434 | 10,434 | 2,048 | ~9,000 |

Every fourth requested object is Task. Dates normally cycle through November 1–28. Every 23rd requested object is subsequently trashed. One configured history revision precedes trash in this run.

### Reads: default run

All values below are **median milliseconds**, two warmups and **nine measured samples** per side. Full spread/sample details, property SQL and read bindings are in JSON. Match counts are uncapped; displayed/view results remain capped.

| Query / candidate | Matches 1k / 10k | 1k baseline → candidate | 10k baseline → candidate |
| --- | ---: | ---: | ---: |
| Task date after Nov 14 / expression index | 373 / 3,780 | 0.682 → 0.269 | 11.310 → 3.829 |
| Task date after Nov 27 / expression index | 46 / 466 | 0.317 → 0.084 | 9.605 → 0.849 |
| `Synthetic` / FTS + exact LIKE | 957 / 9,566 | 0.032 → 1.910 | 0.041 → 45.090 |
| `title-only-needle` / FTS + exact LIKE | 1 / 1 | 0.759 → 0.049 | 32.202 → 0.373 |
| `body-only-needle` / FTS + exact LIKE | 1 / 1 | 0.557 → 0.041 | 22.703 → 0.361 |

### Build, storage and writes: default run

Build = one elapsed build (ms); storage = allocated bytes; insert/update = baseline → candidate **median ms, nine samples each**.

| Candidate / scale | Build ms | Added bytes | Insert | Update |
| --- | ---: | ---: | ---: | ---: |
| Property / 1k | 0.700 | 57,344 | 0.119 → 0.232 | 0.090 → 0.099 |
| Property / 10k | 10.583 | 544,768 | 0.133 → 0.258 | 0.115 → 0.255 |
| FTS + keys / 1k | 13.959 | 1,638,400 | 0.096 → 0.116 | 0.108 → 0.156 |
| FTS + keys / 10k | 700.686 | 69,419,008 | 0.125 → 0.195 | 0.141 → 0.274 |

Plans: property baseline searches `objects_type_browse`; candidate searches `bench_property_scheduled` with `<expr>>?`, both using temporary ordering. Search baseline uses `objects_browse`; FTS scans the MATCH virtual-table index, joins the explicit integer key and canonical UUID index, then sorts. Full before/after plans are retained.

## Semantic regressions and boundaries

Permanent tests assert actual IDs/order, not only implementation booleans:

- Owning index DDL and forced-index values before/after canonical updates, plus captured equal insert/update inputs and initial history through all 20 warmups/50 repetitions.
- Date missing, equal boundary, before/after, trash and title/UUID tie ordering against actual ViewService and indexed SQL. This does **not** establish datetime-offset, boolean-false or zero semantics.
- Search title/body positives and negatives, insert, replacement/removal, trash/restore, and explicit key/rowid correspondence. Eligible FTS phrases are quoted ASCII letters/digits/spaces/hyphens, length 3–80, excluding AND/OR/NOT words. Short/empty strings, quotes, wildcard/underscore/backslash, operators, and Unicode including `😀a` execute the real original literal-LIKE path. FTS candidates always undergo the exact escaped LIKE predicate and original ordering.
- Original 30-repetition repro, maximum report samples, controlled-clock setup measurement, post-construction/measurement failures, and later-profile initialization failures with exact owned-directory cleanup. Ordinary storage-fixture behavior remains opt-in and unchanged.

## Decisions

**Property expression indexes help static date paths.** The property index helps these static date paths, but dynamic-property DDL/migration policy is unaddressed. FTS is much slower for a common bounded query but faster for rare needles, with substantial build/storage/maintenance costs. None of these results predicts real-user speedups. No production FTS synchronization, new engine/dependencies, JSONB, deep pagination, UI changes or native beforeunload-dialog verification is included.
