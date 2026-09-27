# SQLite benchmark experiments

Plan 020 added a synthetic, disposable benchmark suite for three possible SQLite optimizations. It does **not** change the production schema, query code, JSON representation, or search semantics.

## How to reproduce

```sh
bun run sqlite:bench
```

The command creates and deletes temporary databases under the OS temp directory. It rejects caller-selected database paths, so it cannot benchmark or mutate a real workspace. Normal tests use small fixtures and assert semantic equivalence only; they do not assert timing thresholds.

Useful bounded variants:

```sh
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=384 --revisions=1 --reference-every=7 --repetitions=9 --warmups=2
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=3 --repetitions=15 --warmups=3
```

## Environment for the checked run

- Command: `bun run sqlite:bench`
- Bun: reported by the benchmark JSON as `1.4.2`
- SQLite: reported by the benchmark JSON with `sqlite_version()` and `sqlite_source_id()` for each run
- Fixture scales: 1,000 and 10,000 synthetic objects, 384-byte writing bodies, one history revision, reference cadence 7
- Measurements: 2 warmups, 9 measured repetitions; table values below are medians in milliseconds
- PRAGMAs: inherited from `openDatabase()` and reported in the JSON output (`journal_mode`, `synchronous`, `trusted_schema`)

## Results summary

| Candidate | 1k baseline | 1k candidate | 10k baseline | 10k candidate | Equivalence | Extra storage observed | Recommendation |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Static property date expression index | 0.501 ms | 1.282 ms | 10.364 ms | 10.043 ms | yes | ~61 KiB at 1k, ~536 KiB at 10k | Defer. Benefit was negligible/negative for this shape and it adds per-property DDL/write cost. |
| `object_references` membership lookup plus composite index | 0.617 ms | 0.228 ms | 9.511 ms | 1.856 ms | yes | ~76 KiB at 1k, ~724 KiB at 10k | Promising follow-up, but not adopted here. Needs production maintenance/index review and broader workloads. |
| FTS5 trigram candidate retrieval followed by exact LIKE | 0.022 ms | 1.614 ms | 0.032 ms | 30.971 ms | yes for eligible query; explicit fallback for unsafe shapes | ~1.5 MiB at 1k, ~15.0 MiB at 10k | Defer. Exact LIKE is already fast for the bounded current search; FTS candidate path adds large storage and update complexity. |

All three benchmark scenarios compare candidate ordered IDs with the current view/search semantics before interpreting timings. Query plans are included in the JSON output from `bun run sqlite:bench`.

## Semantic boundaries covered

- Property-path filtering uses the same validated UUID JSON path shape as `ViewService`; date comparison stays date/instant based rather than offset-string ordering.
- Reference membership compares current `json_each(...) COLLATE NOCASE` behavior with `object_references` scoped by source, target, and exact property ID. Writing links keep empty property IDs and are excluded from typed property membership.
- Search keeps the original escaped literal `LIKE` predicate as the authority. FTS5 trigram is only a candidate source for simple ASCII queries of at least three characters; one/two-character queries, wildcard characters, backslash, quotes, Unicode, and empty strings are reported as fallback/ineligible rather than silently redefined.

## Limitations

This is synthetic data, not a user database. It covers common/rare selectivity, live/trash filtering, short writing, sparse/dense references, controlled history, update synchronization, and adversarial semantic cases in tests, but it does not prove real-workspace speedups. File-size rows reflect SQLite/WAL behavior during the temporary run; DBSTAT rows in the JSON are better for per-index storage attribution.

JSONB, generated columns, deep pagination, automatic per-property DDL, production FTS maintenance, and schema migrations are intentionally outside this scope. Any production adoption should be reviewed separately against actual call sites, transactional maintenance, migration cost, and representative workloads.
