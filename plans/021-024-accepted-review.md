# Architecture hot paths — accepted isolated implementation

## Verdict

**APPROVE** plans 021–024 at `c737ec82e357c09a019e21174c257cf0d432e9f2` on branch `alexradunet/architecture-hot-paths`, worktree `/home/alex/orca/workspaces/GenUIExperiment/architecture-hot-paths`.

Baseline `eb324c4e05ed73243dabc6242422baea4e855c67`; five logical commits: `2965613`, `21f2bf7`, `9edd254`, `d3557c3`, `c737ec8`. Full scope is ten authorized files, 340 insertions / 47 deletions. Worktree is clean. This is implementation/review acceptance, **not** merge, push, live deployment or permission for a schema migration.

## Delivered

1. HTTP page-only saved-view listing; JSON/conversation/redirect responses avoid unrelated specs. Lookup uses request-local type names.
2. Property and Markdown link validation uses target summaries without target writing/properties.
3. Multiple-reference contains uses target-first property-specific edges, through the same predicate for view reads and scoped commands. No additional index/schema change.
4. Canonical writes reuse local parsed links and preserve exact-body search text/writing edges. Ordinary snapshots, revisions, validation and transaction boundaries remain intact; property patch reuses its source read through a private common update method.

## Independent verification

Lead read the complete baseline source/docs/test diff and complete follow-up diff, not just worker reports. Ran on accepted source:

- `bun run check`: PASS.
- `bun test`: **134 pass / 0 fail**, 15 files.
- `git diff --check eb324c4..HEAD`: PASS.
- `bun run sqlite:bench`: PASS with default profiles, semantic count/ordered-ID checks and owned temp cleanup.
- Original checkout remains at `eb324c4`; no changes to src/test/scripts/docs/package/lockfile. Only requested advisory plan records were added/updated there; owner plans 012/013 remain untouched.

Additional direct lead probes used in-memory DBs, a temporary local HTTP server with an injected generator that would throw if called, and no live data:

- 128 references to 64 KiB targets: target body bytes materialized during validation **0**, versus research baseline **8,388,608**.
- Property update of 240,000-byte Markdown: **one** parse instead of four. Exact previous snapshot and writing backlink preserved.
- 50-result lookup with 1,000 saved views: **zero** saved-view listings and **zero** per-result getType calls; correct names and truncation retained.

Independent final benchmark medians (ms), default 1k sparse / 10k dense profiles, 2 warmups / 9 samples:

| Profile / target | Full matches | JSON baseline | Target-first |
| --- | ---: | ---: | ---: |
| Sparse common | 101 | 0.549 | 0.291 |
| Sparse rare | 1 | 0.324 | 0.030 |
| Dense common | 7,097 | 42.153 | 28.424 |
| Dense rare | 1 | 15.578 | 0.094 |

All candidate full counts and ordered bounded IDs match; existing `object_references_target` selected in these cases, no incremental DDL/storage. These are synthetic warm/in-process measurements, not universal speedups or durable-write latency. Worker final full benchmark artifact: `/tmp/taskdesk-hot-paths-review1-sqlite-bench.json`; lead reran the CLI independently and inspected its structured summary in session output.

## Review repair

One verification-focused round closed the gaps in `021-024-review-1.md`. The final tests now reject a genuinely unrelated input while other filters remain eligible, reject removed membership and writing-/other-property-only provenance, cover interleaved literal/input/scalar predicates over multiple sources, assert unchanged derivative operation counts, validate typed self-reference type changes, and prove complete object/history/edge rollback on an injected edge-write failure. No production code changed during this repair. Existing revision/publication, Journal, built-in, restoration, security and upgrade tests remain passing.

## Boundaries and unverified surfaces

No `.data` inspection, real view-generation calls, UI/asset/dependency changes, schema/index changes, integration or push. No browser verification was performed because markup and interaction contracts were unchanged; HTTP tests are not represented as browser/layout proof. Static asset caching, FTS, property indexes, JSONB, history normalization and WITHOUT ROWID remain deferred.

## Orca lifecycle

Run `run_6421011b6463`; initial implementation and review Tasks completed. Delivery `delivery_a0f6ab8a77dd` acknowledged after transferring the same terminal to review Task `task_1adcf0f2bd77` / Dispatch `ctx_25a641202403`; final Delivery `delivery_de7a55762ca8` fully read and acknowledged after native worker-release was attempted. No mail remains.

Native cleanup reported `release_unknown` / `tab_not_found` despite archived output. Exact worker-show confirms the terminal exited, disconnected and unwritable (`exitCause: operator_close`). The prescribed same-request retry `f47e4f3e-7082-4d5f-9eb5-0761befea7c8` replayed the same unresolved metadata result. No broad terminal close, force removal or lifecycle reset was attempted. This is an Orca cleanup-record limitation, not an active coding worker or source verification failure. Worktree and commits remain intact for owner-directed integration.
