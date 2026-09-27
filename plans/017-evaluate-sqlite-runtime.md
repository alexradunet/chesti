# Plan 017: Make the embedded SQLite runtime inspectable and evaluate its patch level

> Executor: work only in the assigned isolated Orca checkout. Commit reviewable local files, no merge/push/global runtime change. Coordinator owns the plan index.
> Drift: `git diff --stat 133f8a6..HEAD -- package.json bun.lock README.md scripts/sqlite-runtime.ts test/sqlite-runtime.test.ts docs/sqlite-runtime.md`.

## Status
- P2; effort S–M; risk MED for upgrades, LOW for diagnostics; category dependencies/DX.
- Planned at `133f8a6`, 2026-09-27. No dependencies; research priority 3.

## Outcome/current facts
`package.json` requires Bun >=1.4.2; no checked-in runtime pin exists. The installed Bun is 1.4.2, embedded SQLite 3.53.2. Research verified latest stable SQLite 3.53.4 (2026-07-24), while 3.54 was draft. The current build already has the WAL-reset fix: do not claim a present corruption bug. Changing `/usr/bin/sqlite3` does not update Bun's embedded engine on this host. Reverify current official release facts; network evidence may be unavailable or stale.

Add a small safe command that reports this executable's SQLite version, source ID, relevant compile options and directly probed SQL features, then evaluate an available supported stable Bun containing the newer patch. Evaluation is a legitimate result: never raise the declared minimum to an untested or unavailable runtime merely to make this plan appear complete.

## Scope
Only new `scripts/sqlite-runtime.ts`, `test/sqlite-runtime.test.ts`, `docs/sqlite-runtime.md`, `package.json`, affected runtime/setup paragraphs in `README.md`. `bun.lock` may change only if a verified Bun engine metadata change requires it, not dependency version churn; otherwise preserve it byte-for-byte.
Out: application storage/schema/query changes; global Bun/mise/system SQLite install or upgrade; CI/framework creation; provider calls; credentials; `.data/`; FTS/JSONB production adoption.

## Commands and resources
Use `bun install --frozen-lockfile` for absent deps; `bun run check`, `bun test`, `git diff --check`. Baseline 91 tests and check pass. Read README and AGENTS. Consult https://www.sqlite.org/changes.html and Bun's official release notes/distribution; use source-linked facts, not search summaries alone. Prefer the configured web search provider, and fetch primary pages.

## Steps / gates
1. **Implement a provider-free diagnostic.** Add `bun run sqlite:runtime` pointing to the script. It opens only `:memory:`, prints parseable JSON containing Bun version, SQLite version/source ID and a deliberately small capability list: JSON/JSONB functions, FTS5 temp/in-memory creation, dbstat querying and direct ADD CHECK/SET NOT NULL syntax as appropriate. Close all handles. SESSION compilation does not claim Bun exposes its C API. Report unavailable capabilities explicitly; unexpected probe errors must not be relabeled as success. Keep SQL statements static; accept no database path.
   - Verify `bun run sqlite:runtime` reports actual versions and feature outcomes; tests verify meaningful output against actual SQL, not hardcoded engine patch strings. Invalid CLI arguments must not cause user-file opening. `bun test test/sqlite-runtime.test.ts` passes.
2. **Evaluate a current supported Bun.** Recheck official stable Bun releases and embedded SQLite information. If a suitable release is available, download only its official artifact to an explicit fresh temporary directory (no curl-pipe-shell, global upgrade, default-path startup or executable replacement). Record URL/version and published checksum/signature verification if provided; invoke its executable by absolute path. Run the diagnostic, typecheck and full suite in this isolated checkout. Run an additional disposable-file WAL open/write/snapshot/read-only rejection smoke if the candidate differs. Never run real view generation.
   - Verify candidate SQLite version using `SELECT sqlite_version()` (not its release prose). Every claimed candidate result names the exact executable/command and observed exit/result. If unavailable, download blocked, or newer runtime fails, keep the known working requirement and document that no update was accepted plus the exact blocker. Do not invent a package version or silently use nightly.
3. **Record an evidence-based decision.** Write `docs/sqlite-runtime.md` with date, installed/candidate matrix, verified official links, test counts and caveats. Update README with the diagnostic and recommendation. If and only if a tested stable newer Bun is required/selected, update engines and setup text consistently, without dependency upgrades. No machine-wide change is authorized.
   - Verify `bun run check && bun test && bun run sqlite:runtime && git diff --check` exit 0 on the retained supported runtime; run the same gates on any selected candidate. Inspect lockfile diff and scope; commit locally.

## Acceptance / stop / maintenance
The diagnostic is reproducible without filesystem/user data/provider access; runtime selection is supported by direct evidence; a blocked upgrade is clearly distinguished from completed evaluation. Stop on untrusted distribution sources, need to alter global configuration, unsupported candidate API, two failed targeted repairs, or unlisted source changes. Runtime facts age: future upgrades rerun tests and explicit engine probes; do not introduce an engine-version performance guarantee or require every compiled SQLite feature in production.
