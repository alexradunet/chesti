# Plan 027 — checkpoint 1, final correction request

## Delivery / verification

Commit `969981d929f904aa6e16e7a0cdfb078d41ea5592` improves view semantics/signatures, explicit extra-column/external-FK reporting, source-path validation, and analysis connection state. Independent strict TypeScript, 183 tests / zero failures, and hygiene pass. Full changed files read again.

**Verdict: REVISE — correction round 2 of 2. Step 2 remains unauthorized.** The remaining items are uncompleted parts of the first review, not new product scope. If they cannot be completed safely in this round, stop and report the specific limits.

## Reproduced remaining failures

Each was exercised in a fresh owned in-memory fixture:

1. Replace `object_builtin_type_0_delete` with a same-name no-op trigger: preflight still says compatible.
2. Drop `objects_journal_date`: still compatible.
3. Add a custom index on `objects(properties_json)`: still compatible, although this schema object cannot survive the proposed column removal unchanged.
4. Set a complete historical snapshot's title to empty and createdAt to `not-a-time`: still compatible.
5. Set a current object's created_at to `2026-99-99T88:88:88Z`: still compatible (regex alone is not a valid instant).
6. Add an unknown property named `PRIVATE_SENTINEL_MEDICAL_NOTE`: that text is copied into report.reason. `safeId` accepts arbitrary short ASCII identifiers, so it is not a content-redaction boundary.
7. Add unrelated table `"owner notes"`: analysis throws SQL syntax error due to interpolating its name in `PRAGMA foreign_key_list(${table})`.

## Complete the existing requests

### Structural preflight and frozen baseline

Do not whitelist triggers by name or a phrase in their SQL. Check the actual known application table/constraint/index/trigger shapes conservatively, including missing objects and altered known names; unsupported customization blocks. Use SQLite metadata with bound pragma table-valued functions or properly quoted static identifiers, not untrusted database identifiers inserted as SQL. Enumerate indexes by `tbl_name` so a custom index cannot be missed because its name is unfamiliar. No generic SQL parser/framework is needed; a small frozen baseline shape/DDL comparison with conservative rejection is preferable to pretending unknown structure is safe. Explain any legitimate supported older-v6 shape variation instead of silently accepting it.

The fixture still lacks actual v6 named structural CHECKs, and its Journal guards check only NULL, not real dates. Copy the genuine baseline DDL/guards, not an approximation; prove with direct SQL invalid-date/JSON-shape cases and compare it to a real pristine baseline schema. Keep the compatible fixture frozen independently of the future initializer. It is fine to use stable UUID constants, but don't call production initialization to manufacture an allegedly frozen v6 fixture. Mark metadata-only old-version fixtures as such.

### Full record validation and safe diagnostics

Finish historical/current title, real timestamp, positive safe revision, identity/key correspondence, and other supported shape checks. Reject malformed content consistently. Use strict UUID validation for data-derived identities; table/column names in safe diagnostics must come from an allowlist or be redacted, not arbitrary ASCII passthrough. Only fixed reason text plus validated identifiers goes to the public report. The CLI catch path must not print arbitrary SQLite exception messages that can include private schema/content. Use a small structured distinction between malformed/error and valid-but-incompatible so exit 1/2 matches help, rather than pretending every stored invalid shape is ordinary incompatibility.

### Actually bounded scanning

`validateWritingEdges` now builds two maps for every object and edge in the entire workspace. Replace this with per-source bounded comparison/iteration; do not retain global edge sets. `foreign_key_check().all()` still materializes all errors; use iteration or bounded queries with accurate total/sample bookkeeping. Do not count a million structured edges by calling builder.add a million times after SQL already returned a count; let the report accumulate a known count with bounded examples.

Add a >500-row batch-boundary test (the current test has only 12 rows), >5 FK failures, and meaningful missing/spurious/mixed-case writing-edge cases. Current fixture UUIDs contain no alphabetic hex characters, so uppercasing them does not verify case behavior; use at least one actual a–f ID or dedicated regression.

### Tests must prove the claims

Add the exact independent repro cases above. Compare complete logical source rows/schema and file mode before/after CLI, not just table names. Verify source `DATABASE_PATH` sentinel contents are unchanged. Cover valid incompatible exit 2, malformed stored data exit 1, unknown version exit 1, and readonly analyzer settings success/failure inside/outside a parent transaction.

No arbitrary shared wrapper is needed: remove unused `fixedDomainFingerprint` passthrough and test the actual existing fingerprint directly against frozen literal evidence (or explain a coherent future responsibility before adding it).

## Boundaries and return

Same isolated executor, same four files, no active migration/runtime/UI changes. Run focused tests, strict TypeScript/full suite/hygiene; commit and pause. Report every remaining gap plainly; do not claim a requirement fixed merely because a new test checks one easier example. Reviewer will independently rerun the adversarial cases before authorizing any destructive DDL.
