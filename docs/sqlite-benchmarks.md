# SQLite benchmark experiments

These disposable synthetic experiments do not authorize production adoption or change application queries/schema. JSONB and deep pagination remain deferred.

## Reproduce

Bun 1.4.2+, checked-in dependencies, no provider credentials/network:

```sh
bun run sqlite:bench
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=2 --repetitions=5 --warmups=1
bun run sqlite:bench -- --objects=24 --large-objects=30 --body-bytes=64 --revisions=0 --reference-every=2 --repetitions=50 --warmups=20
```

Only owned temporary databases are opened. `DATABASE_PATH` is ignored and caller-selected database paths are rejected. Insufficient objects/reference cadence to produce a live reference match fails explicitly rather than inventing a result. Normal tests have no timing thresholds.

## Measurement contract

One fixture per profile is reused by all experiments; there are no internal baseline/candidate fixture pairs. `setupMs` measures directory/database/schema creation, benchmark property/type creation, canonical objects/history/references and trash. Profile setup is measured independently. Candidate builds and write-probe setup are not part of that number.

All read probes precede write probes. Property queries use the same body-free ViewService projection, ascending date, title/UUID ordering, 101-row lookahead and 100-row display. Reference probes keep exact property provenance and NOCASE target membership, compare actual validated views, and verify both full match counts and bounded ordered IDs. A mismatch throws; timing results are not returned as equivalent.

Read results contain median, p95, min/max milliseconds and measured sample count. Property reads have fixed analyzed-baseline then indexed/analyzed-candidate phases, explicitly labeled. Reference JSON/edge and LIKE/FTS reads alternate execution order per sample. Initial and post-ANALYZE plans are retained; later scenarios reuse the fixture's existing statistics. Warmups exclude the untimed semantic validation reads, so these are warm/in-process measurements, not cold-cache or end-to-end request benchmarks.

Writes use the **same database, submitted title/body/properties, initial revision/history, and number of operations** on both sides. Each sample restores its pre-write state via a savepoint **outside** the timer. The body has exactly the profile's base byte budget; updates replace it with another fixed synthetic body, not accumulated suffixes. Candidate DDL commits before its phase to avoid measuring schema-reprepare artifacts from rolling back beneath uncommitted DDL. Timings include canonical insert/update plus candidate maintenance, but **exclude probe setup, inspection, outer commit/rollback and fsync**. They are not durable write latency. Baseline phase precedes candidate phase; cache/order bias remains possible.

Each write experiment adds two dedicated canonical setup objects after all reads, then rolls back every measured mutation. Thus six write-setup records are separate from requested object counts. Reference write targets remain live and are independent of read targets. Search adds two temporary semantic records during reads and rolls them back afterward. These counts are explicit in the report.

Build times measure index DDL or FTS key-table/FTS population inside the read experiment's savepoint, excluding outer commit/fsync and ANALYZE. Storage uses `dbstat` allocated bytes, **not** main-file/WAL deltas. FTS storage includes all shadow tables, the explicit integer-key table **and its unique object-ID index**. Existing-edge reads add no schema/build/storage or maintenance: their write numbers are the same measured canonical baseline samples, not an invented second measurement.

## Fixture matrix and checked evidence

Fresh evidence: `/tmp/taskdesk-plan020-evidence-dNPOs4/` (`default.json`, `large-writing.json`, `max-samples.json`, command stderr logs, focused/full test logs). Earlier evidence is not used for these conclusions. The default run used Bun 1.4.2 / SQLite 3.53.2, WAL, synchronous=2, trusted_schema=0; full engine/source identity is in each JSON report.

Default profiles:

| Profile | Requested records | Page / Task / rare type | Trashed | History rows | Initial body bytes | Setup ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Modest/sparse | 1,000 | 741 / 250 / 9 | 43 | 1,043 | 384 | 224.064 |
| Larger/dense | 10,000 | 7,422 / 2,500 / 78 | 434 | 10,434 | 2,048 | 9,671.520 |

Every fourth requested object is Task. Non-Task indices congruent to 1 modulo 97 use a separately created rare type sharing Page properties; referenced Pages are never retyped. Dates normally cycle through November 1–28; rare-type records and indices congruent to 3 modulo 53 use November 28. Every 23rd requested object is subsequently trashed. One configured history revision precedes trash in this run.

Sparse arrays have length two at the requested reference cadence: among Pages, 636 missing and 105 length-two arrays (101 live, four trashed). Two rare-type records also have length-two arrays. Dense arrays occur on every eligible non-Task source and grow with available targets to length 12: among Pages, two missing, one of each length 2–11, and 7,410 length-12 arrays (7,087 live, 323 trashed). Rare-type records have one missing and 77 length-12 arrays. Tasks have none. Reports group the actual array distribution by type and trash state. Each reference experiment queries both the most common and least common live Page target, not just metadata about them.

### Reads: default run

All values below are **median milliseconds**, two warmups and **nine measured samples** per side. Full spread/sample details, property/reference SQL and read bindings are in JSON. Match counts are uncapped; displayed/view results remain capped.

