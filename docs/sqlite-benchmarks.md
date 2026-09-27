# SQLite benchmark experiments

Plan 020 adds a synthetic, disposable benchmark suite for three possible SQLite optimizations. It does **not** change production schema, query code, JSON representation, search semantics, or native-dialog behavior.

## How to reproduce

```sh
bun run sqlite:bench
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=2 --repetitions=5 --warmups=1
bun run sqlite:bench -- --objects=24 --large-objects=30 --body-bytes=64 --revisions=0 --reference-every=2 --repetitions=50 --warmups=20
```

The command creates only owned temporary databases under the OS temp directory and rejects caller-selected database paths. Reported setup time is elapsed construction of the owned synthetic fixtures before read/write measurements; candidate index/FTS build costs are reported separately in scenario output. Storage numbers use `dbstat` table/index bytes, not WAL/main-file deltas.

## Checked run

- Command: `bun run sqlite:bench`
- Artifact: `/tmp/taskdesk-plan020-repair/sqlite-bench-default.json`
- Bun: `1.4.2`; SQLite version/source ID and PRAGMAs are embedded in the JSON artifact.
- Measurements: 2 warmups, 9 measured repetitions; table values are median milliseconds.
- Profiles: modest/sparse requested 1,000 objects, 384-byte bodies, one history revision, 43 trashed rows, 607 reference edges, array lengths 0/2. Larger/dense requested 10,000 objects, 2,048-byte bodies, one history revision, 434 trashed rows, 32,458 reference edges, array lengths 0/2/12.

| Candidate | Modest baseline | Modest candidate | Dense baseline | Dense candidate | Extra dbstat storage | Conclusion |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Static property date expression index | 2.610 ms | 0.684 ms | 12.351 ms | 3.443 ms | 57 KiB / 545 KiB | Defer. It can help this literal date predicate, but production per-property DDL/migration/write policy is outside this plan. |
| `object_references` membership with optional composite index | 1.805 ms | 1.365 ms | 19.902 ms | 19.689 ms | 78 KiB / 3.7 MiB | Defer. Existing edge state can reproduce semantics; the optional composite index is not compelling on this synthetic common-target workload. |
| FTS5 trigram candidates plus exact LIKE | 0.049 ms | 1.673 ms | 0.034 ms | 44.501 ms | 1.6 MiB / 65.8 MiB | Defer. Exact bounded LIKE is faster here; FTS adds build/storage/update complexity. |

Write/build examples from the same run: property insert medians were 0.200/0.240 ms baseline/candidate at 1k; reference insert medians were 0.272/0.304 ms; FTS build was 33.9 ms at 1k and 937.5 ms at 10k. Full insert/update medians, p95, min/max, and sample counts are in the JSON artifact.

## Semantic boundaries covered

- Property filtering uses the same validated UUID JSON path shape as the view SQL, the full body-free object projection and ordering, `LIMIT 101` lookahead for 100 displayed rows, and actual index DDL checks for the owning fixture. Tests cover missing, boundary, before/after, and trash behavior for the selected date property only.
- Reference membership compares current `json_each(...) COLLATE NOCASE`, existing `object_references` lookup, and the optional composite index. Tests cover exact property ID scoping, writing-only links exclusion, uppercase stored values, missing/empty arrays, canonical change/remove/replace, trashed sources, retained references to a target trashed after creation, and >100-match truncation/lookahead. A deliberately deleted derived edge fails the scenario instead of reporting timings.
- Search keeps the original escaped literal `LIKE` predicate as final authority. FTS5 receives only a quoted ASCII-safe literal phrase; empty, length 1/2, wildcard, underscore, backslash, quotes/operator text, and Unicode including `😀a` execute the exact LIKE fallback. Tests cover title/body positives and negatives, insertion, replacement/removal, trash/restore synchronization, and explicit integer key/rowid mapping.

## Limitations

This remains synthetic data, not a user-database survey. The matrix is intentionally small, and no result promises real-user speedups. JSONB, generated columns, deep pagination, automatic per-property DDL, production FTS maintenance, migrations, provider calls, and UI/native-dialog changes remain deferred.
