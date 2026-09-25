import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService, validateViewSpec } from '../src/objects/views.js';
import { JOURNAL_TYPE_ID, JOURNAL_DATE_PROPERTY_ID, TASK_TYPE_ID, TASK_DONE_PROPERTY_ID } from '../src/objects/model.js';
import type { ObjectType, PropertyKind, PropertyValue, ViewSpec } from '../src/objects/model.js';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'object-views-'));
  const file = join(directory, 'workspace.sqlite');
  const db = openDatabase(file);
  const connections = [db];
  t.after(() => { for (const connection of connections) connection.close(); rmSync(directory, { recursive: true, force: true }); });
  const objects = new ObjectRuntime(db);
  const views = new ViewService(objects);
  return {
    db, objects, views,
    property(type: ObjectType, label: string, kind: PropertyKind, extra: { targetTypeId?: string; multiple?: boolean; options?: string[] } = {}) {
      const changed = objects.addProperty(type.id, objects.getType(type.id).revision, { label, kind, ...extra });
      return objects.getProperty(changed.propertyIds.at(-1)!);
    },
    object(type: ObjectType, title: string, properties: Record<string, PropertyValue> = {}) {
      return objects.createObject({ typeId: type.id, title, properties, body: '' });
    },
    reopen() {
      const connection = openDatabase(file);
      connections.push(connection);
      return new ViewService(new ObjectRuntime(connection));
    },
  };
}
function status(code: number): (error: unknown) => boolean {
  return error => error instanceof AppError && error.status === code;
}