| Query / candidate | Matches 1k / 10k | 1k baseline → candidate | 10k baseline → candidate |
| --- | ---: | ---: | ---: |
| Page date after Nov 14 / expression index | 373 / 3,780 | 0.682 → 0.269 | 11.310 → 3.829 |
| Page date after Nov 27 / expression index | 46 / 466 | 0.317 → 0.084 | 9.605 → 0.849 |
| Rare type date after Nov 20 / expression index | 9 / 75 | 0.063 → 0.029 | 0.297 → 0.194 |
| Common target / existing edge indexes | 101 / 7,097 | 0.513 → 0.390 | 36.899 → 47.212 |
| Rare target / existing edge indexes | 1 / 1 | 0.317 → 0.183 | 14.513 → 15.767 |
| Common target / optional composite | 101 / 7,097 | 0.476 → 0.476 | 37.923 → 43.159 |
| Rare target / optional composite | 1 / 1 | 0.277 → 0.108 | 14.447 → 3.085 |
| `Synthetic` / FTS + exact LIKE | 957 / 9,566 | 0.032 → 1.910 | 0.041 → 45.090 |
| `title-only-needle` / FTS + exact LIKE | 1 / 1 | 0.759 → 0.049 | 32.202 → 0.373 |
| `body-only-needle` / FTS + exact LIKE | 1 / 1 | 0.557 → 0.041 | 22.703 → 0.361 |

The composite phase remeasures its own JSON baseline; do not compare its timing against the earlier existing-index phase as if execution conditions were identical.

### Build, storage and writes: default run

Build = one elapsed build (ms); storage = allocated bytes; insert/update = baseline → candidate **median ms, nine samples each**. Existing-edge reads use the reference baseline write column, zero additional build/storage.

| Candidate / scale | Build ms | Added bytes | Insert | Update |
| --- | ---: | ---: | ---: | ---: |
| Property / 1k | 0.700 | 57,344 | 0.119 → 0.232 | 0.090 → 0.099 |
| Property / 10k | 10.583 | 544,768 | 0.133 → 0.258 | 0.115 → 0.255 |
| Reference composite / 1k | 0.274 | 45,056 | 0.083 → 0.169 | 0.089 → 0.096 |
| Reference composite / 10k | 83.433 | 10,981,376 | 0.185 → 0.293 | 0.149 → 0.341 |
| FTS + keys / 1k | 13.959 | 1,638,400 | 0.096 → 0.116 | 0.108 → 0.156 |
| FTS + keys / 10k | 700.686 | 69,419,008 | 0.125 → 0.195 | 0.141 → 0.274 |

Plans: property baseline searches `objects_type_browse`; candidate searches `bench_property_scheduled` with `<expr>>?`, both using temporary ordering. Existing edge lookup uses the existing covering primary-key index on `(source_id,target_id,property_id)`. For the dense common target, the optional composite was **not** selected before ANALYZE but was afterward; its result is an **index-plus-statistics** result, not an index-only claim. Search baseline uses `objects_browse`; FTS scans the MATCH virtual-table index, joins the explicit integer key and canonical UUID index, then sorts. Full before/after plans are retained.

## Semantic regressions and boundaries

Permanent tests assert actual IDs/order, not only implementation booleans:

- Owning index DDL and forced-index values before/after canonical updates, plus captured equal insert/update inputs and initial history through all 20 warmups/50 repetitions.
- Date missing, equal boundary, before/after, trash and title/UUID tie ordering against actual ViewService and indexed SQL. This does **not** establish datetime-offset, boolean-false or zero semantics.
- Live uppercase references, exact property versus another-property-only/writing-only edges, missing/empty arrays, canonical change/remove/replace, trashed sources, and a target actually trashed **after** valid references exist. Tests assert exact 101 lookahead IDs, 100 display IDs and truncation. Deleting one derived edge causes a real scenario failure.
- Search title/body positives and negatives, insert, replacement/removal, trash/restore, and explicit key/rowid correspondence. Eligible FTS phrases are quoted ASCII letters/digits/spaces/hyphens, length 3–80, excluding AND/OR/NOT words. Short/empty strings, quotes, wildcard/underscore/backslash, operators, and Unicode including `😀a` execute the real original literal-LIKE path. FTS candidates always undergo the exact escaped LIKE predicate and original ordering.
- Original 30-repetition repro, maximum report samples, controlled-clock setup measurement, post-construction/measurement failures, and later-profile initialization failures with exact owned-directory cleanup. Ordinary storage-fixture behavior remains opt-in and unchanged.

## Decisions

**Defer all production adoption.** The property index helps these static date paths, but dynamic-property DDL/migration policy is unaddressed. Existing reference edges are semantically usable but not consistently faster; the optional composite helps this rare dense lookup at substantial storage/write cost. FTS is much slower for a common bounded query but faster for these rare needles, with substantial build/storage/maintenance costs. None of these results predicts real-user speedups. No production FTS synchronization, new engine/dependencies, JSONB, deep pagination, UI changes or native beforeunload-dialog verification is included.
