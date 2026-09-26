# Plan 009: Render case-insensitive reference identities consistently

## Status
- Priority P2; effort S; risk LOW; category bug; confidence HIGH.
- Planned at `058e883`, 2026-09-26. Dependencies: none.
- Separate Orca executor; user authorized review and conditional local master integration, not push. Reviewer maintains index.

## Why this matters
Canonical object/reference lookup accepts UUID case variations, but property-reference links emit the stored uppercase UUID into a lowercase-only HTTP route. A valid stored reference therefore yields a 404 when clicked. Case-sensitive picker matching can also produce duplicate candidates or show a UUID placeholder instead of the object's title. Normalize display identity without migrating or mutating stored content, revision history, or creation fingerprints.

## Current state / conventions
- `src/objects/runtime.ts:374–381` validates reference UUIDs case-insensitively, deduplicates lowercase IDs and loads the target through NOCASE SQLite object keys. It preserves submitted reference spelling in properties.
- `src/objects/render.tsx:12`:
```ts
const objectUrl = (id: string) => `/objects/${encodeURIComponent(id)}`;
```
- The same file's reference control at lines 96–103 uses exact `record.id === item` / `selected.includes(record.id)` comparisons. `Value` at line 112 uses exact ID matching for titles and passes the original ID to `objectUrl`.
- `src/objects/http.ts:175` accepts only lowercase UUID characters in object route matching; selected-object enrichment at lines 182–184 also compares IDs exactly.
- `src/objects/writing-links.ts` already normalizes local Markdown links with `target[1]!.toLowerCase()`. Do not broaden the safe-link policy or make arbitrary URLs case-insensitive.
- `test/objects-http.test.ts` uses `setup(t, injectedGenerator)`, in-memory SQLite, real HTTP and HTMLRewriter. `test/objects-runtime.test.ts` protects exact idempotency receipts and revision state. Follow these tests, not markup snapshots.
- Match simple functions and direct comparisons; no ID wrapper classes or compatibility layer. Objects own data and presentation fixes must not rewrite it.

## Scope
Only `src/objects/render.tsx`, `src/objects/http.ts`, `test/objects-http.test.ts`, and `docs/object-contract.md` for precise reference-identity wording. Do not modify persistence, runtime, migration, fingerprints, schemas, dependencies, or writing/link security rules.

## Commands / workflow
- Drift: `git diff --stat 058e883..HEAD -- src/objects/render.tsx src/objects/http.ts test/objects-http.test.ts docs/object-contract.md`; compare excerpts if changed, stop on unapproved drift.
- Bun >=1.4.2; install only if needed in isolated worktree: `bun install --frozen-lockfile` -> exit 0.
- Focused: `bun test test/objects-http.test.ts test/objects-runtime.test.ts test/objects-markdown.test.ts` -> all pass after fix.
- Final: `bun run check && bun test && git diff --check` -> exit 0.
- Commit in assigned isolated worktree, e.g. `Normalize reference identity in object presentation`. No merge, push, master edits, plans edits or subagents.

## Steps
1. Store mixed/uppercase single and multiple references through the canonical runtime; create a trusted view exposing them. Read actual table/board reference hrefs via HTTP and follow them. Test the object editor's selected options and visible labels. These regressions must fail on baseline (404 or duplicate/mislabeled candidate). Run focused tests and record failure.
2. Canonicalize UUIDs only when building object links and comparing object/reference identities for display. Ensure selected lowercase candidate represents an uppercase stored reference exactly once; retain unknown/invalid raw draft selections instead of dropping them. Where selected enrichment is needed, deduplicate by case-insensitive identity. Avoid a persistence rewrite or routing-wide behavior expansion. Run focused tests -> all pass.
3. Cover live, trashed-retained and selected-outside-200 references; ensure a malicious/invalid raw draft is escaped, not repaired into a valid saved value. Assert rendering GETs leave original property spelling, object revision, creation receipt and historical snapshots unchanged. An unchanged supported form must not accidentally clear a reference. Run focused tests -> all pass.
4. Browser-check following an exposed uppercase property link, selected reference title and no duplicate option in an isolated fixture; keyboard/native-select behavior should remain unchanged. Add the contract sentence describing case-insensitive reference display identity. Run final checks, inspect scoped diff and commit.

## Done criteria
- Returned property links use working canonical local object URLs; HTTP follows return 200.
- Mixed-case selected references occur once with the resolved title when available, including retained values outside bounds/Trash.
- GET/rendering changes neither canonical values nor receipts/revisions/history.
- Strict TS, full tests, diff hygiene pass; browser verification or exact tooling block reported.
- Only scoped files changed.

## STOP / maintenance
Stop if implementation requires data migration, rewriting submitted fingerprints, changing reference validation, or broadening URL trust. Stop on unexpected drift or two failed verification repairs. Future searchable reference selection must use the same case-insensitive identity comparisons; stored spelling remains canonical user data, not a cleanup target.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: actual commands/results per step
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit/branch/worktree, browser evidence, deviations/limits
