import {
  PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID,
  EVENT_TYPE_ID, EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID,
  REMINDER_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID,
  JOURNAL_TYPE_ID, JOURNAL_DATE_PROPERTY_ID,
} from './model.js';
import type { ObjectRecord, ViewSpec } from './model.js';
import type { ObjectRuntime } from './runtime.js';
import { ViewService } from './views.js';

/** Ordinary canonical writes; the caller owns the first-initialization transaction. */
export function seedDemo(objects: ObjectRuntime): void {
  const today = new Date();
  const day = (offset: number): string => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const link = (object: ObjectRecord): string => `[${object.title}](/objects/${object.id})`;
  const addProperty = (typeId: string, input: Parameters<ObjectRuntime['addProperty']>[2]): string => {
    const type = objects.getType(typeId);
    return objects.addProperty(typeId, type.revision, input).propertyIds.at(-1)!;
  };

  const summary = addProperty(PAGE_TYPE_ID, { label: 'Summary', kind: 'text' });
  const related = addProperty(PAGE_TYPE_ID, { label: 'Related pages', kind: 'reference', targetTypeId: PAGE_TYPE_ID, multiple: true });
  const context = addProperty(TASK_TYPE_ID, { label: 'Context', kind: 'reference', targetTypeId: PAGE_TYPE_ID });
  for (const typeId of [EVENT_TYPE_ID, REMINDER_TYPE_ID, JOURNAL_TYPE_ID]) {
    addProperty(typeId, { propertyId: context });
  }
  const priority = addProperty(TASK_TYPE_ID, { label: 'Priority', kind: 'select', options: ['High', 'Medium', 'Low'] });
  const [high, medium, low] = objects.getProperty(priority).options!;
  const effort = addProperty(TASK_TYPE_ID, { label: 'Effort (hours)', kind: 'number' });

  const writing = objects.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'Writing · Markdown, links, and backlinks',
    properties: { [summary]: 'Edit formatted writing and connect objects without copying them; Markdown stays the source of record.' },
    body: `# Writing is a primitive

This page is ordinary **Markdown**, not a generated interface. With JavaScript, edit its formatted writing directly. Saving writing edits may normalize Markdown syntax; changing only properties leaves the source unchanged. Without JavaScript, or if formatted editing is unavailable, use the source field and **Read saved writing**.

## Try it

1. Add a sentence in the writing field and choose **Save changes**.
2. Select a few words, choose **Insert object link**, and search for another object.
3. Save, open that object, and inspect **Linked from**. Links in writing and references in Properties both create backlinks, with their own provenance.

> The object owns the writing. A list, gallery, or saved view is another way to reach the same object.

### A tiny planning table

| Question | Note |
| --- | --- |
| Who is this for? | Neighbors who enjoy sharing books |
| What is the smallest useful opening? | A few chairs, a shelf, and a warm welcome |

Use headings, emphasis, lists, quotes, tables, and inline code such as \`book_count = 12\`. Raw HTML is text, unsafe links are not clickable, and images are inert placeholders—not remote downloads.

Search finds titles and saved writing. Try searching for **warm welcome** with Search or Ctrl/Command+K. Escape returns to your draft without changing it.`,
  });
  const safety = objects.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'Safe experiments · edits, trash, and ownership',
    properties: { [summary]: 'Practice on real demo objects: revision checks, reversible trash, and view independence.' },
    body: `# These are your objects now

Everything in this demo uses the normal editor and commands. There is no locked tutorial state, hidden sample store, or reset-on-restart behavior.

## Try reversible trash

Open **Trash → Task**, find **Restore me · a discarded checklist**, and choose **Restore object**. Its writing and identity return unchanged. You can trash it again afterward.

## Observe revision protection

Open one task in two browser tabs. Save a change in the first, then try saving a different change in the second. The stale save retains your draft and shows the current saved content for comparison. Reconcile it explicitly; Taskdesk never silently overwrites a newer revision.

## Delete a view, not its data

A saved view references objects. Deleting a demo view removes that perspective, not its tasks, dates, or writing. Editing a date or group through a published view updates the original object everywhere.

The SQLite database is the live authority. Back it up with SQLite's backup operation before replacing a workspace. Demo data is installed only when a workspace is first initialized; restarting never restores deleted views or trashed examples.`,
  });
  const perspectives = objects.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'Views · compose primitives, not applications',
    properties: { [summary]: 'Explore lists, tables, editable boards, a calendar agenda, and reference-scoped inputs.' },
    body: `# One collection, several perspectives

Open **Views** in the sidebar. The three published demo views are bundled examples, not AI-generated results. They work without a provider account and use the same validated components and commands as generated views.

- **01 · Start here:** a list of guide pages, an editable Done board, and a table of the same tasks. Change Done on the board, then open the task to see the saved value.
- **02 · Calendar:** Task due dates and Journal dates share one agenda block. Separate Event and Reminder blocks display their all-day and timed alternatives without duplicates. An undated task remains **Unscheduled**.
- **03 · Page focus:** choose the reading-room Page as input. A Priority board shows its unfinished tasks; a list shows related events, reminders, and journals. Choosing another Page changes the scope. No selection means no results, not all results.

## Make a new perspective

With Pi authentication configured, choose **Create view** and ask:

> Show incomplete Task objects in an editable board grouped by Priority. Include Due date and Effort (hours) as columns, and keep tasks without a priority visible.

Review the draft before publishing. **Refine with AI** starts an explicit conversation about a view and produces a separate draft; it does not overwrite the published view. Pin a useful view to keep it in your sidebar.

The assistant receives your prompt and schema metadata, not automatic access to object writing, files, or shell commands. It creates declarative views, not objects or arbitrary code. Provider errors remain errors; these bundled examples are not generation fallbacks.

## Extend the vocabulary

In **Manage types**, create Work item **Based on Task** to reuse its current property identities. It is an independent type, not live inheritance. Reuse existing properties when they mean the same thing; labels can change without breaking ID-based bindings.`,
  });
  const project = objects.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'Reading room · a small neighborhood project',
    properties: {
      [summary]: 'Open a welcoming place to read and exchange books. A project is just a Page linked to work.',
      [related]: [writing.id, perspectives.id],
    },
    body: `# Open a neighborhood reading room

A fictional, deliberately small project: turn a spare corner into a welcoming place to read and exchange books. No Project plugin is needed—this is a **Page** with Markdown and a few properties.

## Success looks like

- A comfortable place to sit and browse.
- A short invitation neighbors can understand.
- One opening session, followed by a reflection on what to improve.

Tasks, events, reminders, and the daily journal point here through the shared **Context** reference. Open **Linked from** to discover that work. In **03 · Page focus**, select this page to see the same relationships as a scoped board and list.

**Related pages** demonstrates a multi-value reference; **Summary** is a text field. Read ${link(writing)} for writing tools and ${link(perspectives)} for views.

All dates are placed around the day this workspace was initialized. They are saved dates, not a schedule that shifts on every restart.`,
  });

  const invitation = objects.createObject({
    typeId: TASK_TYPE_ID,
    title: 'Write a welcoming invitation',
    properties: { [context]: project.id, [priority]: high!.id, [effort]: 1.5, [TASK_DUE_PROPERTY_ID]: day(0) },
    body: `# Make the invitation clear

For ${link(project)}, write three sentences: who the reading room is for, what neighbors can bring, and when the opening session happens.

**Try the primitives:** Done is a boolean, Due date is a date, Priority is a select option, Effort (hours) is a number, and Context is a typed reference. Change Done through **01 · Start here**, or reschedule Due date through **02 · Calendar**. Both edit this very task.`,
  });
  objects.createObject({
    typeId: TASK_TYPE_ID,
    title: 'Arrange chairs and the first bookshelf',
    properties: { [context]: project.id, [priority]: medium!.id, [effort]: 2, [TASK_DUE_PROPERTY_ID]: day(1) },
    body: `Leave a clear path through ${link(project)} and put a few books within easy reach. Two hours is an estimate, not a timer.

In **03 · Page focus**, select the project and use **Edit Priority** to move this task between groups. A board groups a property; it does not move the object to a different store.`,
  });
  objects.createObject({
    typeId: TASK_TYPE_ID,
    title: 'Invite neighbors to the opening session',
    properties: { [context]: project.id, [priority]: high!.id, [effort]: 0.5, [TASK_DUE_PROPERTY_ID]: day(3) },
    body: `Share the invitation once the details for ${link(project)} are settled. This is an ordinary task, not an automated email or notification.

The reference in Properties and the link in this writing both lead to the same Page. Rename the Page and those connections keep their stable identity.`,
  });
  objects.createObject({
    typeId: TASK_TYPE_ID,
    title: 'Choose a name for the reading room',
    properties: { [context]: project.id, [priority]: low!.id, [effort]: 0, [TASK_DONE_PROPERTY_ID]: true, [TASK_DUE_PROPERTY_ID]: day(-1) },
    body: `We chose a simple name for ${link(project)}. This completed task demonstrates **Done = true** and a real numeric **0**, rather than missing values.

It remains visible on the completion board and in the table. The unfinished-task filter in **03 · Page focus** excludes it without deleting it.`,
  });
  objects.createObject({
    typeId: TASK_TYPE_ID,
    title: 'Someday · collect favorite opening lines',
    properties: { [context]: writing.id, [effort]: 0.5 },
    body: `A small writing experiment related to ${link(writing)}, not the reading-room project.

There is deliberately no Due date or Priority. It stays **Unscheduled** in the calendar and **Ungrouped** in a Priority board. Choose the Writing page in **03 · Page focus** to find it; choosing the reading-room Page must not include it.`,
  });
  const discarded = objects.createObject({
    typeId: TASK_TYPE_ID,
    title: 'Restore me · a discarded checklist',
    properties: { [context]: project.id },
    body: `This example starts in Trash. Restore it to practice reversible deletion, then edit or trash it normally.

The original plan was to catalog every book before opening ${link(project)}. We decided a small first shelf was enough. Trash keeps this reasoning instead of silently erasing it.`,
  });
  objects.setTrashed(discarded.id, discarded.revision, true);

  const opening = objects.createObject({
    typeId: EVENT_TYPE_ID,
    title: 'Opening day · an all-day event',
    properties: { [context]: project.id, [EVENT_DATES_PROPERTY_ID]: { start: day(4), end: day(5) } },
    body: `Open ${link(project)} for a relaxed first day. **All-day dates** has an exclusive end: the stored range ${day(4)} to ${day(5)} represents one day, not two.

An Event requires either All-day dates or Event time, never both. Use the corresponding calendar block to reschedule it. To switch representations, edit the object and clear the old field while filling the other.`,
  });
  objects.createObject({
    typeId: EVENT_TYPE_ID,
    title: 'Plan the opening · a timed conversation',
    properties: { [context]: project.id, [EVENT_TIME_PROPERTY_ID]: { start: `${day(2)}T14:00:00Z`, end: `${day(2)}T14:45:00Z`, timeZone: 'UTC' } },
    body: `A 45-minute planning conversation for ${link(project)}, explicitly scheduled at **14:00–14:45 UTC**. Event time stores start, exclusive end, and a time zone.

The calendar is an agenda grouped by stored start date, not a month grid or recurring-event engine. This event belongs only in the timed-event block.`,
  });
  objects.createObject({
    typeId: REMINDER_TYPE_ID,
    title: 'Check the spare key · a dated reminder',
    properties: { [context]: project.id, [REMINDER_DATE_PROPERTY_ID]: day(3) },
    body: `Remember to check the spare key before opening ${link(project)}.

A Reminder is a calendar item with either a date or an exact time. It does **not** send notifications, repeat, snooze, or track completion. Use a Task when you need Done.`,
  });
  objects.createObject({
    typeId: REMINDER_TYPE_ID,
    title: 'Bring the welcome sign · an exact-time reminder',
    properties: { [context]: project.id, [REMINDER_TIME_PROPERTY_ID]: `${day(4)}T09:00:00Z` },
    body: `A calendar marker at **09:00 UTC** for ${link(project)}. The datetime includes seconds and an explicit offset; it is not an unzoned local time.

This demonstrates the timed alternative to Reminder date. It remains only a saved calendar item—Taskdesk will not deliver an alert.`,
  });
  const journal = objects.createObject({
    typeId: JOURNAL_TYPE_ID,
    title: 'First day · exploring an object workspace',
    properties: { [context]: project.id, [JOURNAL_DATE_PROPERTY_ID]: day(0) },
    body: `# A small beginning

Today I explored ${link(project)} through pages, tasks, and dates. The interesting part is not another app for each activity: the same objects appear in several views.

## Reflection

- Writing provides context; properties provide structure.
- A reference connects work without duplicating it.
- A view can be replaced without losing the objects underneath it.

**Try Journal in the sidebar:** choose ${day(0)} and open the day. It reopens this entry rather than creating a duplicate. Renaming the title does not change Journal date. A journal in Trash still owns its day until explicitly restored.

These are sample reflections. Replace them with your own writing and save; initialization will never overwrite them.`,
  });
  objects.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'Start here · your workspace is made of primitives',
    properties: {
      [summary]: 'A five-minute, editable tour: objects, writing, properties, links, and views. No plugins or generated code.',
      [related]: [project.id, writing.id, perspectives.id, safety.id],
    },
    body: `# Welcome to your demo workspace

This is an ordinary **Page**, not a special onboarding screen. Everything here is built from Taskdesk's existing primitives: **objects, types, properties, Markdown, references, and views**. The examples are fictional and yours to edit.

## A five-minute tour

1. Read ${link(project)}. Its project brief is just a Page; its **Linked from** section gathers related work.
2. Open ${link(invitation)} and find **Properties** between its title and writing. Try a title, a property, or a sentence; save explicitly.
3. Open **Views → 01 · Start here**. The same tasks appear as a Done board and a table. Change Done on the board, then open the task to see the result.
4. Open **Calendar → 02 · Calendar**. Find the undated task under Unscheduled, and inspect ${link(opening)} for an exclusive-end date range.
5. Open **Views → 03 · Page focus**, choose the reading-room Page, and explore its reference-scoped work. No input means no records.
6. Visit ${link(journal)} or choose **Journal** for today's page. A day has one canonical entry, even if it is in Trash.

## Go deeper

- ${link(writing)} — formatted writing, Markdown, search, object links, and backlinks.
- ${link(perspectives)} — every trusted view component, scoped inputs, AI drafts, and shared property identities.
- ${link(safety)} — recover a trashed example, try revision conflicts, and delete a view without deleting data.

Browse **Page** in List or Gallery to compare compact rows with writing excerpts. Search with **Ctrl/Command+K**. Pin a useful view from its page. All demo content uses native forms and remains usable without JavaScript.

## Keep it small

Page is writing; Task adds completion and an optional due date; Event is a date/time range; Reminder is a date/time marker, not a notification; Journal is one page per day. All nine property kinds are represented under **Manage types**, including single and multiple references.

The published views are bundled examples and need no model. Creating or refining a view with AI requires Pi authentication and always produces a draft for review. No generated HTML, JavaScript, SQL, or plugins run here.

Dates are relative to first initialization and stay fixed afterward. Edit, trash, restore, or delete examples freely: restarting does not reseed them.`,
  });

  const views = new ViewService(objects);
  const publish = (spec: ViewSpec): void => {
    const draft = views.create({ spec, model: 'built-in/demo' }, 'Bundled demo composed from existing object and view primitives; no model generation.');
    views.publish(draft.id, draft.revision);
  };
  publish({
    title: '03 · Page focus',
    description: 'Choose a Page to scope real references. Change Priority on its unfinished tasks; related events, reminders, and journals stay in the same context. No input means no records.',
    input: { label: 'Context page', typeId: PAGE_TYPE_ID },
    blocks: [
      {
        title: 'Unfinished work · edit Priority', component: 'board', editable: true,
        columns: [{ role: 'due', label: 'Due date' }],
        sources: [{ typeId: TASK_TYPE_ID, bindings: { group: priority, due: TASK_DUE_PROPERTY_ID }, where: [
          { propertyId: context, operator: 'equals', value: { input: true } },
          { propertyId: TASK_DONE_PROPERTY_ID, operator: 'equals', value: false },
        ] }],
      },
      {
        title: 'Related events, reminders, and journals', component: 'list',
        sources: [EVENT_TYPE_ID, REMINDER_TYPE_ID, JOURNAL_TYPE_ID].map(typeId => ({
          typeId, bindings: {}, where: [{ propertyId: context, operator: 'equals', value: { input: true } }],
        })),
      },
    ],
  });
  publish({
    title: '02 · Calendar',
    description: 'A shared agenda, not copied calendar records. Edit a bound date to reschedule the original object. Date/time alternatives have separate blocks; undated tasks remain Unscheduled. Timed examples use UTC.',
    blocks: [
      {
        title: 'Tasks and journals · different types, compatible dates', component: 'calendar', editable: true,
        sources: [
          { typeId: TASK_TYPE_ID, bindings: { date: TASK_DUE_PROPERTY_ID } },
          { typeId: JOURNAL_TYPE_ID, bindings: { date: JOURNAL_DATE_PROPERTY_ID } },
        ],
      },
      ...[
        { title: 'All-day events · exclusive end dates', typeId: EVENT_TYPE_ID, propertyId: EVENT_DATES_PROPERTY_ID },
        { title: 'Timed events · explicit time zones', typeId: EVENT_TYPE_ID, propertyId: EVENT_TIME_PROPERTY_ID },
        { title: 'Dated reminders · no notifications', typeId: REMINDER_TYPE_ID, propertyId: REMINDER_DATE_PROPERTY_ID },
        { title: 'Timed reminders · exact instants', typeId: REMINDER_TYPE_ID, propertyId: REMINDER_TIME_PROPERTY_ID },
      ].map(({ title, typeId, propertyId }) => ({
        title, component: 'calendar' as const, editable: true,
        sources: [{ typeId, bindings: { date: propertyId }, where: [{ propertyId, operator: 'notEmpty' as const }] }],
      })),
    ],
  });
  publish({
    title: '01 · Start here',
    description: 'Open the Start here Page for a guided tour. These ordinary, editable demo objects power a list, a Done board, and a table. Change Done on the board: the table and original object change together.',
    blocks: [
      {
        title: 'Read the guide pages · list primitive', component: 'list',
        columns: [{ role: 'summary', label: 'Summary' }],
        sources: [{ typeId: PAGE_TYPE_ID, bindings: { summary } }],
      },
      {
        title: 'Try completing a task · board primitive', component: 'board', editable: true,
        sources: [{ typeId: TASK_TYPE_ID, bindings: { group: TASK_DONE_PROPERTY_ID } }],
      },
      {
        title: 'The same tasks · table primitive', component: 'table',
        columns: [
          { role: 'done', label: 'Done' }, { role: 'due', label: 'Due date' },
          { role: 'priority', label: 'Priority' }, { role: 'effort', label: 'Effort (hours)' }, { role: 'context', label: 'Context' },
        ],
        sources: [{
          typeId: TASK_TYPE_ID,
          bindings: { done: TASK_DONE_PROPERTY_ID, due: TASK_DUE_PROPERTY_ID, priority, effort, context },
          orderBy: { propertyId: TASK_DUE_PROPERTY_ID, direction: 'ascending' },
        }],
      },
    ],
  });
}
