# Plan 010: Owner-approved final history repair

## Authorization and base
The owner explicitly approved **one further bounded repair round** after the two earlier history review rounds. This is a narrow continuation, not a feature restart or permission for repeated repair loops. Use Pi in the existing isolated checkout `/home/alex/orca/workspaces/GenUIExperiment/improve-object-history`, branch `improve-object-history`, at `6dcc9254dce9657d5a57fc22afd75cd64c88449f`. The previous agent is released; no writer is active. The advisor maintains plans and reviews; you implement and commit. Do not touch master or push.

## Outcome / smallest complete approach
Prevent historical text values from losing LF/CRLF through the current single-line native text control. Extend the existing history representability guard to refuse such drafts and show the existing read-only/copy fallback. Keep the original snapshot/current object unchanged. Ordinary property widgets and runtime value rules stay unchanged. Then verify the complete script-blocked history recovery flow with representable values and stale final-save rejection.

Taskdesk is Bun 1.4.2+, strict TypeScript, SQLite, Hono trusted JSX and native forms with optional enhancement. Read `README.md`, `docs/object-contract.md`, `docs/quickstart.md` for current behavior. SQLite owns objects; history opens an unsaved draft, not a restore. Final Save uses the normal revision-checked command. Native Markdown submission may normalize line endings (documented baseline); enhanced non-writing changes preserve exact Markdown source. Do not conflate that existing Markdown caveat with the confirmed text-property loss.

## Confirmed evidence at this base
In `src/objects/http.ts` near 179, `historyAvailable(snapshot)` checks catalog identities, select/reference shape and `valueError(property.kind, value)`. Text values with CR/LF pass. That helper already gates History GET, draft-open POST and same-object historical update/type-switch requests. `PropertyControl` in `src/objects/render.tsx` near 84–113 renders text with `input[type=text]`; the browser removes CR/LF from its value.

Reviewer reproduced: create an in-memory custom text property, create a Page with extra value `first\nsecond`, update the Page to remove that property, then POST revision 1 to `/objects/:id/history/draft`. It returns 200. Chromium DOMParser/FormData over the actual response changes the value to `firstsecond`; ordinary CSRF/revision-checked HTTP Save accepts it (303, revision 3). Snapshot still exists, but the recovered field silently changes. All fixture resources were temporary. No ordinary single-line widget rewrite is needed to prevent this unsafe recovery.

Tests use node:test/assert through Bun. Match `test/objects-http.test.ts` fixture `setup`, and `history refuses unavailable historical schemas without lossy drafts or mutations`. Preserve safe values, complete historical property context, 20/page history, bounded selected-reference enrichment, and 404-only lookup handling.

## Scope
Only `src/objects/http.ts`, `test/objects-http.test.ts`, and a brief accurate fallback clarification in `docs/object-contract.md` / `docs/quickstart.md` if needed. `src/objects/render.tsx` is allowed only to clarify the existing unavailable-history message or preserve safe readable fallback, not change ordinary inputs/layout. No other application changes, new files/modules/dependencies, runtime/schema changes, client/editor refactors, provider calls, `.data`, credentials, plans edits, master/merge/push, or recursive agents. Temporary browser scripts/reports under `/tmp` are allowed; remove owned profiles/processes on completion. Never record tokens in reports.

## Steps and checks
1. Confirm clean checkout and exact base: `git status --short`, `git rev-parse HEAD`, `git diff --stat 6dcc925..HEAD -- src/objects/http.ts src/objects/render.tsx test/objects-http.test.ts docs/object-contract.md docs/quickstart.md`. Stop on unexplained drift. Dependencies are already installed; use the checked-in Bun lockfile only if an install is actually needed.
2. Add a failing regression for LF and CRLF historical text properties. Include History GET/read-only fallback, direct draft POST, historical ordinary update and `intent=change-type` requests. Assert the original value remains safely visible and current objects, snapshots, backlinks and creation receipts remain unchanged. Ensure a normal single-line historical text draft still opens and saves. Run `bun test test/objects-http.test.ts` and confirm the intended failure before fixing.
3. Add the small guard in `historyAvailable`, not normalization or relaxed validation. Use existing `Value.Check(IdSchema, ...)` instead of its copied UUID regex while touching this guard. Keep readable control flow. Reuse the same server decision at existing callsites. Run `bun test test/objects-http.test.ts test/objects-runtime.test.ts test/objects-upgrade.test.ts` -> all pass.
4. Browser verification: adapt the existing temporary recipe `/tmp/plan010_chromium_verify.mjs` (fresh profile, loopback CDP, in-memory `createApp` and a generator that throws if called). For reliable screenshots see `/tmp/task_619d2e7b4132_capture_repair.mjs`. Block `/objects-client.js` and `/writing-client.js` **before navigation**. Use trusted browser key/mouse input through CDP, not `requestSubmit`, DOM value assignments or synthetic events, for the interaction gates. Complete History -> select revision -> open unsaved draft -> edit -> click/keyboard Save and verify same-object canonical values/revision. Separately make a fixture-only concurrent runtime update after draft opening; native Save must reject and retain edits/old revision, then explicit reconciliation succeeds. Check LF/CRLF unsafe fields show fallback with no draft action. Capture/read relevant narrow controls with correct viewport or full-page semantics, rather than inferring visibility from existence. Record exactly what ran; no physical-human claim.
5. Update docs only as needed. Run `bun run check && bun test && git diff --check 6dcc925..HEAD` and `git diff --check` (uncommitted edits too), inspect changed paths, commit scoped repair with an imperative message, then check clean status. Expected baseline is 89 passing tests before new regression(s).

## Done / stop
The confirmed text loss is impossible through historical draft paths; original data/snapshots remain unchanged on refusals. Representable history recovery and conflict reconciliation work with application scripts blocked. Strict TS, full tests, diff hygiene and independent review are required. STOP/report if the narrow guard cannot achieve this, if broader scope is required, or this owner-authorized repair still fails; do not start another repair round or waive a browser gate. Ask the coordinator about real blockers. During a long task, check structured guidance before finalizing.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: exact checks and outcomes, including initial regression failure
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit, branch/worktree, temporary script/report/image paths, actual browser mechanism and limitations

Send the same concrete summary and report path through the current Orca `worker_done` preamble. Source acceptance belongs to the reviewer.
