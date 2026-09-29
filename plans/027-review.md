# Plan 027 review record — Step 2 acceptance and Step 3 product exercise

Lead-owned record. Evidence was gathered against a throwaway database created for review
only (`DATABASE_PATH` inside a `mktemp -d` directory, server on port 3990). No `.data/`
database was opened, inspected, migrated, or deleted; no live server was restarted; no
merge, push, or provider call was made. The review database and server were removed
afterwards.

## Scope reviewed

- Commits: `0751f73` (executor Step 2), `baeb2c2`, `f59a253` (round-2 corrections).
- Baseline for comparison: `ad2e6da`.
- Review rounds: two. Round 1 rejected the delivery; round 2 fixed the reported UI,
  prompt, benchmark, and commit items. The owner then accepted Step 2 **with the test
  coverage gap recorded below** and asked to proceed to Step 3.

## Commands re-run by the lead, not taken from the executor report

| Command | Result |
| --- | --- |
| `bun run check` | pass (`tsc --noEmit`, exit 0) |
| `bun test` | 50 pass, 0 fail, 18 files |
| `git diff --check ad2e6da..HEAD` | clean |
| `bun scripts/sqlite-bench.ts --objects=60 --large-objects=60 --repetitions=2 --warmups=1` | exit 0, emits measurements for v7 |

Test count fell from 201 at `ad2e6da` to 50. Retiring converter, preflight, and generic
schema-editor tests accounts for part of that; finding F4 covers the rest.

## Step 3 evidence — behavior verified working

Verified through Orca's built-in browser plus server-rendered form posts against the
review database.

1. **Fresh v7 workspace.** First start created the schema and seeded one demo object per
   fixed domain (6 objects). `sqlite_master` contains no `object_types` or
   `object_properties` table, before and after attempted schema mutations.
2. **`/types` is read-only.** Accessibility snapshot reports 9 headings and 18 links with
   zero textboxes, buttons, comboboxes, or checkboxes. Navigation no longer offers
   "Manage types" or "New type".
3. **Retired mutation routes are inert.** `POST /types/create`,
   `/types/{id}/update`, `/types/{id}/properties`, `/properties/{id}/update` each returned
   404 with no write and no definition table created.
4. **Request security.** `Host: evil.example.com` → 403; `Host: 127.0.0.1:3990` and
   `localhost:3990` → 200; cross-origin `POST` → 403; bad CSRF token → 403; valid
   same-origin `POST` → 303.
5. **Favorites.** Favoriting persisted an `object_favorites` row, rendered in the sidebar
   and on `/objects/favorites`, and the control relabeled to "Unfavorite".
6. **Stale revision conflict.** An out-of-band save moved the object to revision 3; the
   browser's stale save was rejected and changed nothing. The "Compare before saving"
   panel appeared, the draft text `Conflict test (browser draft)` was still in the editor,
   focus moved into the panel, and `Save reconciled changes` committed revision 4.
   `object_revisions` retained revisions 1–3.
7. **Journal uniqueness including Trash.** Creating a second Journal for 2026-09-29 →
   409. After trashing the original (303, `trashed=1`, revision 2), the same create →
   still 409. Only one Journal row exists.
8. **Markdown-only connections.** Saving `[Open the task](/objects/<uuid>)` in Person
   writing created the derived edge in `object_references`, and the target's
   "Linked from" section lists both link sources. Raw `<img src=x onerror=alert(1)>`
   produced no `onerror` in saved reading output.
9. **Immutable view history.** Direct `UPDATE` and `DELETE` against
   `object_view_revisions` both abort with `View revision history is immutable`.
10. **View deletion is a tombstone.** Deleting the published view set `deleted=1` at
    revision 3, appended history rather than rewriting it, and left all 6 objects intact.
