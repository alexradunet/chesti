# Plan 006: Honor explicit assistant intent and foreground dialogs

## Status
- Priority P2; effort S/M; risk LOW/MED; category bug; confidence HIGH.
- Planned at `438d497`, 2026-09-26. Dependencies: none.
- Isolated Orca executor; reviewer maintains plans index.

## Outcome
Explicit refinement/new-conversation URLs must not be overridden by an old tab conversation; ordinary navigation must still preserve that conversation and unsent prompt. Escape in the writing-link dialog must cancel only that dialog and restore writing selection/focus, leaving the background assistant alone. Preserve native forms, no automatic generation/provider calls.

## Current state and evidence
`src/objects/client.ts:47-59` derives AiState from native form/body then restores storage:
```ts
if (!aiState.draft && stored && (!aiState.conversationId || aiState.conversationId === stored.conversationId) && typeof stored.open === 'boolean' && typeof stored.draft === 'string' && typeof stored.contextTitle === 'string') {
  aiState = { ...stored, open: aiState.open || stored.open };
}
```
This ignores explicit previousId/new intent. `render.tsx:488` emits refinement URL `/views/${view.id}?ai=1`; direct opening/reload can replace requested B with stored conversation A. Ordinary `/views/B` must NOT retarget an existing conversation. `/views?ai=1` is explicit new-view entry; a `conversation` query explicitly selects its thread. Server-rejected POST prompt/context also takes precedence. Read initialization, click interception, restoreConversation and form submission callsites together.

`client.ts:207-209` guards only object search before intercepting Escape/Tab:
```ts
if (objectSearch?.open) return;
if (event.key === 'Escape' && (navOpen || aiState.open)) { event.preventDefault(); closeDrawer(); }
```
`writing.ts:279` opens a native link dialog with `showModal()`; lines 292-297 close/cancel restores editor bookmark/focus. Global preventDefault hijacks native Escape cancellation when assistant is open. Defer workspace handling to foreground native modal dialogs, including search and writing links. Avoid broad suppression of all keyboard shortcuts or inaccessible custom modal behavior.

Project contract: "Explicit request context takes precedence over stored browser state"; navigation never silently retargets conversation; Escape cancels links without writing changes. Native HTML forms remain baseline.

## Scope
Only modify:
- `src/objects/client.ts`
- `src/objects/render.tsx` only if a small explicit-intent attribute is needed
- `src/objects/ai-state.ts` (optional NEW dependency-free helper only if it captures the coherent state-restoration rule for tests; no general state framework)
- `test/objects-client-state.test.ts` (NEW, focused state tests)
- `test/objects-http.test.ts` only if native-intent markup needs regression coverage
- `docs/object-contract.md` for clarified intent/keyboard behavior
No writing serializer changes, styles/layout redesign, HTTP/model contract edits, dependencies, .data, or credentials. Ask before any other path.

## Commands / workflow
- `git diff --stat 438d497..HEAD -- src/objects/client.ts src/objects/render.tsx src/objects/ai-state.ts test/objects-client-state.test.ts test/objects-http.test.ts docs/object-contract.md` → no unexplained drift.
- Bun >=1.4.2; if necessary `bun install --frozen-lockfile`; Orca npm hook deliberately skipped.
- Tests follow existing `node:test` and `node:assert/strict`, e.g. test/objects-http.test.ts; meaningful behavior assertions, not exact source-text matching.
- `bun test test/objects-client-state.test.ts test/objects-http.test.ts` → all pass after fix.
- Final `bun run check && bun test && git diff --check` → exit 0.
- Commit on Orca's branch with imperative message. No push/merge/PR, original-checkout edits or index edits.

## Steps
1. Reproduce explicit refinement B being overwritten by stored A, and Escape link-dialog conflict in a real browser before fixes. Use an explicitly temporary DB/server and Orca embedded browser. Use exact browser page ID to avoid other workers. No provider calls (seed views/conversations through existing canonical service fixtures where needed).
2. Implement a small explicit-request-vs-storage precedence rule. Preserve ordinary navigation and draft restoration; honor explicit new, explicit refinement, explicit conversation, and rejected native prompt/context. Preserve whitespace prompts. Restore a saved draft only when its thread/target is the same intended one; never attach A's draft to B. New-conversation UI must remain available with JS and native forms. Add meaningful pure rule tests if extracting the helper; no jsdom/browser dependency or source-string assertions.
3. Ensure workspace Escape/Tab logic yields to the active native modal dialog. Rely on existing dialog cancellation/bookmark code, not duplicate it. Test writing-link Escape with assistant open and closed, and object-search Escape. Run focused tests.
4. Real browser acceptance matrix: ordinary navigation retains A+prompt; direct `/views/B?ai=1` targets B and no A draft; explicit new entry targets no prior view/thread; explicit conversation query wins; rejected prompt persists. For link dialog, Escape closes only dialog, keeps assistant open, preserves writing and selection, returns focus; desktop plus narrow-screen keyboard path where applicable. Check object search still works. Record browser evidence. Shut down only own temporary server/artifacts.
5. Update contract wording if useful, run all final checks, inspect scope and commit.

## Done criteria
- Regression tests cover explicit-vs-stored state and ordinary navigation, preserving draft/context association.
- Native form targeting and no-JS behavior remain functional.
- Browser proves dialog Escape/focus plus direct-load intent scenarios, not merely synthetic event dispatch.
- Full TS/tests/diff checks pass; changed paths within scope.

## STOP conditions / maintenance
Ask if behavior needs changing product semantics outside explicit targeting, adding dependencies, touching unapproved paths, or overriding browser-native dialog semantics. Stop on unexplained drift or twice-failing checks. Report browser unavailability, do not claim synthetic checks prove focus. Future dialog surfaces should inherit foreground-modal ownership; new navigation links must distinguish explicit start/refine from passive browsing.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: each step plus actual commands/results and browser matrix
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit, branch, worktree, deviations, limitations
