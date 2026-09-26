# Plan 007: Supply typed reference choices to published view actions

## Status
- Priority P1; effort M; fix risk LOW–MED; category bug; confidence HIGH.
- Planned at `058e883`, 2026-09-26. Dependencies: none.
- User selected this fix and authorized separate Orca executors, review, and conditional local integration into master. No push is authorized. The advisor maintains the plans index and never edits application source.

## Why this matters
A published board scoped by a Project input and grouped by an Assignee reference loads only Project objects into its picker data. The Assignee select therefore contains only Not set and the current selection, not other valid people. An in-memory HTTP reproduction with two People confirmed that the second person is absent, while `ViewService.act` accepts reassignment to that person. Unparameterized views also use a global 200-object list that unrelated types can crowd out. Fix the data supplied to existing trusted controls, not the view schema or command permissions.

## Current state and conventions
- `src/objects/http.ts:187–193` prepares view pages:
```ts
model.screen = 'view'; model.objects = objects.listObjects({ limit: 200 });
model.evaluatedView = views.evaluate(match[2]!, url.searchParams.get('input') || undefined);
const inputType = model.evaluatedView.view.spec.input?.typeId;
if (inputType) {
  model.objects = objects.listObjects({ typeId: inputType, limit: 200 });
  if (model.evaluatedView.input && !model.objects.some(record => record.id === model.evaluatedView!.input!.id)) model.objects.push(model.evaluatedView.input);
}
```
- `src/objects/render.tsx:97` filters this same pool by the reference property's target type. `InlineAction` at line 438 passes `name="value"` to `PropertyControl`; `View` filters the same pool to its input type. Missing selected references are already retained as options.
- `pickerObjects` in `src/objects/http.ts:82` queries each necessary reference target type once for the object editor. Reuse its bounded-query idea, not a second unbounded list or a query per row.
- `ObjectRuntime.listObjects({ typeId, limit: 200 })` validates type IDs, excludes Trash by default, and uses prepared values. `ViewService.act` rechecks publication, revisions, binding, filters and input scope. Do not relax it.
- `test/objects-http.test.ts` uses node:test, node:assert/strict, in-memory `openDatabase()`, an injected provider-free generator and a real loopback server. Follow its `setup(t, generator)` and HTMLRewriter option extraction patterns, including `reference pickers bound each target type...`.
```ts
const f = await setup(t, async () => { throw new Error('Not used'); });
const response = await f.get(path);
assert.equal(response.status, 200);
```
- Product contract: objects own data; views only reference it. Native forms remain functional. Pickers remain bounded to 200 live candidates per target type plus existing selections. No automatic publication or model calls.

## Scope
Only change `src/objects/http.ts`, `test/objects-http.test.ts`, and `README.md` if wording needs clarification. A tiny cohesive request-local candidate helper in http.ts is allowed. Do not change render/model/client, runtime/views domain rules, dependencies, database schema, or source elsewhere. Ask if another file is needed.

## Commands / git workflow
- First: `git diff --stat 058e883..HEAD -- src/objects/http.ts test/objects-http.test.ts README.md`; expected no unexplained drift. Compare excerpts if changed; stop on unapproved drift.
- Bun >=1.4.2. Install only in the assigned isolated worktree when needed: `bun install --frozen-lockfile` -> exit 0.
- Baseline and regression: `bun test test/objects-http.test.ts test/objects-views.test.ts` -> all pass after the fix; new regressions fail on the original behavior.
- Final: `bun run check && bun test && git diff --check` -> exit 0, all tests pass.
- One writer in this worktree. Commit only in-scope files, with an imperative message such as `Fix typed reference choices in view actions`. Do not merge, push, change master, modify plans, or start other agents. Report the commit and worktree path.

## Steps
1. Reproduce a parameterized editable board: custom Work type has Project and Assignee reference fields targeting different types; create one project and two people; bind group to Assignee and filter Project equals input. Inspect actual inline `select[name="value"]` options. Also reproduce a non-input board with >200 unrelated objects. Verify both new tests fail before changing route behavior with the focused test command above.
2. Derive required target types from the evaluated view's reference bindings used in displayed fields/actions, plus its input type. Query each distinct needed type once with limit 200. Deduplicate the combined pool; retain selected input and selected reference values outside the candidate window, including retained trashed references. Keep the input control filtered to its own type and do not load all workspace types just for one view. Preserve existing reference labels where reasonably available. Verify focused tests pass, including previous object-editor picker tests.
3. Add >200 targets and multiple source/target-type cases. Assert per-target bounds plus retained selections, no unrelated options, no new trashed choices, and actual POST action updates only the bound object property. Include a mismatched input or stale revision rejection so extra display candidates cannot widen command authority. Run focused tests -> all pass.
4. Browser-check the generated control in an explicitly temporary/in-memory fixture with an injected generator or directly created fixture view. Use Orca embedded browser scoped to this worktree/page ID; do not touch `.data`. Select a different assignee with keyboard, save, and verify the object changed. Check a narrow viewport and native no-JavaScript submission. Record commands/results; if tooling cannot verify, report the exact limitation, not a pass. Run final gates and commit.

## Done criteria
- Real HTTP regression tests prove valid alternate assignees are present with a different input type and with >200 unrelated objects.
- All candidate limits and current selections remain intact; input scope and stale revision tests pass.
- `bun run check`, `bun test`, and `git diff --check` exit 0.
- Browser selection/save, keyboard, narrow viewport, and native form behavior are verified or explicitly blocked for reviewer follow-up.
- `git diff --name-only 058e883..HEAD` and the working-tree diff contain only approved source/test/doc changes from this assignment; no live data or credentials touched.

## STOP / maintenance
Stop after two unsuccessful attempts at the same verification, on unexpected drift, or if a new picker framework/schema/permission change is needed. Future reference controls must collect candidates by target type before rendering; filtering a globally capped pool is insufficient. The later searchable-picker feature must retain these native fallback guarantees.

## Executor report
STATUS: COMPLETE | STOPPED
STEPS: each step, actual command and result
STOPPED BECAUSE: if applicable
FILES CHANGED: exact paths
NOTES: commit, branch, worktree, browser evidence, deviations/unverified behavior
