# SQLite benchmark experiments

Plan 020 adds a synthetic, disposable benchmark suite for three possible SQLite optimizations. It does **not** change production schema, query code, JSON representation, search semantics, or native-dialog behavior.

## How to reproduce

```sh
bun run sqlite:bench
```

The command creates and deletes temporary databases under the OS temp directory. It rejects caller-selected database paths, so it cannot benchmark or mutate a real workspace. Normal tests use small fixtures and assert semantic equivalence only; they do not assert timing thresholds.

Useful bounded variants:

```sh
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=384 --revisions=1 --reference-every=7 --repetitions=9 --warmups=2
bun run sqlite:bench -- --objects=1000 --large-objects=10000 --body-bytes=2048 --revisions=2 --reference-every=2 --repetitions=5 --warmups=1
```

## Checked run

- Command: `bun run sqlite:bench`
- Artifact: `/tmp/taskdesk-plan020-final/sqlite-bench-default.json`; summary: `/tmp/taskdesk-plan020-final/summary.txt`.
- Bun: `1.4.2`; SQLite version/source ID and PRAGMAs are embedded in the JSON artifact.
- Fixture matrix: modest/sparse profile requested 1,000 objects, 384-byte bodies, one history revision, 43 trashed rows, 607 reference edges, 250 two-reference arrays and 500 missing arrays. Dense/larger profile requested 10,000 objects, 2,048-byte bodies, one history revision, 434 trashed rows, 7,498 reference edges, 2,499 two-reference arrays and 5,001 missing arrays.
- Measurements: 2 warmups, 9 measured repetitions; table values are medians in milliseconds.

| Candidate | 1k baseline | 1k candidate | 10k baseline | 10k candidate | Equivalence | Extra dbstat storage | Recommendation |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Static property date expression index | 0.810 ms | 0.221 ms | 9.599 ms | 2.436 ms | yes; full ViewService projection/order/cap matched before write probes | 57 KiB at 1k, 545 KiB at 10k | Defer production adoption. The literal-path experiment shows planner use and possible read benefit, but per-property DDL/migration/write policy is outside this plan. |
| `object_references` membership lookup plus composite index | 0.825 ms | 0.731 ms | 14.841 ms | 15.940 ms | yes; exact property ID, source scope, NOCASE target, writing-link exclusion | 78 KiB at 1k, 913 KiB at 10k | Defer. Existing edge storage can reproduce semantics, but this common-target fixture did not show a read win from the optional composite index. Existing-index measurements are recorded separately in JSON metadata and require zero extra schema. |
| FTS5 trigram candidate retrieval followed by exact LIKE | 0.033 ms | 0.832 ms | 0.027 ms | 39.746 ms | yes for eligible query; unsafe/short strings execute baseline fallback | 1.6 MiB at 1k, 69.0 MiB at 10k | Defer. Exact LIKE is faster for this bounded search shape; FTS adds build/storage/update complexity. |

Write/build examples from the same run: property insert medians were 0.074/0.066 ms baseline/candidate at 1k and 0.073/0.068 ms at 10k; reference insert medians were 0.086/0.096 ms at 1k and 0.097/0.125 ms at 10k; FTS build was 14.0 ms at 1k and 703.4 ms at 10k, with baseline/candidate insert/update medians and sample counts in the JSON.

## Additional bounded matrix

The larger-writing/dense-reference variant is recorded at `/tmp/taskdesk-plan020-final/sqlite-bench-dense-largewriting.json`. It uses 2,048-byte bodies, two history revisions, dense reference cadence, 5 measured repetitions, and the same semantic checks. It preserved equivalence. Property reads still improved; reference composite reads remained close/slower on common-target predicates; FTS remained slower and much larger.

## Semantic boundaries covered

- Property filtering uses the same validated UUID literal JSON path shape as `ViewService`, full object projection (`id`, `type`, `title`, `properties`, revision, timestamps, trash plus sort columns), analyzed baseline and analyzed candidate plans, and explicit 101-row SQL lookahead versus 100 displayed rows. Date boundary and missing-value behavior are covered for the selected date property only; no claim is made for boolean, zero, instant, or time-range semantics.
- Reference membership compares current `json_each(...) COLLATE NOCASE` with an `object_references` lookup before and after the optional composite index. Tests cover multiple properties to the same target, writing-only links, exact property ID scoping, uppercase stored values, missing/empty arrays, trashed sources, retained trashed targets, remove/replace maintenance through canonical commands, and >100-match truncation/lookahead behavior.
- Search keeps the original escaped literal `LIKE` predicate as final authority. FTS5 receives only a quoted ASCII-safe literal phrase (letters, digits, spaces and hyphens, length 3–80, excluding `AND`/`OR`/`NOT`); empty, length 1/2, wildcard, underscore, backslash, quotes/operator text, and Unicode including `😀a` execute the exact LIKE fallback. Tests cover independent title/body matches plus insertion, replacement/removal of old matches, trash/restore synchronization, and explicit integer `bench_search_key` rowid mapping that preserves public UUID identity.

## Limitations

This is synthetic data, not a user database. Sparse/dense references, short/larger writing, controlled history, live/trash effects, common/rare predicates, and adversarial search strings are bounded fixtures rather than a representative workload survey. Read timings run in-process and cache/order effects remain possible; write timings are canonical object writes measured separately from a production migration and should not be treated as end-to-end durable latency for a deployed index rollout.

JSONB, generated columns, deep pagination, automatic per-property DDL, production FTS maintenance, schema migrations, and UI/native-dialog changes remain outside this scope. Any production adoption should be reviewed separately against actual call sites, transactional maintenance, migration cost, and representative workloads.
