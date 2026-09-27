# SQLite runtime evaluation

Date: 2026-09-27

Taskdesk uses Bun's embedded `bun:sqlite` engine. The system `sqlite3` executable is not the live application database engine, so runtime changes must be evaluated with the exact `bun` executable that will run Taskdesk.

## Diagnostic

Run:

```sh
bun run sqlite:runtime
```

The command opens only an in-memory SQLite database and prints JSON with:

- `bunVersion`
- `sqlite.version`
- `sqlite.sourceId`
- sorted `sqlite.compileOptions`
- direct SQL probe results for JSON, JSONB, temporary FTS5, `dbstat`, `ALTER TABLE ... ADD COLUMN ... CHECK`, direct `ALTER TABLE ... ADD CHECK`, and direct `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`

The diagnostic does not accept a database path. Passing any argument exits with usage text before opening a user file.

## Evaluation matrix

| Runtime | Executable / source | Artifact verification | Observed SQLite | Gates |
| --- | --- | --- | --- | --- |
| Retained local runtime | `bun` from this checkout environment, `bun --version` = `1.4.2` | Existing installed runtime; no global change made | `SELECT sqlite_version()` = `3.53.2`; `SELECT sqlite_source_id()` = `2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24` | `bun run check`, `bun test`, and `bun run sqlite:runtime` pass |
| Official latest stable artifact checked for comparison | `https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip`, invoked as `/tmp/tmp.QwSp5I3Sbq/bun-linux-x64/bun` | GitHub release API published `sha256:36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913`; local `sha256sum -c` passed | `SELECT sqlite_version()` = `3.53.2`; `SELECT sqlite_source_id()` = `2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24` | Candidate `/tmp/tmp.QwSp5I3Sbq/bun-linux-x64/bun run sqlite:runtime`, `/tmp/tmp.QwSp5I3Sbq/bun-linux-x64/bun run check`, and `/tmp/tmp.QwSp5I3Sbq/bun-linux-x64/bun test` pass; full suite was 94 tests |

The official artifact did not differ from the installed runtime, so no additional WAL compatibility smoke was required.

## Upstream evidence

- SQLite release history: <https://www.sqlite.org/changes.html>
- SQLite 3.53.4 release log: <https://www.sqlite.org/releaselog/3_53_4.html>
- Bun 1.4 release notes: <https://bun.sh/blog/bun-v1.4>
- Bun 1.4.2 release notes: <https://bun.sh/blog/release-notes/bun-v1.4.2>
- Bun 1.4.2 GitHub release and artifact metadata: <https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2>

SQLite documents 3.53.4 as the latest stable 3.53 patch on 2026-07-24, with source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`. Bun's currently verified latest stable release for this host was 1.4.2, and both the installed executable and official Linux x64 artifact reported SQLite 3.53.2 by direct SQL query. Bun 1.4.2 release notes do not claim an embedded SQLite patch update beyond what the diagnostic observed.

## Decision

Keep `engines.bun` at `>=1.4.2`. A newer stable SQLite patch exists upstream, but no newer supported stable Bun runtime containing that patch was verified for this checkout. Do not raise the minimum Bun version or claim an embedded SQLite upgrade until a specific Bun release is downloaded from an official source, checksum-verified when metadata is available, and passes the diagnostic plus the project gates.

The current Bun build already includes SQLite 3.53.0-era WAL-reset fixes because it reports SQLite 3.53.2. This evaluation does not require or promise every compiled SQLite feature for production use; it records observable runtime capabilities for the executable under test.