test('multi-type calendars retain unscheduled objects and survive label changes, reopening, and view deletion', t => {
  const f = fixture(t);
  const tasks = f.objects.createType('Tasks');
  const events = f.objects.createType('Events');
  const due = f.property(tasks, 'Due', 'date');
  const starts = f.property(events, 'Starts', 'datetime');
  const task = f.object(tasks, 'Write', { [due.id]: '2026-09-24' });
  const unscheduled = f.object(tasks, 'Think');
  const event = f.object(events, 'Meet', { [starts.id]: '2026-09-24T11:00:00+02:00' });
  const trash = f.object(tasks, 'Gone', { [due.id]: '2026-09-24' });
  f.objects.setTrashed(trash.id, trash.revision, true);
  const spec: ViewSpec = { title: 'Calendar', blocks: [{ title: 'Work', component: 'calendar', editable: true, sources: [
    { typeId: tasks.id, bindings: { date: due.id } }, { typeId: events.id, bindings: { date: starts.id } },
  ] }] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Show work dates');
  const published = f.views.publish(draft.id, draft.revision);
  f.objects.renameProperty(due.id, due.revision, 'Deadline');
  const reopened = f.reopen();
  const rows = reopened.evaluate(published.id).blocks[0]!.rows;
  assert.deepEqual(new Set(rows.map(row => row.object.id)), new Set([task.id, unscheduled.id, event.id]));
  assert.equal(rows.find(row => row.object.id === unscheduled.id)!.object.properties[due.id], undefined);
  assert.equal(rows.find(row => row.object.id === task.id)!.bindings.date, due.id);
  reopened.delete(published.id, published.revision);
  assert.throws(() => reopened.get(published.id), status(404));
  assert.equal(f.objects.getObject(task.id).properties[due.id], '2026-09-24');
  assert.equal(f.objects.getObject(event.id).properties[starts.id], '2026-09-24T11:00:00+02:00');
});

test('bindings require source membership, explicit table columns, and structurally valid component roles', t => {
  const f = fixture(t);
  const tasks = f.objects.createType('Tasks');
  const projects = f.objects.createType('Projects');
  const title = f.property(tasks, 'Context', 'text');
  const due = f.property(projects, 'Date', 'date');
  const refs = f.property(tasks, 'Projects', 'reference', { multiple: true, targetTypeId: projects.id });
  const invalidSpecs: ViewSpec[] = [
    { title: 'Wrong source', blocks: [{ title: 'Dates', component: 'calendar', sources: [{ typeId: tasks.id, bindings: { date: due.id } }] }] },
    { title: 'Wrong kind', blocks: [{ title: 'Dates', component: 'calendar', sources: [{ typeId: tasks.id, bindings: { date: title.id } }] }] },
    { title: 'No columns', blocks: [{ title: 'Table', component: 'table', sources: [{ typeId: tasks.id, bindings: {} }] }] },
    { title: 'Missing role', blocks: [{ title: 'Table', component: 'table', columns: [{ role: 'context', label: 'Context' }], sources: [{ typeId: tasks.id, bindings: {} }] }] },
    { title: 'Multiple groups', blocks: [{ title: 'Board', component: 'board', sources: [{ typeId: tasks.id, bindings: { group: refs.id } }] }] },
    { title: 'Text date filter', blocks: [{ title: 'List', component: 'list', sources: [{ typeId: tasks.id, bindings: {}, where: [{ propertyId: title.id, operator: 'before', value: '2026-09-24' }] }] }] },
  ];
  for (const spec of invalidSpecs) assert.throws(() => f.views.validate(spec), status(422));
  const spec: ViewSpec = { title: 'Columns', blocks: [{ title: 'Context', component: 'table', columns: [{ role: 'context', label: 'Context' }], sources: [{ typeId: tasks.id, bindings: { context: title.id } }] }] };
  const object = f.object(tasks, 'One', { [title.id]: 'An ordinary value' });
  const view = f.views.create({ spec, model: 'test/model' }, 'Show context');
  const row = f.views.evaluate(view.id).blocks[0]!.rows[0]!;
  assert.equal(row.object.properties[row.bindings.context!], 'An ordinary value');
  assert.equal(row.object.id, object.id);
});

test('required typed input scopes relation queries and is freshly enforced for actions', t => {
  const f = fixture(t);
  const projects = f.objects.createType('Projects');
  const tasks = f.objects.createType('Tasks');
  const relation = f.property(tasks, 'Project', 'reference', { targetTypeId: projects.id });
  const related = f.property(tasks, 'Related projects', 'reference', { targetTypeId: projects.id, multiple: true });
  const done = f.property(tasks, 'Done', 'boolean');
  const a = f.object(projects, 'A');
  const b = f.object(projects, 'B');
  const taskA = f.object(tasks, 'Task A', { [relation.id]: a.id.toUpperCase(), [related.id]: [a.id, b.id.toUpperCase()], [done.id]: false });
  const taskB = f.object(tasks, 'Task B', { [relation.id]: b.id, [done.id]: false });
  const spec: ViewSpec = { title: 'Project work', input: { label: 'Project', typeId: projects.id }, blocks: [
    { title: 'Owned work', component: 'board', editable: true, sources: [{ typeId: tasks.id, bindings: { group: done.id }, where: [{ propertyId: relation.id, operator: 'equals', value: { input: true } }] }] },
    { title: 'Related work', component: 'list', sources: [{ typeId: tasks.id, bindings: {}, where: [{ propertyId: related.id, operator: 'contains', value: { input: true } }] }] },
  ] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Show project work');
  const view = f.views.publish(draft.id, draft.revision);
  assert.deepEqual(f.views.evaluate(view.id).blocks.map(block => block.rows), [[], []]);
  assert.deepEqual(f.views.evaluate(view.id, a.id).blocks[0]!.rows.map(row => row.object.id), [taskA.id]);
  assert.deepEqual(f.views.evaluate(view.id, b.id).blocks[0]!.rows.map(row => row.object.id), [taskB.id]);
  assert.deepEqual(f.views.evaluate(view.id, b.id).blocks[1]!.rows.map(row => row.object.id), [taskA.id]);
  assert.throws(() => f.views.evaluate(view.id, taskA.id), status(422));
  assert.throws(() => f.views.act(view.id, view.revision, 0, taskA.id, taskA.revision, 'group', true), status(422));
  assert.throws(() => f.views.act(view.id, view.revision, 0, taskB.id, taskB.revision, 'group', true, a.id), status(403));
  const changed = f.views.act(view.id, view.revision, 0, taskA.id, taskA.revision, 'group', true, a.id);
  assert.equal(changed.properties[done.id], true);
  const moved = f.objects.patchProperties(taskA.id, changed.revision, { [relation.id]: b.id });
  assert.throws(() => f.views.act(view.id, view.revision, 0, taskA.id, moved.revision, 'group', false, a.id), status(403));
  assert.equal(f.objects.getObject(taskA.id).properties[done.id], true);
  const unscoped = structuredClone(spec);
  unscoped.blocks[1]!.sources[0]!.where = [];
  assert.throws(() => f.views.validate(unscoped), status(422));
});

test('temporal predicates compare instants and range starts, not offset spellings', t => {
  const f = fixture(t);
  const events = f.objects.createType('Events');
  const starts = f.property(events, 'At', 'datetime');
  const range = f.property(events, 'Window', 'date-range');
  const early = f.object(events, 'Early', { [starts.id]: '2026-09-24T09:30:00+02:00', [range.id]: { start: '2026-09-23', end: '2026-09-28' } });
  const late = f.object(events, 'Late', { [starts.id]: '2026-09-24T08:30:00Z', [range.id]: { start: '2026-09-25', end: '2026-09-28' } });
  f.object(events, 'No date');
  const spec: ViewSpec = { title: 'Earlier', blocks: [
    { title: 'Instants', component: 'list', sources: [{ typeId: events.id, bindings: {}, where: [{ propertyId: starts.id, operator: 'before', value: '2026-09-24T10:00:00+02:00' }] }] },
    { title: 'Ranges', component: 'list', sources: [{ typeId: events.id, bindings: {}, where: [{ propertyId: range.id, operator: 'before', value: '2026-09-24' }] }] },
    { title: 'Ordered', component: 'list', sources: [{ typeId: events.id, bindings: {}, where: [{ propertyId: starts.id, operator: 'notEmpty' }], orderBy: { propertyId: starts.id, direction: 'ascending' } }] },
  ] };
  const view = f.views.create({ spec, model: 'test/model' }, 'Find earlier events');
  const blocks = f.views.evaluate(view.id).blocks;
  assert.deepEqual(blocks[0]!.rows.map(row => row.object.id), [early.id]);
  assert.deepEqual(blocks[1]!.rows.map(row => row.object.id), [early.id]);
  assert.deepEqual(blocks[2]!.rows.map(row => row.object.id), [early.id, late.id]);
  const invalid = structuredClone(spec);
  invalid.blocks[1]!.sources[0]!.where![0]!.value = '2026-02-30';
  assert.throws(() => f.views.validate(invalid), status(422));
});

test('missing predicates preserve false and zero, and text filters are literal prepared values', t => {
  const f = fixture(t);
  const type = f.objects.createType('Items');
  const done = f.property(type, 'Done', 'boolean');
  const count = f.property(type, 'Count', 'number');
  const note = f.property(type, 'Note', 'text');
  const literal = "x' OR 1=1 --%_";
  const zero = f.object(type, 'Zero', { [done.id]: false, [count.id]: 0, [note.id]: literal });
  const empty = f.object(type, 'Missing');
  const spec: ViewSpec = { title: 'Values', blocks: [
    { title: 'False is present', component: 'list', sources: [{ typeId: type.id, bindings: {}, where: [{ propertyId: done.id, operator: 'notEmpty' }] }] },
    { title: 'Zero equals zero', component: 'list', sources: [{ typeId: type.id, bindings: {}, where: [{ propertyId: count.id, operator: 'equals', value: 0 }] }] },
    { title: 'Not true excludes missing', component: 'list', sources: [{ typeId: type.id, bindings: {}, where: [{ propertyId: done.id, operator: 'notEquals', value: true }] }] },
    { title: 'Missing', component: 'list', sources: [{ typeId: type.id, bindings: {}, where: [{ propertyId: done.id, operator: 'empty' }] }] },
    { title: 'Literal', component: 'list', sources: [{ typeId: type.id, bindings: {}, where: [{ propertyId: note.id, operator: 'contains', value: literal }] }] },
  ] };
  const view = f.views.create({ spec, model: 'test/model' }, 'Check values');
  assert.deepEqual(f.views.evaluate(view.id).blocks.map(block => block.rows.map(row => row.object.id)), [[zero.id], [zero.id], [zero.id], [empty.id], [zero.id]]);
});

test('queries bound projections to 100 with stable ordering and never copy their objects', t => {
  const f = fixture(t);
  const type = f.objects.createType('Work');
  const start = f.property(type, 'Start', 'date');
  const end = f.property(type, 'End', 'date');
  const one = f.object(type, 'One', { [start.id]: '2026-09-24', [end.id]: '2026-09-25' });
  const spec: ViewSpec = { title: 'Two dates', blocks: [
    { title: 'Start', component: 'calendar', editable: true, sources: [{ typeId: type.id, bindings: { date: start.id } }] },
    { title: 'End', component: 'calendar', editable: true, sources: [{ typeId: type.id, bindings: { date: end.id } }] },
  ] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Project both dates');
  const view = f.views.publish(draft.id, draft.revision);
  const projections = f.views.evaluate(view.id).blocks.flatMap(block => block.rows);
  assert.deepEqual(projections.map(row => [row.object.id, row.bindings.date]), [[one.id, start.id], [one.id, end.id]]);
  const ambiguous = structuredClone(spec);
  ambiguous.blocks[0]!.sources.push({ typeId: type.id, bindings: { date: end.id } });
  assert.throws(() => f.views.validate(ambiguous), status(422));
  const rescheduled = f.views.act(view.id, view.revision, 0, one.id, one.revision, 'date', '2026-09-26');
  assert.equal(rescheduled.properties[start.id], '2026-09-26');
  assert.equal(rescheduled.properties[end.id], '2026-09-25');
  for (let index = 0; index < 105; index++) f.object(type, `Entry ${String(index).padStart(3, '0')}`);
  const block = f.views.evaluate(view.id).blocks[0]!;
  assert.equal(block.truncated, true);
  assert.deepEqual(block.rows.map(row => row.object.title), Array.from({ length: 100 }, (_, index) => `Entry ${String(index).padStart(3, '0')}`));
  const ids = block.rows.map(row => row.object.id);
  assert.deepEqual(f.views.evaluate(view.id).blocks[0]!.rows.map(row => row.object.id), ids);
  f.views.delete(view.id, view.revision);
  assert.equal(f.objects.getObject(one.id).properties[end.id], '2026-09-25');
});

test('actions require published exposed roles, fresh object and view revisions, and current filters', t => {
  const f = fixture(t);
  const type = f.objects.createType('Tasks');
  const done = f.property(type, 'Done', 'boolean');
  const due = f.property(type, 'Due', 'date');
  const object = f.object(type, 'Finish', { [done.id]: false, [due.id]: '2026-09-24' });
  const spec: ViewSpec = { title: 'Open work', blocks: [
    { title: 'Board', component: 'board', editable: true, sources: [{ typeId: type.id, bindings: { group: done.id }, where: [{ propertyId: done.id, operator: 'equals', value: false }] }] },
    { title: 'Read-only dates', component: 'calendar', sources: [{ typeId: type.id, bindings: { date: due.id } }] },
  ] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Show unfinished work');
  assert.throws(() => f.views.act(draft.id, draft.revision, 0, object.id, object.revision, 'group', true), status(409));
  const published = f.views.publish(draft.id, draft.revision);
  assert.throws(() => f.views.publish(draft.id, draft.revision), status(409));
  assert.throws(() => f.views.delete(draft.id, draft.revision), status(409));
  assert.throws(() => f.views.act(published.id, draft.revision, 0, object.id, object.revision, 'group', true), status(409));
  assert.throws(() => f.views.act(published.id, published.revision, 0, object.id, object.revision, 'date', '2026-09-30'), status(403));
  assert.throws(() => f.views.act(published.id, published.revision, 1, object.id, object.revision, 'date', '2026-09-30'), status(403));
  const changed = f.objects.patchProperties(object.id, object.revision, { [due.id]: '2026-09-25' });
  assert.throws(() => f.views.act(published.id, published.revision, 0, object.id, object.revision, 'group', true), status(409));
  const completed = f.views.act(published.id, published.revision, 0, object.id, changed.revision, 'group', true);
  assert.equal(completed.properties[done.id], true);
  assert.equal(completed.properties[due.id], '2026-09-25');
  assert.deepEqual(f.views.evaluate(published.id).blocks[0]!.rows, []);
  assert.throws(() => f.views.act(published.id, published.revision, 0, object.id, completed.revision, 'group', false), status(403));
  assert.throws(() => f.db.query('UPDATE object_view_revisions SET prompt = ? WHERE id = ?').run('Rewritten history', published.id));
  f.views.delete(published.id, published.revision);
  const history = f.db.query<{ revision: number; deleted: number }, [string]>('SELECT revision, deleted FROM object_view_revisions WHERE id = ? ORDER BY revision').all(published.id);
  assert.deepEqual(history, [{ revision: 1, deleted: 0 }, { revision: 2, deleted: 0 }, { revision: 3, deleted: 1 }]);
});

test('a schema kind change invalidates a saved binding even when the new kind fits the same component', t => {
  const f = fixture(t);
  const type = f.objects.createType('Tasks');
  const group = f.property(type, 'Group', 'text');
  const spec: ViewSpec = { title: 'Groups', blocks: [{ title: 'Board', component: 'board', sources: [{ typeId: type.id, bindings: { group: group.id } }] }] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Group tasks');
  const catalog = f.objects.catalog();
  catalog.properties.find(property => property.id === group.id)!.kind = 'boolean';
  assert.equal(validateViewSpec(spec, catalog).blocks[0]!.component, 'board');
  // Simulate a schema migration: a new compatible component kind must not reinterpret an old saved binding.
  f.db.query('UPDATE object_properties SET kind = ? WHERE id = ?').run('boolean', group.id);
  assert.throws(() => f.views.publish(draft.id, draft.revision), status(409));
  assert.throws(() => f.views.evaluate(draft.id), status(409));
});

test('published journal date commands enforce daily uniqueness including trash and retain writing', t => {
  const f = fixture(t);
  const one = f.objects.openJournal('2026-09-25');
  const journal = f.objects.updateObject(one.id, one.revision, { ...one, body: 'Daily writing must survive.' });
  const other = f.objects.openJournal('2026-09-26');
  f.objects.setTrashed(other.id, other.revision, true);
  const spec: ViewSpec = { title: 'Journals', blocks: [{
    title: 'Days', component: 'calendar', editable: true,
    sources: [{ typeId: JOURNAL_TYPE_ID, bindings: { date: JOURNAL_DATE_PROPERTY_ID } }],
  }] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Journal calendar');
  const view = f.views.publish(draft.id, draft.revision);
  assert.throws(() => f.views.act(view.id, view.revision, 0, journal.id, journal.revision, 'date', '2026-09-26'), status(409));
  assert.throws(() => f.views.act(view.id, view.revision, 0, journal.id, journal.revision, 'date', null), status(422));
  assert.deepEqual(f.objects.getObject(journal.id), journal);
  const moved = f.views.act(view.id, view.revision, 0, journal.id, journal.revision, 'date', '2026-09-24');
  assert.equal(moved.body, journal.body);
  assert.equal(f.views.evaluate(view.id).blocks[0]!.rows[0]!.object.properties[JOURNAL_DATE_PROPERTY_ID], '2026-09-24');
});

test('new built-in tasks appear as incomplete and creation retries cannot reset completed work', t => {
  const f = fixture(t);
  const requestId = crypto.randomUUID();
  const input = { typeId: TASK_TYPE_ID, title: 'Finish work', properties: {}, body: '' };
  const task = f.objects.createObject(input, requestId);
  const spec: ViewSpec = { title: 'Open tasks', blocks: [{
    title: 'Completion', component: 'board', editable: true,
    sources: [{ typeId: TASK_TYPE_ID, bindings: { group: TASK_DONE_PROPERTY_ID }, where: [{ propertyId: TASK_DONE_PROPERTY_ID, operator: 'equals', value: false }] }],
  }] };
  const draft = f.views.create({ spec, model: 'test/model' }, 'Incomplete tasks');
  const view = f.views.publish(draft.id, draft.revision);
  assert.deepEqual(f.views.evaluate(view.id).blocks[0]!.rows.map(row => row.object.id), [task.id]);
  const completed = f.views.act(view.id, view.revision, 0, task.id, task.revision, 'group', true);
  assert.deepEqual(f.views.evaluate(view.id).blocks[0]!.rows, []);
  assert.deepEqual(f.objects.createObject(input, requestId), completed);
  assert.throws(() => f.objects.createObject({ ...input, properties: { [TASK_DONE_PROPERTY_ID]: false } }, requestId), status(409));
});