11. **Scoped view action.** The published calendar exposes one action ("Edit Scheduled
    date"). An in-scope post returned 303, changed only the scheduled date
    (`2026-09-29` → `2026-10-05`), bumped the object to revision 2, and retained history.
    An out-of-scope `role=title` post returned 422 `This view does not expose that
    property.` with no mutation.
12. **Generation fails explicitly.** With no provider configured, `POST /views/generate`
    returned 503 `The configured Pi model is unavailable.` No view was fabricated and no
    conversation turn was stored.
13. **Keyboard access.** Tab order from a fresh load is `Skip to content`, then the
    workspace navigation links. `:focus`/`focus-visible` rules exist in `public/ui.css`
    and `public/objects.css`.
14. **Screens render.** `/`, `/people`, `/calendar`, `/tasks`, `/views`,
    `/objects/favorites`, `/design-system`, and all six `/?type=<uuid>` browse links
    returned 200 with expected headings.

## Findings

### F1 — high: a domain change that drops fields cannot be completed

Changing the Person object to Page (and any change where the source object holds values
the target domain lacks) is rejected with `Submitted fields must belong to the selected
domain.` in both the enhanced and native paths.

Cause: `src/objects/render.tsx` builds `retainedIds` from every key in
`record.properties`/`draft.properties` and then `activeIds = type.propertyIds ∪
retainedIds`, so source-domain fields stay enabled and are submitted, while the runtime
correctly rejects wrong-domain keys. The two layers disagree.

Plan 027 requires that a saved domain change removing current fields *disclose those
fields and require native-form confirmation*, with the prior object preserved in history.
No disclosure naming the removed fields and no confirmation control exists; the only
markup is `data-retained`. The copy `Changing type keeps existing values.` is misleading
in this path.

Data safety held: nothing was mutated (type and revision unchanged, no history rows),
and drafts were retained.

### F2 — high: native "Use type" does not load the target domain's fields

After a native `intent=change-type` post switching Reminder → Task, the re-rendered page
still showed `Reminder date` and `Reminder time` enabled and visible while `Done`,
`Due date`, and `Scheduled date` were `DISABLED hidden`. The control's own copy promises
"Choose Use type below to load its fields without saving or losing your writing."

Net effect of F1 + F2: a domain change only completes when the source object has no
property values. That case was verified working (Page → Task saved, revision 2, history
revision 1 retained).

### F3 — medium: focus is lost after enhanced mutations

After the enhanced favorite post, `document.activeElement === document.body` and
`window.scrollY` reset to 0. Keyboard users lose their place in the page. AGENTS.md
requires enhancements to preserve keyboard access and focus behavior.

### F4 — medium: six current guarantees have no regression tests (owner-accepted)

Coverage at `ad2e6da` → now, counted as test files mentioning the term:

| Guarantee | Before | After |
| --- | --- | --- |
| Host header validation | 2 | 0 |
| Revision conflict / stale revision rejection | 3 | 0 |
| Favorites | 4 | 0 |
| Trash/restore, Journal uniqueness across Trash | 11 | 0 |
| Immutable view revision history | 2 | 0 |
| Atomic conversation and view draft writes | 2 | 0 |

Every one of these except atomic draft writes was exercised manually in this review and
works. Nothing now prevents a regression. The owner accepted Step 2 with this gap
recorded rather than commissioning a third revision round; it remains open work, not a
closed item.

### F5 — low: documentation drift

`docs/object-contract.md` still states that startup seeds "three published views". The
demo now creates two (`01 · Tasks by done state`, `02 · Fixed-domain calendar`).

### F6 — low: misleading unreachable branch

`src/objects/render.tsx:401` still renders `Create a <a href="/types">type</a> before
creating an object.` Type creation is retired and `/types` is read-only. The branch is
unreachable while six fixed domains always exist, but the text is wrong if reached.

### F7 — low: orphaned route

`/types` remains routable but is no longer reachable from navigation. Either link it as
the fixed-domain reference or remove it.

## Not verified

- **~390px responsive layout.** Orca's built-in browser CLI exposes no viewport, resize,
  or device-emulation command, so narrow-width rendering could not be observed. Static
  CSS includes `@media (max-width: 760px)`, `(max-width: 900px)`, and
  `(max-width: 1199px)` rules, which is not evidence of correct layout. Per AGENTS.md
  this is reported as a verification blocker rather than worked around with a different
  browser.
- **Real model generation.** No provider call was made by policy. Only the explicit
  failure path was verified, so draft-view creation, refinement conversations, explicit
  conversation targeting across navigation, and unsaved-prompt preservation remain
  unexercised.
- **Atomic conversation and view draft writes.** Requires successful generation; not
  exercised.

## Recommended follow-up work

1. F1 + F2 together: make domain change a single coherent flow — activate exactly the
   target domain's fields, disclose the values that will be dropped, require native-form
   confirmation, and keep the prior state in history. Add regression tests for both a
   value-dropping change and a value-preserving change.
2. F3: restore focus to the activated control after enhanced mutations.
3. F4: reinstate behavioral tests for the six guarantees.
4. F5–F7: documentation and small UI corrections.

---

## Follow-up round — commits `5cb09c6` and `02fee65` (2026-09-29)

The owner authorized a bounded follow-up for F1, F2, F3, F5, F6, and F7. F4 stayed out of
scope. Two rounds ran against a Pi executor. All results below were re-verified by the
lead on throwaway databases; the review server and its database were removed afterwards.

Lead re-runs after `02fee65`: `bun run check` pass, `bun test` 56 pass / 0 fail / 19 files,
`git diff --check` clean, working tree clean, no `plans/` or `.data/` paths in either
commit.

### Fixed and verified

- **F1 native path.** Person → Page without confirmation returns 200 with a
  `data-type-change-drops` block (`role="alert"`) naming each dropped field and value, plus
  a `confirmTypeChange=1` field. Re-posting with confirmation returns 303: `type_id`
  becomes Page, `properties_json` becomes `{}`, revision 2, and history revision 1 still
  contains the dropped values.
- **F2 native "Use type".** Reminder → Task now activates `Done`, `Due date`, and
  `Scheduled date` and disables `Reminder date`/`Reminder time`, with Task selected.
- **F1 enhanced field activation.** Switching the Event object to Page leaves 0 of 15
  property fieldsets enabled, so foreign-domain keys are no longer submitted.
- **F1 enhanced confirmation (was the round-2 blocker).** In Orca's browser: switching to
  Page, editing the title, and clicking Save now puts the disclosure *and*
  `confirmTypeChange=1` into the DOM, keeps the edited title, and moves focus to the
  disclosure. Clicking Save again completes the change — `?saved=1`, "Saved · revision 2",
  object now Page at revision 2 with `{}` properties, history revision 1 retained, and the
  title edit preserved as `Reading-room open house (enhanced)`.
- **F3 focus and scroll.** A plain enhanced save now restores focus to the submit control
  (`data-submit-trigger="save"`, `document.activeElement` is that BUTTON rather than body).
  Focus-driven scrolling moves the viewport to the control, which supersedes the stored
  offset; that is acceptable and better than restoring a stale offset.
- **F5.** `docs/object-contract.md` corrected to two published views and six built-in
  types; `select` and `reference` removed from `PropertyKindSchema`, with the dependent
  dead branches in `http.ts`, `render.tsx`, `runtime.ts`, and `values.ts` cleaned up.
- **F6.** Dead `Create a <a href="/types">type</a>` branch removed.
- **F7.** Navigation links `/types` as "Fixed domains".

### Residual findings

- **F8 low: the editor form loses its enhancement after a disclosure replacement.** The
  client replaces the editor with `document.importNode(...)`, which does not carry event
  listeners. Measured with a `window.fetch` probe: the first (disclosure) submit issued 1
  fetch, while the confirming submit performed a full-page native navigation. The save is
  correct and data is preserved; only enhancement behavior (focus/scroll restoration) is
  lost for that submit. Re-binding the handler to the replaced form would close this.
- **F9 low: one domain-change assertion is too loose.** In
  `test/objects-domain-change.test.ts`, `submitting fields that do not belong to the
  selected domain is rejected without mutation` asserts
  `response.status === 422 || response.status === 200`, so any re-render passes. The
  follow-up assertions that the object is unchanged give the test its real value, but the
  status check should pin the actual rejection.
- **F10 low: no test for the client-side enhanced confirmation contract.** The HTTP-level
  contract is covered by the six new domain-change tests; the `data-object-editor`
  replacement path in `client.ts` is untested even though
  `test/objects-client-state.test.ts` provides a suitable style.
- **F4 unchanged:** the six broader guarantee areas still have no regression tests. They
  were manually re-verified in the first review pass and remain open work.

### Process note

The first follow-up round left seven `bun src/server.ts` smoke processes running, all
bound to `PORT=3991` with different `/tmp/taskdesk-smoke-*` databases, plus nine leftover
temporary directories. Because they shared one port, responses were nondeterministic and
the lead's first verification pass received meaningless 403/404 results from a database it
was not testing. Each process was identified through `/proc/<pid>/environ`, confirmed to
use a temporary database rather than `.data/`, and then killed; the directories were
removed. The executor's "Cleanup confirmed" claim for that round was inaccurate, and its
in-memory smoke run could not have caught the enhanced-path blocker.
