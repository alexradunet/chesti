# Plan 004: Preserve emphasis during version-1 Markdown upgrades

## Status
- Priority P1; effort M; fix risk MED; category bug; confidence HIGH.
- Planned at `438d497`, 2026-09-26. Dependencies: none.
- Executor implements in an isolated Orca worktree. Reviewer maintains the index.

## Outcome and boundaries
Version-1 supported writing must not gain visible Markdown delimiters or lose emphasis during upgrade. Preserve current objects, historical snapshots, creation receipts and transactional rollback. This is the existing current-format upgrade, not permission to restore historical issue/vault migration. No schema redesign, dependency changes, image/raw-HTML activation, or changes to ordinary Markdown writes.

## Current state and evidence
`src/objects/upgrade-markdown.ts:103-106` escapes punctuation in `text()`. At lines 167–172, `inlineMarks()` blindly wraps serialized content:
```ts
const delimiter = mark.type === 'strong' ? '**' : '*';
result += `${delimiter}${content}${delimiter}`;
```
At line 219 `markdown()` validates only source type/size. `upgradeObjectMarkdown()` writes live records and historical snapshots and then removes `document_json` in the constructor transaction. Plain `a`, strong-marked `!`, plain `b` becomes `a**\\!**b`, which Bun renders with literal asterisks instead of strong emphasis.

The established contract is: "Unknown nodes and malformed or otherwise unsupported structures still roll back the entire upgrade." Prefer faithful serialization of representable inputs. If a case cannot be faithfully represented, fail explicitly before commit rather than silently dropping marks/text. Do not invent a general document adapter or serialize trusted-looking HTML.

Tests use `node:test`, `node:assert/strict`, isolated `openDatabase()` and `t.after(() => db.close())`. `test/objects-upgrade.test.ts` has `fixture`, `insert`, `literal`, `paragraph`, `document` helpers and successful live/history/receipt plus full rollback tests. Match them. Existing exemplar assertions:
```ts
const runtime = new ObjectRuntime(db);
const html = Bun.markdown.html(runtime.getObject(sourceId).body, { noHtmlBlocks: true, noHtmlSpans: true });
assert.match(html, /<strong>Bold<\/strong>/);
```

## Scope
Only modify:
- `src/objects/upgrade-markdown.ts`
- `test/objects-upgrade.test.ts`
- `docs/quickstart.md` (only update upgrade guarantees/limitations if needed)
No `.data`, credentials, package/lockfile, model/runtime schema, ordinary renderer or other docs changes.

## Commands and workflow
- First: `git diff --stat 438d497..HEAD -- src/objects/upgrade-markdown.ts test/objects-upgrade.test.ts docs/quickstart.md`; expect no unexplained drift. Compare excerpts if changed; stop on mismatch.
- `bun --version` must be >=1.4.2.
- If missing dependencies: `bun install --frozen-lockfile` (no npm; Orca setup deliberately skipped because its npm hook conflicts).
- Focused: `bun test test/objects-upgrade.test.ts`.
- Final: `bun run check && bun test && git diff --check` (all pass).
- Use the Orca-provided branch. Commit logical changes with an imperative message (e.g. `Preserve emphasis in Markdown upgrades`). No push, PR, merge or edits in the original checkout. Do not edit plans index.

## Steps
1. Add regressions through actual `ObjectRuntime` v1 upgrade: strong/em punctuation flanked by letters, Unicode punctuation, leading/trailing whitespace, adjacent differing marks and nested marks. Verify current and revision-1 history. Run focused tests to reproduce at least the baseline punctuation failure.
2. Make the smallest complete context-aware serialization change. Consider entity encoding where it preserves characters while preventing delimiter flanking ambiguity; test Bun's actual interpretation rather than assuming it works. Avoid global output churn where possible. If uncertain cases remain, reject them with the existing `fail()` mechanism and test atomic rollback. Do not loosen any existing unsupported-content checks. Run focused tests; all must pass.
3. Verify successful conversion leaves IDs/metadata/backlinks stable and creation replay works; verify failure anywhere, including only in history, retains old columns/content/version/receipts. Update the narrowly scoped documentation if the supported boundary changes. Run full checks.

## Done criteria
- New actual-migration regression assertions catch the old output, and pass after the change.
- Faithful rendered text and marks for the supported matrix; no visible serializer-introduced delimiters.
- Full rollback on any newly rejected input, current or historical.
- `bun run check`, `bun test`, `git diff --check` pass.
- Changed file list stays within scope; commit recorded; original checkout untouched.

## STOP conditions
Stop and ask the coordinator if fidelity requires a new dependency, changing ordinary writing semantics, changing a schema, or out-of-scope files. Stop on conflicting drift or two failed verification attempts after reasonable fixes. Report any material reduction in supported writing rather than silently narrowing it.

## Maintenance
Markdown delimiter context crosses legacy text-node/mark boundaries; isolated marked-word tests are insufficient. Review nested/adjacent marks and receipt replay whenever changing this serializer.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: each step and actual verification results
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit, branch, worktree path, deviations, limitations
