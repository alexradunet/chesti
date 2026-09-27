# SQLite benchmark experiments

Plan 020 adds a synthetic, disposable benchmark suite for three possible SQLite optimizations. It does **not** change the production schema, query code, JSON representation, search semantics, or native-dialog behavior.

## How to reproduce

```sh
bun run sqlite:bench
```

The command creates and deletes temporary databases under the OS temp directory. It rejects caller-selected database paths, so it cannot benchmark or mutate a real workspace. Normal tests use small fixtures and assert semantic equivalence only; they do not assert timing thresholds.

Useful bounded variants:

```sh
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=384 --revisions=1 --reference-every=7 --repetitions=9 --warmups=2
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=3 --repetitions=5 --warmups=1
```

## Checked run

- Command: `bun run sqlite:bench`
- Bun: `1.4.2`; SQLite version/source ID and PRAGMAs are embedded in the JSON artifact.
- Fixture scales: 1,000 and 10,000 synthetic objects, 384-byte writing bodies, one history revision, reference cadence 7.
- Measurements: 2 warmups, 9 measured repetitions; table values are medians in milliseconds.
- Artifact: `/tmp/taskdesk-plan020/sqlite-bench-default.json`; summary: `/tmp/taskdesk-plan020/sqlite-bench-default-summary.txt`.

| Candidate | 1k baseline | 1k candidate | 10k baseline | 10k candidate | Equivalence | Extra dbstat storage | Recommendation |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Static property date expression index | 0.631 ms | 0.136 ms | 11.361 ms | 4.242 ms | yes; 101-row lookahead matched the 100-row view cap | 61 KiB at 1k, 545 KiB at 10k | Defer production adoption. The faithful literal-path experiment shows planner use and possible read benefit, but per-property DDL/migration/write policy is outside this plan. |
| `object_references` membership lookup plus composite index | 0.388 ms | 0.178 ms | 9.977 ms | 2.091 ms | yes; exact property ID, source scope, NOCASE target, writing-link exclusion | 78 KiB at 1k, 741 KiB at 10k | Promising follow-up, not adopted here. Existing-index edge lookup is also recorded in JSON before the optional composite index. |
| FTS5 trigram candidate retrieval followed by exact LIKE | 0.029 ms | 1.371 ms | 0.028 ms | 32.152 ms | yes for eligible query; unsafe/short strings execute baseline fallback | 1.6 MiB at 1k, 16.2 MiB at 10k | Defer. Exact LIKE is faster for this bounded search shape; FTS adds build/storage/update complexity. |

Write/build examples from the same run: property insert-five before/after index was about 0.798/0.797 ms at 1k and 0.797/0.792 ms at 10k; reference insert-five with candidate index was 0.932 ms at 1k and 1.264 ms at 10k; FTS build was 15.3 ms at 1k and 206.7 ms at 10k, with measured insert/update maintenance in the JSON.

## Additional bounded matrix

The larger-writing/dense-reference variant is recorded at `/tmp/taskdesk-plan020/sqlite-bench-dense-largewriting.json` with summary `/tmp/taskdesk-plan020/sqlite-bench-dense-largewriting-summary.txt`. It uses 2,048-byte bodies, two history revisions, and reference cadence 3. It preserved equivalence and showed the same direction: property/reference candidates used their indexes; FTS remained slower and much larger.

## Semantic boundaries covered

- Property filtering uses the same validated UUID literal JSON path shape as `ViewService`, complete ordering projection, analyzed baseline and analyzed candidate plans, and explicit 101-row SQL lookahead versus 100 displayed rows.
- Reference membership compares current `json_each(...) COLLATE NOCASE` with an `object_references` lookup before and after the optional composite index. Tests cover writing-only links, exact property ID scoping, case-insensitive targets, missing/empty arrays through the fixture shape, and mutation maintenance.
- Search keeps the original escaped literal `LIKE` predicate as final authority. FTS5 receives only a quoted literal phrase; length 0/1/2 strings, operators such as `OR`, `%`, `_`, backslash, quotes, and Unicode use the executed baseline fallback. Tests also cover independent title/body matches plus insert, update, and trash synchronization. The fixture uses an explicit integer `bench_search_key` mapping and preserves public UUIDs.

## Limitations

This is synthetic data, not a user database. Sparse/dense references, short/larger writing, controlled history, live/trash effects, and adversarial search strings are bounded fixtures rather than a representative workload survey. Date-only property filtering was tested as date-string comparison matching the current date property behavior; it is not evidence for datetime offset/instant semantics. File-size rows can stay unchanged under WAL/page allocation; use dbstat rows in the JSON for candidate storage attribution.

JSONB, generated columns, deep pagination, automatic per-property DDL, production FTS maintenance, schema migrations, and UI/native-dialog changes remain outside this scope. Any production adoption should be reviewed separately against actual call sites, transactional maintenance, migration cost, and representative workloads.
