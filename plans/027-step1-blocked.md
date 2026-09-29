# Plan 027 — checkpoint 1 blocked after two correction rounds

## Verdict

**BLOCKED at `c90018b`. Do not start Step 2 or integrate this checkpoint.** Two bounded correction rounds have been used. Further repair needs a renewed assignment/authorization; do not silently begin a third round.

The implementation is partial: read-only preflight, fixtures, and tests exist on the isolated branch. No fixed-domain storage/runtime/UI replacement or migration has begun.

## Independent verification

- Read all four new files and both complete correction diffs.
- Bun 1.4.2 `bun run check`: pass.
- `bun test`: **188 pass, 0 fail**, 20 files.
- `git diff --check e5b6ed1..HEAD`: pass.
- Current actual pristine v6 schema: preflight returns compatible.
- No original application source, real database, provider call, or live-server change occurred.

Green tests do not close the safety gate: targeted probes still reproduce requirements from the first review that the implementation claims to have fixed.

## Remaining confirmed blockers

### 1. Structural identity is still guessed from names/messages

`validateApplicationShape` in `src/objects/upgrade-fixed-domains.ts` checks required index names, not their definitions. It accepts known triggers whenever their SQL includes an expected error-message string.

Independent probes on separate in-memory fixtures:

```sql
DROP TRIGGER object_builtin_type_0_delete;
CREATE TRIGGER object_builtin_type_0_delete
BEFORE DELETE ON object_types
BEGIN SELECT 'Built-in types cannot be deleted.'; END;
```

Result: **compatible, no blockers**, despite a no-op replacing the protection trigger.

```sql
DROP INDEX objects_journal_date;
CREATE INDEX objects_journal_date ON objects(title);
```

Result: **compatible, no blockers**, despite replacing the journal uniqueness rule with an unrelated ordinary index.

This is not sufficient evidence to authorize dropping/rebuilding canonical tables or promise a compatible migration. Actual known table constraints/indexes/trigger definitions need conservative validated-shape checks; phrases and names are not schema semantics.

### 2. Diagnostic redaction remains content-dependent

`safeId` accepts any lowercase `[a-z_]+` value as a safe identifier. An unknown property key `private_sentinel_medical_note` is reproduced verbatim in the report reason. The previous uppercase-only regression passes merely because uppercase is excluded.

Use validated UUIDs for record-derived identifiers and an explicit allowlist for fixed schema names; malformed stored content must never become report text through a generic identifier regex. SQLite integrity diagnostic text also needs a fixed safe reporting contract rather than broad string cleanup.

### 3. Fixture still does not match genuine v6 storage guarantees

Compared independently against an in-memory database initialized by the unchanged baseline `ObjectRuntime`:

- Fixture `object_views` lacks the genuine named `object_views_spec_object` shape guard.
- Fixture `object_view_revisions` lacks the genuine named `object_view_revisions_spec_object` shape guard.
- The fixture has other approximated revision/Journal guards and is not proven structurally equivalent to the v6 database that will actually be upgraded.

The fixture must freeze actual baseline DDL/metadata and prove its invariants, not merely add enough constraints to satisfy a few example probes.

## Additional incomplete details to include in a future repair

- Per-source writing edges still use an unbounded `.all()`; corrupted/spurious edges can exceed the bounded Markdown-derived target set. Iterate or batch actual edges and retain only the bounded expected set.
- Error classification conflates valid extra property values with malformed records, so some legitimate incompatible content gets exit 1 rather than the documented exit 2.
- New standalone `validInstant` rejects UTC strings without milliseconds even though its regex admits them, because `toISOString()` adds `.000`; decide the supported historical timestamp contract explicitly and test it rather than normalizing or guessing.
- Full-file logical no-mutation assertions still cover only selected table rows, not the entire preserved application evidence promised by the gate. Normal read-only opening is reassuring, but reports should describe actual tested coverage accurately.

These are follow-through on the existing checkpoint requirements, not requests for new product features or a general migration platform.

## Preserved work and next decision

- Worktree: `/home/alex/orca/workspaces/GenUIExperiment/fixed-domains`.
- Branch: `alexradunet/fixed-domains`.
- Commits: `c3d58b4` initial checkpoint; `969981d` correction 1; `c90018b` correction 2.
- Same four changed paths: preflight CLI, shared analysis, frozen-fixture candidate, preflight tests.
- Original checkout remains at `e5b6ed1`; only advisory planning/review files changed there.
- No merge/push or actual user-data migration is authorized or performed.

Recommend one explicitly approved focused repair of the still-failing preflight boundary, then independent verification before any destructive DDL. Do not weaken the migration gate, discard custom data, start a fresh real database, or skip to UI replacement to make progress look faster.
